import { defineConfig } from 'vite';
import { Readable } from 'stream';
import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import os from 'os';
import WebTorrent from 'webtorrent';
import parseTorrent from 'parse-torrent';
import fs from 'fs';
import crypto from 'crypto';

const execPromise = util.promisify(exec);

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

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

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
  try {
    const username = Buffer.from(token, 'base64').toString('utf8');
    const users = getUsers();
    if (users[username]) {
      return username;
    }
  } catch (e) {
    return null;
  }
  return null;
}

// ─── Torrent Manager ───────────────────────────────────────────────────────────
let torrentClient = null;
const activeTorrents = new Map();

function getTorrentClient() {
  if (!torrentClient) {
    torrentClient = new WebTorrent();
    torrentClient.on('error', (err) => {
      console.error('[WebTorrent Dev Client Error]:', err.message);
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
    console.log(`[TorrentManager Dev] Destroying LRU torrent: ${entry.torrent.name || oldestKey}`);
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
      console.error('[TorrentManager Dev] parseTorrent failed:', err.message);
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
    console.log(`[TorrentManager Dev] Adding new torrent...`);
    let torrent;
    try {
      torrent = client.add(torrentSource, {
        path: path.join(os.tmpdir(), 'webtorrent')
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
      console.log(`[TorrentManager Dev] Torrent ready: ${torrent.name}`);
      resolve(torrent);
    });

    torrent.once('error', (err) => {
      console.error(`[TorrentManager Dev] Torrent error:`, err.message);
      if (torrent.infoHash) activeTorrents.delete(torrent.infoHash.toLowerCase());
      reject(err);
    });

    setTimeout(() => {
      if (!torrent.ready) {
        console.log('[TorrentManager Dev] Metadata timeout.');
        if (torrent.infoHash) activeTorrents.delete(torrent.infoHash.toLowerCase());
        torrent.destroy();
        reject(new Error('Metadata resolution timeout (no peers or slow connection)'));
      }
    }, 30000);
  });
}

// ─── Tool paths ───────────────────────────────────────────────────────────────
const YTDLP   = '/Users/abhishekmishra/miniconda3/bin/yt-dlp';
const FFMPEG  = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';

// ─── Active yt-dlp processes (so we can kill them on client disconnect) ───────
const activeProcesses = new Map();

export default defineConfig({
  server: {
    port: 3000,
    open: false
  },
  plugins: [
    {
      name: 'stream-proxy',
      configureServer(server) {

        // ─── /api/gdrive-stream ──────────────────────────────────────────────
        // Stream a Google Drive video by spawning yt-dlp with -o - (stdout pipe).
        // This bypasses download quotas and lets yt-dlp handle all auth headers,
        // IP binding, and signed-URL management internally.
        //
        // yt-dlp chooses the best MP4 format and Google transcodes MKV/HEVC
        // server-side, so the browser always gets a compatible video/mp4 stream.
        server.middlewares.use('/api/gdrive-stream', async (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          try {
            const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
            const fileId = reqUrl.searchParams.get('fileId');

            if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
              res.statusCode = 400;
              res.end('Missing or invalid fileId');
              return;
            }

            const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;

            // Optional seek offset (seconds) — use yt-dlp --download-sections for fast seeking
            const startSec = parseFloat(reqUrl.searchParams.get('start') || '0');
            
            // yt-dlp args: pipe video bytes to stdout in best MP4 format
            // -o -                      = write to stdout
            // -f best[ext=mp4]          = prefer native MP4 (Google transcodes MKV/HEVC server-side)
            // --no-playlist             = treat as single file
            // --no-part                 = no partial download temp files  
            // --quiet                   = suppress progress noise to stderr
            // --download-sections *T-   = start stream from T seconds (fast HTTP-range seek)
            const ytdlpArgs = [
              '-o', '-',
              '--no-playlist',
              '--no-part',
              '--quiet',
              '-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
            ];

            // Add time-offset section if seeking
            if (startSec > 0) {
              // Format: *HH:MM:SS- means "from this point to the end"
              const h = Math.floor(startSec / 3600);
              const m = Math.floor((startSec % 3600) / 60);
              const s = Math.floor(startSec % 60);
              const ts = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
              ytdlpArgs.push('--download-sections', `*${ts}-`);
              console.log(`[GDriveStream] Seeking to ${ts} for fileId: ${fileId}`);
            }

            ytdlpArgs.push(driveUrl);

            console.log(`[GDriveStream] Spawning yt-dlp for fileId: ${fileId}`);

            const ytProcess = spawn(YTDLP, ytdlpArgs);
            const processKey = `${fileId}-${Date.now()}`;
            activeProcesses.set(processKey, ytProcess);

            // Stream is raw MP4 bytes piped from yt-dlp
            res.statusCode = 200;
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Accept-Ranges', 'none'); // yt-dlp pipe does not support ranges
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('X-Content-Type-Options', 'nosniff');

            ytProcess.stdout.pipe(res);

            ytProcess.stderr.on('data', (data) => {
              const msg = data.toString().trim();
              if (msg && !msg.startsWith('WARNING:')) {
                console.error(`[yt-dlp stderr] ${msg}`);
              }
            });

            ytProcess.on('error', (err) => {
              console.error('[GDriveStream] yt-dlp process error:', err.message);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end('yt-dlp error: ' + err.message);
              }
            });

            ytProcess.on('close', (code) => {
              activeProcesses.delete(processKey);
              console.log(`[GDriveStream] yt-dlp exited with code ${code} for ${fileId}`);
            });

            // Kill yt-dlp when the browser disconnects (pause, seek, tab close)
            req.on('close', () => {
              if (!ytProcess.killed) {
                console.log(`[GDriveStream] Client disconnected. Killing yt-dlp for ${fileId}`);
                ytProcess.kill('SIGKILL');
              }
              activeProcesses.delete(processKey);
            });

          } catch (err) {
            console.error('[GDriveStream] Error:', err.message);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end('Stream error: ' + err.message);
            }
          }
        });

        // ─── /api/gdrive-meta ────────────────────────────────────────────────
        // Fetch video duration (in seconds) for a Google Drive file using yt-dlp.
        // Used by the frontend to show the total duration on the progress bar.
        server.middlewares.use('/api/gdrive-meta', async (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');

          try {
            const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
            const fileId = reqUrl.searchParams.get('fileId');

            if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid fileId' }));
              return;
            }

            const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
            // --print duration outputs the video duration in seconds as a float
            const { stdout } = await execPromise(
              `${YTDLP} --print duration --no-playlist --quiet "${driveUrl}"`,
              { timeout: 20000 }
            );
            const duration = parseFloat(stdout.trim());

            res.statusCode = 200;
            res.end(JSON.stringify({ duration: isNaN(duration) ? null : duration }));

          } catch (err) {
            console.error('[GDriveMeta] Error:', err.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        // ─── /api/resolve ────────────────────────────────────────────────────
        // Lightweight endpoint: just validate the fileId and return the proxy URL.
        // The actual streaming (and any quota handling) happens in /api/gdrive-stream.
        server.middlewares.use('/api/resolve', async (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');

          try {
            const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
            const fileId = reqUrl.searchParams.get('fileId');

            if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing or invalid fileId parameter' }));
              return;
            }

            // Quick sanity-check: run yt-dlp --get-title to verify file is accessible
            const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
            try {
              await execPromise(`${YTDLP} --get-title --no-playlist --quiet "${driveUrl}"`, { timeout: 20000 });
            } catch (checkErr) {
              const errMsg = checkErr.stderr || checkErr.message || '';
              if (errMsg.includes('Private') || errMsg.includes('403') || errMsg.includes('not available')) {
                res.statusCode = 403;
                res.end(JSON.stringify({ error: 'File is private or restricted. Set sharing to "Anyone with the link".' }));
                return;
              }
              // Allow through even if title check fails — stream will reveal real errors
            }

            res.statusCode = 200;
            res.end(JSON.stringify({
              streamUrl: `/api/gdrive-stream?fileId=${encodeURIComponent(fileId)}`
            }));

          } catch (err) {
            console.error('[Resolve] Error:', err.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });


        // Helper to read raw body for POST .torrent uploads
        const readRawBody = (req) => {
          return new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', err => reject(err));
          });
        };

        // ─── /api/torrent/info ─────────────────────────────────────────────────
        server.middlewares.use('/api/torrent/info', async (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');

          try {
            let torrentSource;
            if (req.method === 'POST') {
              const buffer = await readRawBody(req);
              if (!buffer || buffer.length === 0) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Empty POST body' }));
                return;
              }
              torrentSource = buffer;
            } else {
              const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
              const torrentUrl = reqUrl.searchParams.get('torrentUrl');
              if (!torrentUrl) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Missing torrentUrl parameter' }));
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

            res.statusCode = 200;
            res.end(JSON.stringify({
              name: torrent.name,
              infoHash: torrent.infoHash,
              files
            }));
          } catch (err) {
            console.error('[TorrentInfo Dev Error]', err.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        // ─── /api/torrent/status ───────────────────────────────────────────────
        server.middlewares.use('/api/torrent/status', (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');

          try {
            const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
            const infoHash = reqUrl.searchParams.get('infoHash');

            if (!infoHash) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing infoHash parameter' }));
              return;
            }

            const entry = activeTorrents.get(infoHash.toLowerCase());
            if (!entry) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Torrent not active or cached' }));
              return;
            }

            const { torrent } = entry;
            entry.lastAccessed = Date.now();

            res.statusCode = 200;
            res.end(JSON.stringify({
              name: torrent.name,
              infoHash: torrent.infoHash,
              downloadSpeed: torrent.downloadSpeed,
              uploadSpeed: torrent.uploadSpeed,
              numPeers: torrent.numPeers,
              progress: torrent.progress,
              downloaded: torrent.downloaded,
              length: torrent.length
            }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        // ─── /api/torrent/stream ───────────────────────────────────────────────
        server.middlewares.use('/api/torrent/stream', async (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');

          try {
            const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
            const infoHash = reqUrl.searchParams.get('infoHash');
            const fileIndex = reqUrl.searchParams.get('fileIndex');

            if (!infoHash) {
              res.statusCode = 400;
              res.end('Missing infoHash parameter');
              return;
            }

            const idx = parseInt(fileIndex || '0', 10);
            const torrent = await addTorrent(infoHash);
            const file = torrent.files[idx];
            if (!file) {
              res.statusCode = 404;
              res.end('File not found in torrent');
              return;
            }

            const entry = activeTorrents.get(infoHash.toLowerCase());
            if (entry) entry.lastAccessed = Date.now();

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

              res.statusCode = 206;
              res.setHeader('Content-Range', `bytes ${start}-${end}/${file.length}`);
              res.setHeader('Content-Length', chunksize);

              console.log(`[TorrentStream Dev] Range stream: bytes ${start}-${end}/${file.length}`);
              const stream = file.createReadStream({ start, end });

              stream.on('error', (err) => {
                console.error('[TorrentStream Dev Range Error]', err.message);
              });

              stream.pipe(res);

              req.on('close', () => {
                stream.destroy();
              });
            } else {
              res.statusCode = 200;
              res.setHeader('Content-Length', file.length);

              console.log(`[TorrentStream Dev] Full stream`);
              const stream = file.createReadStream();

              stream.on('error', (err) => {
                console.error('[TorrentStream Dev Full Error]', err.message);
              });

              stream.pipe(res);

              req.on('close', () => {
                stream.destroy();
              });
            }

          } catch (err) {
            console.error('[TorrentStream Dev Error]', err.message);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end(err.message);
            }
          }
        });

        // ─── /api/probe ──────────────────────────────────────────────────────
        // Probe for video codecs and metadata via ffprobe (used for OneDrive/local)
        server.middlewares.use('/api/probe', async (req, res) => {
          try {
            const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
            const targetUrl = reqUrl.searchParams.get('url');

            if (!targetUrl) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({ error: 'Missing url query parameter' }));
              return;
            }

            let resolvedUrl = targetUrl;
            if (targetUrl.startsWith('/')) {
              if (targetUrl.startsWith('/api/')) {
                const host = req.headers.host || '127.0.0.1:3000';
                resolvedUrl = `http://${host}${targetUrl}`;
              }
            }

            const isLocal = resolvedUrl.startsWith('/');

            if (!isLocal) {
              const allowedDomains = [
                'drive.google.com', 'drive.usercontent.google.com', 'docs.google.com',
                'googlevideo.com', 'c.drive.google.com',
                'api.onedrive.com', 'onedrive.live.com', '1drv.ms', 'localhost', '127.0.0.1'
              ];
              const targetObj = new URL(resolvedUrl);
              const isAllowed = allowedDomains.some(d =>
                targetObj.hostname === d || targetObj.hostname.endsWith('.' + d)
              );
              if (!isAllowed) {
                res.statusCode = 403;
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ error: 'Forbidden: Domain not allowed' }));
                return;
              }
            }

            const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
            const cmd = isLocal
              ? `${FFPROBE} -v error -show_format -show_streams -of json "${resolvedUrl.replace(/"/g, '\\"')}"`
              : `${FFPROBE} -v error -show_format -show_streams -headers "User-Agent: ${userAgent}\r\n" -of json "${resolvedUrl.replace(/"/g, '\\"')}"`;

            const { stdout } = await execPromise(cmd, { timeout: 20000 });
            const metadata = JSON.parse(stdout);

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

            const container = metadata.format.format_name || '';
            const videoCodec = videoStream ? videoStream.codec_name : '';
            const audioCodec = audioStream ? audioStream.codec_name : '';
            const duration = parseFloat(metadata.format.duration) || 0;

            const supportedContainers = ['mp4', 'mov', 'webm', 'ogg', 'isom'];
            const supportedVideoCodecs = ['h264', 'vp8', 'vp9', 'av1'];
            const supportedAudioCodecs = ['aac', 'mp3', 'opus', 'vorbis'];

            const containerSupported = supportedContainers.some(c => container.toLowerCase().includes(c));
            const videoSupported = supportedVideoCodecs.includes(videoCodec.toLowerCase());
            const audioSupported = supportedAudioCodecs.includes(audioCodec.toLowerCase());
            const needsTranscode = !containerSupported || !videoSupported || !audioSupported;

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ needsTranscode, container, videoCodec, audioCodec, duration, videoSupported, audioSupported, containerSupported }));

          } catch (err) {
            console.error('[Probe Dev] Error probing URL:', err.message);

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
                console.error('[Probe Dev] Failed to parse torrent info for fallback:', e.message);
              }

              console.log(`[Probe Dev] Torrent probe failed/timed out. Applying smart fallback for ext: ${torrentExt}`);
              const isMkv = torrentExt === '.mkv' || torrentExt === '.avi' || torrentExt === '.ts';
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({
                needsTranscode: true,
                container: isMkv ? 'mkv' : 'mp4',
                videoCodec: 'h264',
                audioCodec: 'ac3',
                duration: 0,
                videoSupported: true,
                audioSupported: false,
                containerSupported: !isMkv
              }));
              return;
            }

            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ error: 'Probe failed: ' + err.message }));
          }
        });

        // ─── /api/stream ─────────────────────────────────────────────────────
        // Streaming proxy / transcoder for OneDrive and local files
        server.middlewares.use('/api/stream', async (req, res) => {
          try {
            const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
            const targetUrl = reqUrl.searchParams.get('url');

            if (!targetUrl) {
              res.statusCode = 400;
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end('Missing url query parameter');
              return;
            }

            let resolvedUrl = targetUrl;
            if (targetUrl.startsWith('/')) {
              if (targetUrl.startsWith('/api/')) {
                resolvedUrl = `http://127.0.0.1:3000${targetUrl}`;
              }
            }

            const isLocal = resolvedUrl.startsWith('/');

            if (isLocal) {
              const fs = await import('fs');
              if (!fs.existsSync(resolvedUrl)) {
                res.statusCode = 404;
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end('Local file not found');
                return;
              }
            } else {
              const allowedDomains = [
                'drive.google.com', 'drive.usercontent.google.com', 'docs.google.com',
                'googlevideo.com', 'c.drive.google.com',
                'api.onedrive.com', 'onedrive.live.com', '1drv.ms', 'localhost', '127.0.0.1'
              ];
              const targetObj = new URL(resolvedUrl);
              const isAllowed = allowedDomains.some(d =>
                targetObj.hostname === d || targetObj.hostname.endsWith('.' + d)
              );
              if (!isAllowed) {
                res.statusCode = 403;
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end('Forbidden: Domain not allowed');
                return;
              }
            }

            const transcode = reqUrl.searchParams.get('transcode') === 'true';
            const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

            // --- Case A: Transcode via ffmpeg ---
            if (transcode) {
              const start  = reqUrl.searchParams.get('start')  || '0';
              const vcodec = reqUrl.searchParams.get('vcodec') || '';
              const acodec = reqUrl.searchParams.get('acodec') || '';

              const supportedVideoCodecs = ['h264', 'vp8', 'vp9', 'av1'];
              const supportedAudioCodecs = ['aac', 'mp3', 'opus', 'vorbis'];

              const vopts = supportedVideoCodecs.includes(vcodec.toLowerCase())
                ? ['-c:v', 'copy']
                : ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23'];

              const aopts = supportedAudioCodecs.includes(acodec.toLowerCase())
                ? ['-c:a', 'copy']
                : ['-c:a', 'aac', '-b:a', '192k'];

              const ffmpegArgs = isLocal
                ? ['-ss', start, '-i', resolvedUrl, ...vopts, ...aopts, '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moov', '-']
                : ['-ss', start, '-headers', `User-Agent: ${userAgent}\r\n`, '-i', resolvedUrl, ...vopts, ...aopts, '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moov', '-'];

              const ffmpegProcess = spawn(FFMPEG, ffmpegArgs);

              res.statusCode = 200;
              res.setHeader('Content-Type', 'video/mp4');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Cache-Control', 'no-cache');

              ffmpegProcess.stdout.pipe(res);
              ffmpegProcess.stderr.on('data', () => {});
              ffmpegProcess.on('error', (err) => console.error('[ffmpeg]', err));
              req.on('close', () => ffmpegProcess.kill('SIGKILL'));
              return;
            }

            // --- Case B: Direct Proxy ---
            const headers = { 'User-Agent': userAgent };
            if (req.headers.range) headers['range'] = req.headers.range;

            const response = await fetch(resolvedUrl, { headers, redirect: 'follow' });
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('text/html')) {
              const htmlText = await response.text();
              let errCode = 'ACCESS_DENIED';
              if (htmlText.includes('Quota exceeded') || htmlText.includes('quotaexceeded')) errCode = 'QUOTA_EXCEEDED';
              if (htmlText.includes('sign in') || htmlText.includes('Sign in')) errCode = 'AUTH_REQUIRED';
              res.statusCode = errCode === 'QUOTA_EXCEEDED' ? 429 : 403;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({ error: errCode }));
              return;
            }

            res.statusCode = response.status;
            ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'content-disposition'].forEach(h => {
              const val = response.headers.get(h);
              if (val) res.setHeader(h, val);
            });
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Accept-Ranges', 'bytes');

            if (req.method === 'OPTIONS' || req.method === 'HEAD') { res.end(); return; }
            if (response.body) Readable.fromWeb(response.body).pipe(res);
            else res.end();

          } catch (err) {
            console.error('Stream proxy error:', err);
            res.statusCode = 500;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end('Internal Server Error: ' + err.message);
          }
        });

        // ─── Auth Endpoints (Dev) ────────────────────────────────────────────────────
        server.middlewares.use('/api/auth/register', async (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          try {
            const raw = await readRawBody(req);
            const { username, password } = JSON.parse(raw.toString() || '{}');

            if (!username || !password) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Username and password are required' }));
              return;
            }

            const cleanUsername = username.trim();
            if (cleanUsername.length < 3 || cleanUsername.length > 20 || !/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Username must be alphanumeric (plus underscores) and between 3-20 characters' }));
              return;
            }

            const users = getUsers();
            if (users[cleanUsername]) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Username already exists' }));
              return;
            }

            users[cleanUsername] = {
              username: cleanUsername,
              password: hashPassword(password),
              createdAt: Date.now()
            };
            saveUsers(users);

            const token = Buffer.from(cleanUsername).toString('base64');
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, token, username: cleanUsername }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        server.middlewares.use('/api/auth/login', async (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          try {
            const raw = await readRawBody(req);
            const { username, password } = JSON.parse(raw.toString() || '{}');

            if (!username || !password) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Username and password are required' }));
              return;
            }

            const cleanUsername = username.trim();
            const users = getUsers();
            const user = users[cleanUsername];

            if (!user || user.password !== hashPassword(password)) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: 'Invalid username or password' }));
              return;
            }

            const token = Buffer.from(cleanUsername).toString('base64');
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, token, username: cleanUsername }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        server.middlewares.use('/api/auth/logout', (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.statusCode = 200;
          res.end(JSON.stringify({ success: true }));
        });

        server.middlewares.use('/api/auth/me', (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          const username = authenticateToken(req);
          if (!username) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify({ username }));
        });

        // ─── History Endpoints (Dev) ─────────────────────────────────────────────────
        server.middlewares.use('/api/history', async (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          
          const username = authenticateToken(req);
          if (!username) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }

          const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);

          if (req.method === 'GET') {
            const histories = getHistories();
            const userHistory = histories[username] || [];
            res.statusCode = 200;
            res.end(JSON.stringify(userHistory));
            return;
          }

          if (req.method === 'POST') {
            try {
              const raw = await readRawBody(req);
              const { videoObj } = JSON.parse(raw.toString() || '{}');

              if (!videoObj || !videoObj.id) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid history payload' }));
                return;
              }

              const histories = getHistories();
              let userHistory = histories[username] || [];

              userHistory = userHistory.filter(item => item.id !== videoObj.id);
              userHistory.unshift(videoObj);

              if (userHistory.length > 50) {
                userHistory.pop();
              }

              histories[username] = userHistory;
              saveHistories(histories);

              res.statusCode = 200;
              res.end(JSON.stringify(userHistory));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }

          if (req.method === 'DELETE') {
            const pathParts = req.url.split('/');
            const id = pathParts[1];

            if (id && id !== '') {
              const histories = getHistories();
              let userHistory = histories[username] || [];
              userHistory = userHistory.filter(item => item.id !== id);
              histories[username] = userHistory;
              saveHistories(histories);
              res.statusCode = 200;
              res.end(JSON.stringify(userHistory));
            } else {
              const histories = getHistories();
              histories[username] = [];
              saveHistories(histories);
              res.statusCode = 200;
              res.end(JSON.stringify([]));
            }
            return;
          }

          if (req.method === 'PUT') {
            const pathParts = req.url.split('/');
            const id = pathParts[1];
            if (!id) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'ID is required' }));
              return;
            }
            try {
              const raw = await readRawBody(req);
              const { title } = JSON.parse(raw.toString() || '{}');

              if (!title) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Title is required' }));
                return;
              }

              const histories = getHistories();
              const userHistory = histories[username] || [];
              const item = userHistory.find(item => item.id === id);
              if (item) {
                item.title = title;
                histories[username] = userHistory;
                saveHistories(histories);
              }
              res.statusCode = 200;
              res.end(JSON.stringify(userHistory));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }

          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        });
      }
    }
  ]
});
