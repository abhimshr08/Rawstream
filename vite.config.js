import { defineConfig } from 'vite';
import { Readable } from 'stream';
import { exec, spawn } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

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

            const isLocal = targetUrl.startsWith('/');

            if (!isLocal) {
              const allowedDomains = [
                'drive.google.com', 'drive.usercontent.google.com', 'docs.google.com',
                'googlevideo.com', 'c.drive.google.com',
                'api.onedrive.com', 'onedrive.live.com', '1drv.ms'
              ];
              const targetObj = new URL(targetUrl);
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
              ? `${FFPROBE} -v error -show_format -show_streams -of json "${targetUrl.replace(/"/g, '\\"')}"`
              : `${FFPROBE} -v error -show_format -show_streams -headers "User-Agent: ${userAgent}\r\n" -of json "${targetUrl.replace(/"/g, '\\"')}"`;

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
            console.error('Probe error:', err);
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

            const isLocal = targetUrl.startsWith('/');

            if (isLocal) {
              const fs = await import('fs');
              if (!fs.existsSync(targetUrl)) {
                res.statusCode = 404;
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end('Local file not found');
                return;
              }
            } else {
              const allowedDomains = [
                'drive.google.com', 'drive.usercontent.google.com', 'docs.google.com',
                'googlevideo.com', 'c.drive.google.com',
                'api.onedrive.com', 'onedrive.live.com', '1drv.ms'
              ];
              const targetObj = new URL(targetUrl);
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
                ? ['-ss', start, '-i', targetUrl, ...vopts, ...aopts, '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moov', '-']
                : ['-ss', start, '-headers', `User-Agent: ${userAgent}\r\n`, '-i', targetUrl, ...vopts, ...aopts, '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moov', '-'];

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

            const response = await fetch(targetUrl, { headers, redirect: 'follow' });
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
      }
    }
  ]
});
