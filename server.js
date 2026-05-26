/**
 * CloudStream — Production Server
 * Serves the Vite-built frontend and all /api/* streaming endpoints.
 * Works on any host that has yt-dlp and ffmpeg in PATH (or set via env vars).
 */

import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { Readable } from 'stream';
import { exec, spawn } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

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

  const isLocal = targetUrl.startsWith('/');
  if (!isLocal) {
    const allowed = ['drive.google.com','googlevideo.com','api.onedrive.com','onedrive.live.com','1drv.ms'];
    try {
      const host = new URL(targetUrl).hostname;
      if (!allowed.some(d => host === d || host.endsWith('.' + d))) {
        res.status(403).json({ error: 'Domain not allowed' }); return;
      }
    } catch { res.status(400).json({ error: 'Invalid URL' }); return; }
  }

  try {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    const cmd = isLocal
      ? `${FFPROBE} -v error -show_format -show_streams -of json "${targetUrl}"`
      : `${FFPROBE} -v error -show_format -show_streams -headers "User-Agent: ${ua}\\r\\n" -of json "${targetUrl}"`;

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
    console.error('[Probe]', err.message);
    res.status(500).json({ error: 'Probe failed: ' + err.message });
  }
});

// ─── /api/stream ───────────────────────────────────────────────────────────────
// Proxy / transcode OneDrive or local files.
app.get('/api/stream', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url: targetUrl, transcode, start, vcodec, acodec } = req.query;
  if (!targetUrl) { res.status(400).send('Missing url'); return; }

  const isLocal = targetUrl.startsWith('/');
  if (!isLocal) {
    const allowed = ['drive.google.com','googlevideo.com','api.onedrive.com','onedrive.live.com','1drv.ms'];
    try {
      const host = new URL(targetUrl).hostname;
      if (!allowed.some(d => host === d || host.endsWith('.' + d))) {
        res.status(403).send('Domain not allowed'); return;
      }
    } catch { res.status(400).send('Invalid URL'); return; }
  }

  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

  if (transcode === 'true') {
    const startT = start || '0';
    const supportedVideo = ['h264','vp8','vp9','av1'];
    const supportedAudio = ['aac','mp3','opus','vorbis'];

    const vopts = supportedVideo.includes((vcodec || '').toLowerCase())
      ? ['-c:v','copy']
      : ['-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-crf','23'];

    const aopts = supportedAudio.includes((acodec || '').toLowerCase())
      ? ['-c:a','copy']
      : ['-c:a','aac','-b:a','192k'];

    const ffArgs = isLocal
      ? ['-ss', startT, '-i', targetUrl, ...vopts, ...aopts, '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moov', '-']
      : ['-ss', startT, '-headers', `User-Agent: ${ua}\r\n`, '-i', targetUrl, ...vopts, ...aopts, '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moov', '-'];

    const ff = spawn(FFMPEG, ffArgs);
    res.status(200).setHeader('Content-Type', 'video/mp4').setHeader('Cache-Control', 'no-cache');
    ff.stdout.pipe(res);
    ff.stderr.on('data', () => {});
    ff.on('error', err => console.error('[ffmpeg]', err));
    req.on('close', () => ff.kill('SIGKILL'));
    return;
  }

  // Direct proxy
  try {
    const headers = { 'User-Agent': ua };
    if (req.headers.range) headers['range'] = req.headers.range;

    const response = await fetch(targetUrl, { headers, redirect: 'follow' });
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

// ─── Serve Vite frontend ───────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('/{*path}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

// ─── Start ─────────────────────────────────────────────────────────────────────
initTools().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 CloudStream running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
