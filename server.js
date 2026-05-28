/**
 * RawStream — Production Server
 * Serves the Vite-built frontend and all /api/* streaming endpoints.
 * Works on any host that has yt-dlp and ffmpeg in PATH (or set via env vars).
 */

import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { Readable } from 'stream';
import { exec, spawn } from 'child_process';
import util from 'util';
import os from 'os';
import WebTorrent from 'webtorrent';
import parseTorrent from 'parse-torrent';
import fs from 'fs';
import crypto from 'crypto';

const execPromise = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

// ─── Torrent Manager ───────────────────────────────────────────────────────────
let torrentClient = null;
const activeTorrents = new Map(); // key: infoHash (lowercased), value: { torrent, lastAccessed: timestamp }

function getTorrentClient() {
  if (!torrentClient) {
    torrentClient = new WebTorrent();
    torrentClient.on('error', (err) => {
      console.error('[WebTorrent Client Error]:', err.message);
    });
  }
  return torrentClient;
}

function cleanOldTorrents() {
  const MAX_TORRENTS = 3;
  if (activeTorrents.size <= MAX_TORRENTS) return;

  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [key, value] of activeTorrents.entries()) {
    if (value.lastAccessed < oldestTime) {
      oldestTime = value.lastAccessed;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    const entry = activeTorrents.get(oldestKey);
    console.log(`[TorrentManager] Destroying LRU torrent: ${entry.torrent.name || oldestKey}`);
    entry.torrent.destroy(() => {
      activeTorrents.delete(oldestKey);
    });
  }
}

async function addTorrent(torrentSource) {
  const client = getTorrentClient();
  
  let infoHash;
  if (typeof torrentSource === 'string' && torrentSource.length === 40 && /^[a-fA-F0-9]+$/.test(torrentSource)) {
    infoHash = torrentSource.toLowerCase();
  } else {
    try {
      const parsed = await parseTorrent(torrentSource);
      infoHash = parsed.infoHash.toLowerCase();
    } catch (err) {
      console.error('[TorrentManager] parseTorrent failed:', err.message);
    }
  }

  if (infoHash) {
    const entry = activeTorrents.get(infoHash);
    if (entry) {
      entry.lastAccessed = Date.now();
      if (entry.torrent.ready) return entry.torrent;
      return new Promise((resolve) => {
        entry.torrent.once('ready', () => resolve(entry.torrent));
      });
    }

    // Check if it's already in the WebTorrent client by matching infoHash
    const existing = client.torrents.find(t => t.infoHash.toLowerCase() === infoHash);
    if (existing) {
      activeTorrents.set(infoHash, {
        torrent: existing,
        lastAccessed: Date.now()
      });
      cleanOldTorrents();
      if (existing.ready) return existing;
      return new Promise((resolve) => {
        existing.once('ready', () => resolve(existing));
      });
    }
  }

  // If we only have infoHash but it's not active, we cannot add a new torrent from just infoHash
  if (infoHash && (typeof torrentSource === 'string' && torrentSource.length === 40)) {
    throw new Error('Torrent not found by infoHash and cannot be resolved');
  }

  return new Promise((resolve, reject) => {
    console.log(`[TorrentManager] Adding new torrent...`);
    let torrent;
    try {
      torrent = client.add(torrentSource, {
        path: path.join(os.tmpdir(), 'webtorrent'),
        deselect: true
      });
    } catch (err) {
      return reject(err);
    }

    torrent.once('infoHash', () => {
      activeTorrents.set(torrent.infoHash.toLowerCase(), {
        torrent,
        lastAccessed: Date.now()
      });
      cleanOldTorrents();
    });

    torrent.once('ready', () => {
      console.log(`[TorrentManager] Torrent ready: ${torrent.name}`);
      resolve(torrent);
    });

    torrent.once('error', (err) => {
      console.error(`[TorrentManager] Torrent error:`, err.message);
      if (torrent.infoHash) activeTorrents.delete(torrent.infoHash.toLowerCase());
      reject(err);
    });

    setTimeout(() => {
      if (!torrent.ready) {
        console.log('[TorrentManager] Metadata timeout after 90s.');
        if (torrent.infoHash) activeTorrents.delete(torrent.infoHash.toLowerCase());
        torrent.destroy();
        reject(new Error('Metadata resolution timeout (no peers or slow connection)'));
      }
    }, 90000); // 90 seconds — enough time for peers to respond on slow/sparse torrents
  });
}



// ─── Tool path discovery ───────────────────────────────────────────────────────
// Prefer explicit env vars (YTDLP_PATH, FFMPEG_PATH, FFPROBE_PATH),
// then auto-discover via `which`.
async function findBin(candidates) {
  for (const name of candidates) {
    try {
      const { stdout } = await execPromise(`which ${name}`);
      const p = stdout.trim();
      if (p) return p;
    } catch {}
  }
  return candidates[0]; // last-resort: hope it's in PATH
}

let YTDLP, FFMPEG, FFPROBE;

async function initTools() {
  YTDLP   = process.env.YTDLP_PATH   || await findBin(['yt-dlp']);
  FFMPEG  = process.env.FFMPEG_PATH  || await findBin(['ffmpeg']);
  FFPROBE = process.env.FFPROBE_PATH || await findBin(['ffprobe']);
  console.log(`[Tools] yt-dlp: ${YTDLP}`);
  console.log(`[Tools] ffmpeg: ${FFMPEG}`);
  console.log(`[Tools] ffprobe: ${FFPROBE}`);
}

// ─── App setup ─────────────────────────────────────────────────────────────────
const app = express();

// ─── /api/gdrive-stream ────────────────────────────────────────────────────────
// Stream a Google Drive file using yt-dlp piped to stdout.
// Accepts optional ?start=SECONDS for time-offset seeking.
app.get('/api/gdrive-stream', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const { fileId, start } = req.query;
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    res.status(400).send('Missing or invalid fileId'); return;
  }

  const startSec = parseFloat(start || '0');
  const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;

  const ytdlpArgs = [
    '-o', '-',
    '--no-playlist', '--no-part', '--quiet',
    '-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
  ];

  if (startSec > 0) {
    const h = Math.floor(startSec / 3600);
    const m = Math.floor((startSec % 3600) / 60);
    const s = Math.floor(startSec % 60);
    const ts = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    ytdlpArgs.push('--download-sections', `*${ts}-`);
    console.log(`[GDriveStream] Seeking to ${ts} for ${fileId}`);
  }

  ytdlpArgs.push(driveUrl);
  console.log(`[GDriveStream] Spawning yt-dlp for fileId: ${fileId}`);

  const ytProcess = spawn(YTDLP, ytdlpArgs);

  res.status(200);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  ytProcess.stdout.pipe(res);

  ytProcess.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg && !msg.startsWith('WARNING:')) console.error(`[yt-dlp] ${msg}`);
  });

  ytProcess.on('error', (err) => {
    console.error('[GDriveStream] yt-dlp error:', err.message);
    if (!res.headersSent) res.status(500).send('yt-dlp error: ' + err.message);
  });

  ytProcess.on('close', (code) => {
    console.log(`[GDriveStream] yt-dlp exited (${code}) for ${fileId}`);
  });

  req.on('close', () => {
    if (!ytProcess.killed) ytProcess.kill('SIGKILL');
  });
});

// ─── /api/gdrive-meta ──────────────────────────────────────────────────────────
// Fetch video duration via yt-dlp --print duration.
app.get('/api/gdrive-meta', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { fileId } = req.query;
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    res.status(400).json({ error: 'Invalid fileId' }); return;
  }

  try {
    const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
    const { stdout } = await execPromise(
      `${YTDLP} --print duration --no-playlist --quiet "${driveUrl}"`,
      { timeout: 20000 }
    );
    const duration = parseFloat(stdout.trim());
    res.json({ duration: isNaN(duration) ? null : duration });
  } catch (err) {
    console.error('[GDriveMeta]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/resolve ──────────────────────────────────────────────────────────────
// Validate Drive fileId and return the proxy stream URL.
app.get('/api/resolve', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { fileId } = req.query;
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    res.status(400).json({ error: 'Missing or invalid fileId' }); return;
  }

  try {
    const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
    try {
      await execPromise(`${YTDLP} --get-title --no-playlist --quiet "${driveUrl}"`, { timeout: 20000 });
    } catch (checkErr) {
      const msg = (checkErr.stderr || checkErr.message || '').toLowerCase();
      if (msg.includes('private') || msg.includes('403') || msg.includes('not available')) {
        res.status(403).json({ error: 'File is private or restricted. Set sharing to "Anyone with the link".' });
        return;
      }
    }
    res.json({ streamUrl: `/api/gdrive-stream?fileId=${encodeURIComponent(fileId)}` });
  } catch (err) {
    console.error('[Resolve]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/probe ────────────────────────────────────────────────────────────────
// Probe video codecs using ffprobe (for OneDrive / local files).
app.get('/api/probe', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url: targetUrl } = req.query;
  if (!targetUrl) { res.status(400).json({ error: 'Missing url' }); return; }

  let resolvedUrl = targetUrl;
  if (targetUrl.startsWith('/')) {
    if (targetUrl.startsWith('/api/')) {
      resolvedUrl = `http://127.0.0.1:${PORT}${targetUrl}`;
    }
  }

  const isLocal = resolvedUrl.startsWith('/');
  if (!isLocal) {
    const allowed = ['drive.google.com','googlevideo.com','api.onedrive.com','onedrive.live.com','1drv.ms','localhost','127.0.0.1'];
    try {
      const host = new URL(resolvedUrl).hostname;
      if (!allowed.some(d => host === d || host.endsWith('.' + d))) {
        res.status(403).json({ error: 'Domain not allowed' }); return;
      }
    } catch { res.status(400).json({ error: 'Invalid URL' }); return; }
  }

  try {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    const cmd = isLocal
      ? `${FFPROBE} -v error -show_format -show_streams -of json "${resolvedUrl}"`
      : `${FFPROBE} -v error -show_format -show_streams -headers "User-Agent: ${ua}\\r\\n" -of json "${resolvedUrl}"`;

    const { stdout } = await execPromise(cmd, { timeout: 20000 });
    const meta = JSON.parse(stdout);
    const video = meta.streams.find(s => s.codec_type === 'video');
    const audio = meta.streams.find(s => s.codec_type === 'audio');

    const container   = meta.format.format_name || '';
    const videoCodec  = video ? video.codec_name : '';
    const audioCodec  = audio ? audio.codec_name : '';
    const duration    = parseFloat(meta.format.duration) || 0;

    const supportedContainers   = ['mp4','mov','webm','ogg','isom'];
    const supportedVideoCodecs  = ['h264','vp8','vp9','av1'];
    const supportedAudioCodecs  = ['aac','mp3','opus','vorbis'];

    const containerSupported = supportedContainers.some(c => container.toLowerCase().includes(c));
    const videoSupported     = supportedVideoCodecs.includes(videoCodec.toLowerCase());
    const audioSupported     = supportedAudioCodecs.includes(audioCodec.toLowerCase());
    const needsTranscode     = !containerSupported || !videoSupported || !audioSupported;

    res.json({ needsTranscode, container, videoCodec, audioCodec, duration, videoSupported, audioSupported, containerSupported });
  } catch (err) {
    console.error('[Probe] Error probing URL:', err.message);
    
    // Smart fallback for torrent streams to ensure audio always plays
    if (targetUrl && targetUrl.includes('/api/torrent/stream')) {
      let torrentExt = '';
      try {
        const targetObj = new URL(resolvedUrl);
        const infoHash = targetObj.searchParams.get('infoHash');
        const fileIndex = parseInt(targetObj.searchParams.get('fileIndex') || '0', 10);
        if (infoHash) {
          const entry = activeTorrents.get(infoHash.toLowerCase());
          if (entry && entry.torrent && entry.torrent.files[fileIndex]) {
            const file = entry.torrent.files[fileIndex];
            torrentExt = path.extname(file.name).toLowerCase();
          }
        }
      } catch (e) {
        console.error('[Probe] Failed to parse torrent info for fallback:', e.message);
      }

      console.log(`[Probe] Torrent probe failed/timed out. Applying smart fallback for ext: ${torrentExt}`);
      const isMp4 = torrentExt === '.mp4' || torrentExt === '.m4v' || torrentExt === '.mov';
      const isMkv = torrentExt === '.mkv' || torrentExt === '.avi' || torrentExt === '.ts' || torrentExt === '.webm';
      res.json({
        needsTranscode: !isMp4,
        container: isMp4 ? 'mp4' : (isMkv ? 'mkv' : 'mp4'),
        videoCodec: 'h264',
        audioCodec: isMp4 ? 'aac' : 'ac3',
        duration: 0,
        videoSupported: true,
        audioSupported: isMp4,
        containerSupported: isMp4
      });
      return;
    }

    res.status(500).json({ error: 'Probe failed: ' + err.message });
  }
});

// ─── /api/stream ───────────────────────────────────────────────────────────────
// Proxy / transcode OneDrive or local files.
app.get('/api/stream', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url: targetUrl, transcode, start, vcodec, acodec } = req.query;
  if (!targetUrl) { res.status(400).send('Missing url'); return; }

  let resolvedUrl = targetUrl;
  if (targetUrl.startsWith('/')) {
    if (targetUrl.startsWith('/api/')) {
      resolvedUrl = `http://127.0.0.1:${PORT}${targetUrl}`;
    }
  }

  const isLocal = resolvedUrl.startsWith('/');
  if (!isLocal) {
    const allowed = ['drive.google.com','googlevideo.com','api.onedrive.com','onedrive.live.com','1drv.ms','localhost','127.0.0.1'];
    try {
      const host = new URL(resolvedUrl).hostname;
      if (!allowed.some(d => host === d || host.endsWith('.' + d))) {
        res.status(403).send('Domain not allowed'); return;
      }
    } catch { res.status(400).send('Invalid URL'); return; }
  }

  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

  if (transcode === 'true' || req.query.quality) {
    const startT = start || '0';
    const supportedVideo = ['h264','vp8','vp9','av1'];
    const supportedAudio = ['aac','mp3','opus','vorbis'];
    const targetQuality = req.query.quality || 'original';

    const isSeeking = startT && startT !== '0';
    const canCopyVideo = supportedVideo.includes((vcodec || '').toLowerCase());
    const canCopyAudio = supportedAudio.includes((acodec || '').toLowerCase());

    let vopts = [];
    if (targetQuality === '720p') {
      vopts = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23', '-vf', 'scale=-2:720', '-pix_fmt', 'yuv420p', '-b:v', '1500k', '-maxrate', '2000k', '-bufsize', '3000k'];
    } else if (targetQuality === '480p') {
      vopts = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23', '-vf', 'scale=-2:480', '-pix_fmt', 'yuv420p', '-b:v', '800k', '-maxrate', '1200k', '-bufsize', '1800k'];
    } else {
      // Force libx264 transcoding when seeking AND audio is being transcoded.
      // If both video and audio can be copied, copy both to keep them in sync without CPU usage.
      vopts = (canCopyVideo && (!isSeeking || canCopyAudio))
        ? ['-c:v', 'copy']
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23', '-pix_fmt', 'yuv420p'];
    }

    const aopts = canCopyAudio
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k', '-af', 'aresample=async=1'];

    const inputArgs = ['-fflags', '+genpts'];
    if (startT && startT !== '0') {
      inputArgs.push('-ss', startT);
    }

    const ffArgs = isLocal
      ? [...inputArgs, '-i', resolvedUrl, ...vopts, ...aopts, '-avoid_negative_ts', 'make_zero', '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moof', '-']
      : [...inputArgs, '-headers', `User-Agent: ${ua}\r\n`, '-i', resolvedUrl, ...vopts, ...aopts, '-avoid_negative_ts', 'make_zero', '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moof', '-'];

    const ff = spawn(FFMPEG, ffArgs);
    res.status(200).setHeader('Content-Type', 'video/mp4').setHeader('Cache-Control', 'no-cache');
    ff.stdout.pipe(res);
    ff.stderr.on('data', (d) => {
      console.error(`[FFmpeg Transcode Stderr]: ${d.toString().trim()}`);
    });
    ff.on('error', err => console.error('[ffmpeg]', err));
    req.on('close', () => ff.kill('SIGKILL'));
    return;
  }

  // Direct proxy
  try {
    const headers = { 'User-Agent': ua };
    if (req.headers.range) headers['range'] = req.headers.range;

    const response = await fetch(resolvedUrl, { headers, redirect: 'follow' });
    const ct = response.headers.get('content-type') || '';

    if (ct.includes('text/html')) {
      const html = await response.text();
      let code = 'ACCESS_DENIED';
      if (html.includes('Quota exceeded') || html.includes('quotaexceeded')) code = 'QUOTA_EXCEEDED';
      if (html.includes('sign in') || html.includes('Sign in')) code = 'AUTH_REQUIRED';
      res.status(code === 'QUOTA_EXCEEDED' ? 429 : 403)
         .setHeader('Content-Type', 'application/json')
         .json({ error: code });
      return;
    }

    res.status(response.status);
    ['content-type','content-length','content-range','accept-ranges','cache-control'].forEach(h => {
      const v = response.headers.get(h); if (v) res.setHeader(h, v);
    });
    res.setHeader('Accept-Ranges', 'bytes');
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (err) {
    console.error('[Stream]', err.message);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});


// Helper to read raw body for POST .torrent uploads
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', err => reject(err));
  });
}

// ─── /api/torrent/info ─────────────────────────────────────────────────────────
app.all('/api/torrent/info', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    let torrentSource;
    if (req.method === 'POST') {
      const buffer = await readRawBody(req);
      if (!buffer || buffer.length === 0) {
        res.status(400).json({ error: 'Empty POST body' });
        return;
      }
      torrentSource = buffer;
    } else {
      const { torrentUrl } = req.query;
      if (!torrentUrl) {
        res.status(400).json({ error: 'Missing torrentUrl parameter' });
        return;
      }
      torrentSource = torrentUrl;
    }

    const torrent = await addTorrent(torrentSource);
    const files = torrent.files.map((file, idx) => ({
      name: file.name,
      path: file.path,
      length: file.length,
      index: idx
    }));

    res.json({
      name: torrent.name,
      infoHash: torrent.infoHash,
      files
    });
  } catch (err) {
    console.error('[TorrentInfo Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/torrent/status ───────────────────────────────────────────────────────
app.get('/api/torrent/status', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { infoHash } = req.query;
  if (!infoHash) {
    res.status(400).json({ error: 'Missing infoHash parameter' });
    return;
  }

  const entry = activeTorrents.get(infoHash.toLowerCase());
  if (!entry) {
    res.status(404).json({ error: 'Torrent not active or cached' });
    return;
  }

  const { torrent } = entry;
  entry.lastAccessed = Date.now();

  res.json({
    name: torrent.name,
    infoHash: torrent.infoHash,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    numPeers: torrent.numPeers,
    progress: torrent.progress,
    downloaded: torrent.downloaded,
    length: torrent.length
  });
});

// ─── /api/torrent/stream ───────────────────────────────────────────────────────
app.get('/api/torrent/stream', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { infoHash, fileIndex } = req.query;
  if (!infoHash) {
    res.status(400).send('Missing infoHash parameter');
    return;
  }

  const idx = parseInt(fileIndex || '0', 10);

  try {
    const torrent = await addTorrent(infoHash);
    const file = torrent.files[idx];
    if (!file) {
      res.status(404).send('File not found in torrent');
      return;
    }

    const entry = activeTorrents.get(infoHash.toLowerCase());
    if (entry) entry.lastAccessed = Date.now();

    // Call file.select() so WebTorrent actively buffers this file in the background
    if (typeof file.select === 'function') {
      try {
        file.select();
      } catch (e) {
        console.error('[TorrentStream] Failed to select file:', e.message);
      }
    }

    res.setHeader('Accept-Ranges', 'bytes');
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg'
    };
    const ext = path.extname(file.name).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    let range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
      const chunksize = (end - start) + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.length}`);
      res.setHeader('Content-Length', chunksize);

      console.log(`[TorrentStream] Range stream: bytes ${start}-${end}/${file.length}`);
      const stream = file.createReadStream({ start, end });
      
      stream.on('error', (err) => {
        console.error('[TorrentStream Range Error]', err.message);
      });

      stream.pipe(res);

      req.on('close', () => {
        stream.destroy();
      });
    } else {
      res.status(200);
      res.setHeader('Content-Length', file.length);

      console.log(`[TorrentStream] Full stream`);
      const stream = file.createReadStream();

      stream.on('error', (err) => {
        console.error('[TorrentStream Full Error]', err.message);
      });

      stream.pipe(res);

      req.on('close', () => {
        stream.destroy();
      });
    }

  } catch (err) {
    console.error('[TorrentStream Error]', err.message);
    if (!res.headersSent) {
      res.status(500).send(err.message);
    }
  }
});

// ─── User Database & History Manager ──────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}));
}
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({}));
}

const activeSessions = new Map(); // key: sessionToken, value: { username, isAdmin, loginTime }

function verifyPassword(user, password) {
  if (user.salt) {
    const computed = crypto.createHash('sha256').update(password + user.salt).digest('hex');
    return user.passwordHash === computed;
  }
  if (user.password) {
    // Legacy migration
    const computedOld = crypto.createHash('sha256').update(password).digest('hex');
    if (user.password === computedOld) {
      // Upgrade to salt & passwordHash
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = crypto.createHash('sha256').update(password + salt).digest('hex');
      user.salt = salt;
      user.passwordHash = passwordHash;
      delete user.password;
      const users = getUsers();
      users[user.username] = user;
      saveUsers(users);
      return true;
    }
  }
  return false;
}

function syncAdminUser() {
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.warn('[AdminSync] ADMIN_PASSWORD environment variable not set. Admin user will not be initialized/updated.');
    return;
  }
  
  const users = getUsers();
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.createHash('sha256').update(adminPassword + salt).digest('hex');
  
  users[adminUsername] = {
    username: adminUsername,
    salt: salt,
    passwordHash: passwordHash,
    isAdmin: true,
    createdAt: users[adminUsername]?.createdAt || Date.now()
  };
  saveUsers(users);
  console.log(`[AdminSync] Admin user "${adminUsername}" synchronized successfully.`);
}

// Perform initial sync of admin user
syncAdminUser();

function getUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getHistories() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveHistories(histories) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(histories, null, 2));
}

function authenticateToken(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;
  const session = activeSessions.get(token);
  if (session) {
    return session.username;
  }
  return null;
}

function authenticateAdmin(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;
  const session = activeSessions.get(token);
  if (session && session.isAdmin) {
    return session;
  }
  return null;
}

// ─── Auth Endpoints ───────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const raw = await readRawBody(req);
    const { username, password } = JSON.parse(raw.toString() || '{}');

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const cleanUsername = username.trim();
    if (cleanUsername.length < 3 || cleanUsername.length > 20 || !/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      res.status(400).json({ error: 'Username must be alphanumeric (plus underscores) and between 3-20 characters' });
      return;
    }

    const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
    if (cleanUsername.toLowerCase() === adminUsername.toLowerCase()) {
      res.status(400).json({ error: 'Username is reserved' });
      return;
    }

    const users = getUsers();
    if (users[cleanUsername]) {
      res.status(400).json({ error: 'Username already exists' });
      return;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.createHash('sha256').update(password + salt).digest('hex');

    users[cleanUsername] = {
      username: cleanUsername,
      salt,
      passwordHash,
      createdAt: Date.now(),
      isAdmin: false
    };
    saveUsers(users);

    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, {
      username: cleanUsername,
      isAdmin: false,
      loginTime: Date.now()
    });

    res.json({ success: true, token, username: cleanUsername, isAdmin: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const raw = await readRawBody(req);
    const { username, password } = JSON.parse(raw.toString() || '{}');

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const cleanUsername = username.trim();
    const users = getUsers();
    const user = users[cleanUsername];

    if (!user || !verifyPassword(user, password)) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, {
      username: user.username,
      isAdmin: !!user.isAdmin,
      loginTime: Date.now()
    });

    res.json({ success: true, token, username: user.username, isAdmin: !!user.isAdmin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    activeSessions.delete(token);
  }
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const session = activeSessions.get(token);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({ username: session.username, isAdmin: !!session.isAdmin });
});

// ─── Admin Dashboard Endpoints ────────────────────────────────────────────────
app.get('/api/admin/status', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const adminSession = authenticateAdmin(req);
  if (!adminSession) {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }

  const uniqueUsers = new Set();
  for (const session of activeSessions.values()) {
    uniqueUsers.add(session.username);
  }

  const systemStats = {
    system: {
      platform: os.platform(),
      release: os.release(),
      uptime: os.uptime(),
      loadAvg: os.loadavg(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      nodeMem: process.memoryUsage(),
      nodeUptime: process.uptime()
    },
    activeUsers: uniqueUsers.size,
    activeTorrents: activeTorrents.size
  };

  res.json(systemStats);
});

app.get('/api/admin/users', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const adminSession = authenticateAdmin(req);
  if (!adminSession) {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }

  const users = getUsers();
  const histories = getHistories();
  const usersList = Object.keys(users).map(username => {
    const u = users[username];
    return {
      username: u.username,
      isAdmin: !!u.isAdmin,
      createdAt: u.createdAt,
      historyCount: (histories[username] || []).length
    };
  });

  res.json(usersList);
});

app.get('/api/admin/torrents', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const adminSession = authenticateAdmin(req);
  if (!adminSession) {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }

  const torrentsList = [];
  for (const [infoHash, entry] of activeTorrents.entries()) {
    const { torrent, lastAccessed } = entry;
    torrentsList.push({
      name: torrent.name,
      infoHash: torrent.infoHash,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      progress: torrent.progress,
      downloaded: torrent.downloaded,
      length: torrent.length,
      lastAccessed
    });
  }

  res.json(torrentsList);
});

app.delete('/api/admin/torrents/:infoHash', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const adminSession = authenticateAdmin(req);
  if (!adminSession) {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }

  const infoHash = req.params.infoHash.toLowerCase();
  const entry = activeTorrents.get(infoHash);
  if (!entry) {
    res.status(404).json({ error: 'Torrent not found' });
    return;
  }

  entry.torrent.destroy(() => {
    activeTorrents.delete(infoHash);
    res.json({ success: true, message: 'Torrent purged successfully' });
  });
});

app.delete('/api/admin/users/:username', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const adminSession = authenticateAdmin(req);
  if (!adminSession) {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }

  const targetUser = req.params.username.trim();
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();

  if (targetUser.toLowerCase() === adminSession.username.toLowerCase() || targetUser.toLowerCase() === adminUsername.toLowerCase()) {
    res.status(400).json({ error: 'Cannot delete the active admin account' });
    return;
  }

  const users = getUsers();
  if (!users[targetUser]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  delete users[targetUser];
  saveUsers(users);

  const histories = getHistories();
  delete histories[targetUser];
  saveHistories(histories);

  for (const [token, session] of activeSessions.entries()) {
    if (session.username.toLowerCase() === targetUser.toLowerCase()) {
      activeSessions.delete(token);
    }
  }

  res.json({ success: true, message: `User ${targetUser} deleted successfully` });
});

// ─── History Endpoints ────────────────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const username = authenticateToken(req);
  if (!username) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const histories = getHistories();
  const userHistory = histories[username] || [];
  res.json(userHistory);
});

app.post('/api/history', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const username = authenticateToken(req);
  if (!username) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const raw = await readRawBody(req);
    const { videoObj } = JSON.parse(raw.toString() || '{}');

    if (!videoObj || !videoObj.id) {
      res.status(400).json({ error: 'Invalid history payload' });
      return;
    }

    const histories = getHistories();
    let userHistory = histories[username] || [];

    // Remove existing duplicates
    userHistory = userHistory.filter(item => item.id !== videoObj.id);
    
    // Add to top of stack
    userHistory.unshift(videoObj);
    
    // Cap size at 50 entries
    if (userHistory.length > 50) {
      userHistory.pop();
    }

    histories[username] = userHistory;
    saveHistories(histories);

    res.json(userHistory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/history', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const username = authenticateToken(req);
  if (!username) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const histories = getHistories();
  histories[username] = [];
  saveHistories(histories);
  res.json([]);
});

app.delete('/api/history/:id', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const username = authenticateToken(req);
  if (!username) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const id = req.params.id;
  const histories = getHistories();
  let userHistory = histories[username] || [];
  userHistory = userHistory.filter(item => item.id !== id);
  histories[username] = userHistory;
  saveHistories(histories);
  res.json(userHistory);
});

app.put('/api/history/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const username = authenticateToken(req);
  if (!username) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const id = req.params.id;
    const raw = await readRawBody(req);
    const { title, currentTime, duration } = JSON.parse(raw.toString() || '{}');

    if (title === undefined && currentTime === undefined && duration === undefined) {
      res.status(400).json({ error: 'At least one field (title, currentTime, duration) is required' });
      return;
    }

    const histories = getHistories();
    const userHistory = histories[username] || [];
    const item = userHistory.find(item => item.id === id);
    if (item) {
      if (title !== undefined) item.title = title;
      if (currentTime !== undefined) item.currentTime = currentTime;
      if (duration !== undefined) item.duration = duration;
      histories[username] = userHistory;
      saveHistories(histories);
    }
    res.json(userHistory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Serve Vite frontend ───────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('/{*path}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

// ─── Start ─────────────────────────────────────────────────────────────────────
initTools().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 RawStream running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
