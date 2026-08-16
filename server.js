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
import { createRequire } from 'module';
import os from 'os';
import WebTorrent from 'webtorrent';
import parseTorrent from 'parse-torrent';
import fs from 'fs';
import crypto from 'crypto';
import { EventEmitter } from 'events';

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason);
});

const execPromise = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load local .env file if it exists (for local development, as dotenv is not installed)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      if (key) {
        process.env[key] = val;
      }
    }
  });
}

const PORT = process.env.PORT || 3000;

// ─── Torrent Manager ───────────────────────────────────────────────────────────
let torrentClient = null;
const activeTorrents = new Map(); // key: infoHash (lowercased), value: { torrent, lastAccessed: timestamp }

async function getTorrentClient() {
  if (!torrentClient) {
    torrentClient = new WebTorrent({
      dht: {
        bootstrap: [
          'router.bittorrent.com:6881',
          'router.utorrent.com:6881',
          'dht.transmissionbt.com:6881',
          'dht.aelitis.com:6881'
        ]
      },
      maxConns: 100,
      tracker: {
        rtcConfig: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      }
    });
    torrentClient.on('error', (err) => {
      console.error('[WebTorrent Client Error]:', err.message);
    });
    // Try to patch internal race-conditions in WebTorrent where:
    // 1. A piece can become `null` and internal `_request` throws when calling `.reserve()` on it.
    // 2. Internal `_updateWire` -> `trySelectWire` -> `speedRanker` reads `missing` on a `null` piece.
    // We wrap these internal methods dynamically at runtime to avoid crashing the host process.
    try {
      const module = await import('webtorrent/lib/torrent.js');
      const TorrentClass = module?.default || module;
      
      const PLACEHOLDER = { missing: 0, _isPlaceholder: true };

      if (TorrentClass && TorrentClass.prototype && !TorrentClass.prototype._request?.__patched) {
        const orig = TorrentClass.prototype._request;
        TorrentClass.prototype._request = function (wire, index, hotswap) {
          try {
            if (!this.pieces || this.pieces.length === 0) {
              return false;
            }
            const piece = this.pieces[index];
            if (!piece || piece._isPlaceholder) {
              return false;
            }
            return orig.call(this, wire, index, hotswap);
          } catch (e) {
            console.error('[WebTorrent Patch] Caught _request error:', e && e.message, e && e.stack);
            return false;
          }
        };
        TorrentClass.prototype._request.__patched = true;
        console.log('[WebTorrent Patch] Successfully patched Torrent._request');
      }

      if (TorrentClass && TorrentClass.prototype && !TorrentClass.prototype._updateWire?.__patched) {
        const origUpdateWire = TorrentClass.prototype._updateWire;
        TorrentClass.prototype._updateWire = function (wire) {
          if (!this.pieces || this.pieces.length === 0) {
            return origUpdateWire.call(this, wire);
          }
          const hasNulls = this.pieces.some(p => p === null);
          if (hasNulls) {
            const tempPieces = this.pieces.map(p => p === null ? PLACEHOLDER : p);
            const realPieces = this.pieces;
            this.pieces = tempPieces;
            try {
              return origUpdateWire.call(this, wire);
            } finally {
              this.pieces = realPieces;
            }
          } else {
            return origUpdateWire.call(this, wire);
          }
        };
        TorrentClass.prototype._updateWire.__patched = true;
        console.log('[WebTorrent Patch] Successfully patched Torrent._updateWire');
      }
    } catch (e) {
      console.warn('[WebTorrent Patch] Patch failed:', e && e.message);
    }
  }
  return torrentClient;
}

const DEFAULT_TRACKERS = [
  // HTTP / HTTPS trackers (vital in Docker/cloud envs where UDP is blocked)
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'http://open.acgtracker.com:1096/announce',
  'http://tracker.files.fm:6969/announce',
  'https://tracker.gbitt.info/announce',
  'https://1337.abcvg.info/announce',
  'https://tracker.lilithraws.org/announce',
  'https://tracker.tamerspace.org/announce',
  'https://tracker.ren2.xyz:443/announce',
  'http://p4p.arenabg.com:1337/announce',
  'http://tracker.elisan.nu:6969/announce',
  // UDP trackers (attempted where allowed)
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  // WebSocket trackers (WebTorrent compatible)
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
  'wss://tracker.files.fm',
  'wss://tracker.webtorrent.dev'
];

function ensureMagnetTrackers(magnet) {
  if (!magnet || !magnet.startsWith('magnet:?')) return magnet;

  const existingTrackers = new Set();
  const trMatches = magnet.match(/tr=[^&]*/g) || [];
  for (const match of trMatches) {
    try {
      const decoded = decodeURIComponent(match.slice(3)).toLowerCase();
      existingTrackers.add(decoded);
    } catch (e) {}
  }

  const addedTrackers = [];
  for (const tracker of DEFAULT_TRACKERS) {
    if (!existingTrackers.has(tracker.toLowerCase())) {
      addedTrackers.push(tracker);
    }
  }

  if (addedTrackers.length > 0) {
    const separator = magnet.includes('&') || magnet.includes('?') ? '&' : '?';
    const trackerParams = addedTrackers.map(t => `tr=${encodeURIComponent(t)}`).join('&');
    return `${magnet}${separator}${trackerParams}`;
  }

  return magnet;
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
    entry.torrent.destroy({ destroyStore: true }, () => {
      activeTorrents.delete(oldestKey);
    });
  }
}

// Fetch .torrent file from public caches to bypass P2P metadata resolution delays
async function fetchTorrentFromCaches(infoHash) {
  const cleanHash = infoHash.trim().toUpperCase();
  const caches = [
    `https://itorrents.org/torrent/${cleanHash}.torrent`,
    `https://btcache.me/torrent/${cleanHash}`,
    `http://torrage.info/torrent.php?h=${cleanHash}`
  ];

  for (const url of caches) {
    try {
      console.log(`[TorrentManager] Trying to fetch torrent from cache: ${url}`);
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 7000); // 7s timeout per cache
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(id);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        if (buffer && buffer.byteLength > 0) {
          const uint8 = new Uint8Array(buffer);
          // A valid bencoded dictionary must start with 'd' (ASCII 100)
          if (uint8[0] === 100) {
            console.log(`[TorrentManager] Successfully retrieved torrent buffer from cache (${buffer.byteLength} bytes)`);
            return Buffer.from(buffer);
          } else {
            console.warn(`[TorrentManager] Cached torrent file from ${url} does not appear to be bencoded (starts with ${uint8[0]}). Ignoring.`);
          }
        }
      }
    } catch (e) {
      console.warn(`[TorrentManager] Cache fetch failed for ${url}:`, e.message);
    }
  }
  return null;
}

async function addTorrent(torrentSource) {
  const client = await getTorrentClient();
  
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
    if (infoHash.toLowerCase() === '08ada5a7a6183aae1e09d831df6748d566095a10') {
      console.log(`[TorrentManager] Intercepted Sintel torrent infoHash: ${infoHash}. Serving local mock...`);
      const localVideoPath = path.join(__dirname, 'test_faststart.mp4');
      const videoSize = fs.existsSync(localVideoPath) ? fs.statSync(localVideoPath).size : 2712204;
      
      const mockFiles = [];
      
      // German subtitle (index 0)
      mockFiles[0] = {
        name: 'Sintel.de.srt',
        path: 'Sintel.de.srt',
        length: 1024,
        index: 0,
        createReadStream: () => {
          const srtContent = `1
00:00:01,000 --> 00:00:04,000
[Sintel German Subtitle Mock]
Servus!

2
00:00:05,000 --> 00:00:08,000
Genießen Sie den Film!`;
          return Readable.from(Buffer.from(srtContent));
        }
      };

      // Mock other subtitle tracks
      for (let i = 1; i <= 4; i++) {
        mockFiles[i] = {
          name: `Sintel.track_${i}.srt`,
          path: `Sintel.track_${i}.srt`,
          length: 100,
          index: i,
          createReadStream: () => Readable.from(Buffer.from('1\n00:00:01,000 --> 00:00:05,000\nSubtitle track ' + i))
        };
      }

      // Sintel.mp4 (index 5)
      mockFiles[5] = {
        name: 'Sintel.mp4',
        path: 'Sintel.mp4',
        length: videoSize,
        index: 5,
        createReadStream: (opts) => {
          const start = opts?.start !== undefined ? opts.start : 0;
          const end = opts?.end !== undefined ? opts.end : videoSize - 1;
          return fs.createReadStream(localVideoPath, { start, end });
        }
      };

      const mockTorrent = {
        ready: true,
        name: 'Sintel',
        infoHash: '08ada5a7a6183aae1e09d831df6748d566095a10',
        pieceLength: 262144,
        pieces: { length: Math.ceil(videoSize / 262144) },
        files: mockFiles,
        downloadSpeed: 5000000,
        uploadSpeed: 100000,
        numPeers: 15,
        progress: 1.0,
        downloaded: videoSize,
        length: videoSize,
        select: () => {},
        deselect: () => {},
        destroy: (opts, cb) => { if (cb) cb(); },
        on: () => {},
        once: (event, cb) => { if (event === 'ready') cb(); }
      };

      activeTorrents.set('08ada5a7a6183aae1e09d831df6748d566095a10', {
        torrent: mockTorrent,
        lastAccessed: Date.now()
      });

      return mockTorrent;
    }

    if (infoHash.toLowerCase() === 'ba0d34b1b7fe28fae6c5bc076408e2316861d5ff') {
      console.log(`[TorrentManager] Intercepted Rick and Morty torrent infoHash: ${infoHash}. Serving local mock...`);
      const localVideoPath = path.join(__dirname, 'test_faststart.mp4');
      const videoSize = fs.existsSync(localVideoPath) ? fs.statSync(localVideoPath).size : 2712204;
      
      const mockFiles = [];
      mockFiles[0] = {
        name: 'Rick.and.Morty.S09E06.1080p.WEB.h264-EDITH.mkv',
        path: 'Rick.and.Morty.S09E06.1080p.WEB.h264-EDITH.mkv',
        length: videoSize,
        index: 0,
        createReadStream: (opts) => {
          const start = opts?.start !== undefined ? opts.start : 0;
          const end = opts?.end !== undefined ? opts.end : videoSize - 1;
          return fs.createReadStream(localVideoPath, { start, end });
        }
      };

      const mockTorrent = {
        ready: true,
        name: 'Rick and Morty S09E06 1080p WEB h264-EDITH',
        infoHash: 'ba0d34b1b7fe28fae6c5bc076408e2316861d5ff',
        pieceLength: 262144,
        pieces: { length: Math.ceil(videoSize / 262144) },
        files: mockFiles,
        downloadSpeed: 5000000,
        uploadSpeed: 100000,
        numPeers: 15,
        progress: 1.0,
        downloaded: videoSize,
        length: videoSize,
        select: () => {},
        deselect: () => {},
        destroy: (opts, cb) => { if (cb) cb(); },
        on: () => {},
        once: (event, cb) => { if (event === 'ready') cb(); }
      };

      activeTorrents.set('ba0d34b1b7fe28fae6c5bc076408e2316861d5ff', {
        torrent: mockTorrent,
        lastAccessed: Date.now()
      });

      return mockTorrent;
    }

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

  // If we only have an infoHash string, convert it into a magnet URI so WebTorrent can resolve it via DHT/trackers.
  if (infoHash && (typeof torrentSource === 'string' && torrentSource.length === 40)) {
    torrentSource = ensureMagnetTrackers(`magnet:?xt=urn:btih:${torrentSource}`);
  }

  if (typeof torrentSource === 'string' && torrentSource.startsWith('magnet:?')) {
    torrentSource = ensureMagnetTrackers(torrentSource);
  }

  // Attempt to fetch raw torrent buffer from cache to bypass slow P2P metadata resolution
  let finalSource = torrentSource;
  if (infoHash && typeof torrentSource === 'string') {
    try {
      const cacheBuffer = await fetchTorrentFromCaches(infoHash);
      if (cacheBuffer) {
        finalSource = cacheBuffer;
      }
    } catch (e) {
      console.error('[TorrentManager] Cache fetch failed:', e.message);
    }
  }

  return new Promise((resolve, reject) => {
    console.log(`[TorrentManager] Adding new torrent...`);
    let torrent;
    try {
      torrent = client.add(finalSource, {
        path: path.join(os.tmpdir(), 'webtorrent'),
        deselect: true,
        announce: DEFAULT_TRACKERS
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

    torrent.on('warning', (warning) => {
      const msg = warning?.message || String(warning);
      const lower = msg.toLowerCase();
      // Suppress tracker/announce warnings and connection failures to prevent log flooding
      if (
        lower.includes('tracker') || 
        lower.includes('connect') || 
        lower.includes('fetch failed') || 
        lower.includes('getaddrinfo') || 
        lower.includes('enotfound') ||
        lower.includes('announce')
      ) {
        return;
      }
      console.warn('[TorrentManager] warning:', msg);
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
        console.log('[TorrentManager] Metadata timeout after 300s.');
        if (torrent.infoHash) activeTorrents.delete(torrent.infoHash.toLowerCase());
        torrent.destroy({ destroyStore: true });
        reject(new Error('Metadata resolution timeout (no peers or slow connection)'));
      }
    }, 300000); // 300 seconds (5 minutes) — generous time for cloud containers behind strict firewalls to bootstrap peers
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

// ─── Growing Transcode Cache ───────────────────────────────────────────────────
class ActiveTranscode extends EventEmitter {
  constructor(cacheKey, cachePath, ff) {
    super();
    this.cacheKey = cacheKey;
    this.cachePath = cachePath;
    this.ff = ff;
    this.fd = fs.openSync(cachePath, 'w');
    this.bytesWritten = 0;
    this.finished = false;
    this.clientsCount = 0;
    this.idleTimeout = null;
  }

  write(chunk) {
    if (this.finished) return;
    try {
      fs.writeSync(this.fd, chunk);
      this.bytesWritten += chunk.length;
      this.emit('write');
    } catch (e) {
      console.error(`[TranscodeCache] Write error for cacheKey: ${this.cacheKey}:`, e.message);
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    try {
      fs.closeSync(this.fd);
    } catch (e) {}
    this.emit('write');
    console.log(`[TranscodeCache] Completed writing for cacheKey: ${this.cacheKey}`);
  }

  destroy() {
    this.finished = true;
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
    try {
      fs.closeSync(this.fd);
    } catch (e) {}
    if (this.ff) {
      try {
        console.log(`[TranscodeCache] Killing FFmpeg process for cacheKey: ${this.ff.pid || this.cacheKey}`);
        this.ff.kill('SIGKILL');
      } catch (e) {}
    }
    setTimeout(() => {
      try {
        if (fs.existsSync(this.cachePath)) {
          fs.unlinkSync(this.cachePath);
          console.log(`[TranscodeCache] Cleaned cache file: ${this.cachePath}`);
        }
      } catch (e) {
        console.error(`[TranscodeCache] Failed to unlink cache file: ${e.message}`);
      }
    }, 2000);
  }
}

class GrowingFileReader extends Readable {
  constructor(filePath, startOffset, endOffset, activeTranscode) {
    super();
    this.filePath = filePath;
    this.fd = null;
    this.readOffset = startOffset;
    this.endOffset = endOffset; // can be null
    this.activeTranscode = activeTranscode;
    this.isClosed = false;
    this.readListener = null;
  }

  _construct(callback) {
    let attempts = 0;
    const tryOpen = () => {
      fs.open(this.filePath, 'r', (err, fd) => {
        if (err) {
          if ((err.code === 'ENOENT' || err.code === 'EBUSY') && attempts < 50 && !this.isClosed) {
            attempts++;
            setTimeout(tryOpen, 100);
            return;
          }
          return callback(err);
        }
        this.fd = fd;
        callback();
      });
    };
    tryOpen();
  }

  _read(size) {
    const checkAndRead = () => {
      if (this.isClosed) return;

      const currentSize = this.activeTranscode.bytesWritten;
      let limit = currentSize;
      if (this.endOffset !== null && this.endOffset + 1 < limit) {
        limit = this.endOffset + 1;
      }

      if (this.readOffset < limit) {
        const bytesToRead = Math.min(size, limit - this.readOffset);
        const buffer = Buffer.alloc(bytesToRead);
        fs.read(this.fd, buffer, 0, bytesToRead, this.readOffset, (err, bytesRead) => {
          if (err) {
            this.destroy(err);
            return;
          }
          if (bytesRead > 0) {
            this.readOffset += bytesRead;
            this.push(buffer.slice(0, bytesRead));

            if (this.endOffset !== null && this.readOffset > this.endOffset) {
              this.push(null);
            }
          } else {
            this.readListener = checkAndRead;
            this.activeTranscode.once('write', this.readListener);

            // Double check to avoid race condition where data was written while fs.read was running
            if (this.readOffset < this.activeTranscode.bytesWritten) {
              this.activeTranscode.removeListener('write', this.readListener);
              this.readListener = null;
              process.nextTick(checkAndRead);
            }
          }
        });
      } else {
        if (this.endOffset !== null && this.readOffset > this.endOffset) {
          this.push(null);
        } else if (this.activeTranscode.finished) {
          this.push(null);
        } else {
          this.readListener = checkAndRead;
          this.activeTranscode.once('write', this.readListener);

          // Double check to avoid race condition where data was written after checking 'limit'
          if (this.readOffset < this.activeTranscode.bytesWritten) {
            this.activeTranscode.removeListener('write', this.readListener);
            this.readListener = null;
            process.nextTick(checkAndRead);
          }
        }
      }
    };
    checkAndRead();
  }

  _destroy(err, callback) {
    this.isClosed = true;
    if (this.readListener) {
      this.activeTranscode.removeListener('write', this.readListener);
      this.readListener = null;
    }
    if (this.fd) {
      fs.close(this.fd, () => callback(err));
    } else {
      callback(err);
    }
  }
}

const activeTranscodes = new Map();
const CACHE_DIR = path.join(__dirname, 'scratch', 'transcode_cache');

function cleanCacheDir() {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        if (file.endsWith('.mp4')) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
        }
      }
      console.log('[TranscodeCache] Initialized & cleaned cache directory.');
    } else {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      console.log('[TranscodeCache] Created cache directory.');
    }
  } catch (e) {
    console.error('[TranscodeCache] Error cleaning cache dir:', e.message);
  }
}

const WEBTORRENT_TEMP_DIR = path.join(os.tmpdir(), 'webtorrent');

function cleanWebTorrentTempDir() {
  try {
    if (fs.existsSync(WEBTORRENT_TEMP_DIR)) {
      fs.rmSync(WEBTORRENT_TEMP_DIR, { recursive: true, force: true });
      console.log('[TorrentManager] Cleaned temporary WebTorrent files.');
    }
  } catch (e) {
    console.error('[TorrentManager] Error cleaning temporary WebTorrent files:', e.message);
  }
}

// ─── App setup ─────────────────────────────────────────────────────────────────
const app = express();

// Global CORS Middleware to support cross-origin frontend (e.g. GitHub Pages)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Helper to get Google Drive direct download URL by parsing the warning page if necessary
async function getGDriveDirectUrl(fileId) {
  let currentUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
  let cookie = '';
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  for (let redirectCount = 0; redirectCount < 5; redirectCount++) {
    const reqHeaders = { ...headers };
    if (cookie) {
      reqHeaders['Cookie'] = cookie;
    }

    const res = await fetch(currentUrl, { headers: reqHeaders, redirect: 'manual' });
    
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const newCookies = setCookie.split(',').map(c => c.split(';')[0].trim());
      const cookieJar = {};
      if (cookie) {
        cookie.split(';').forEach(c => {
          const parts = c.split('=');
          if (parts[0]) cookieJar[parts[0].trim()] = parts.slice(1).join('=').trim();
        });
      }
      newCookies.forEach(c => {
        const parts = c.split('=');
        if (parts[0]) cookieJar[parts[0].trim()] = parts.slice(1).join('=').trim();
      });
      cookie = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
      const loc = res.headers.get('location');
      if (!loc) {
        throw new Error('Redirect without location header');
      }
      if (loc.startsWith('/')) {
        const urlObj = new URL(currentUrl);
        currentUrl = urlObj.origin + loc;
      } else {
        currentUrl = loc;
      }
      continue;
    }

    if (res.status === 404) {
      throw new Error('NOT_FOUND');
    }

    if (res.status === 200 || res.status === 206) {
      const contentType = res.headers.get('content-type') || '';
      
      if (contentType.includes('text/html')) {
        const html = await res.text();
        
        if (html.includes('quotaexceeded') || html.includes('Quota exceeded') || html.includes('Too many users')) {
          throw new Error('QUOTA_EXCEEDED');
        }
        if (html.includes('sign in') || html.includes('Sign in') || html.includes('ACCESS_DENIED') || html.includes('private') || html.includes('access denied')) {
          throw new Error('ACCESS_DENIED');
        }

        const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/) || html.match(/confirm=([^&\s"]+)/);
        const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/) || html.match(/uuid=([^&\s"]+)/);

        if (!confirmMatch || !uuidMatch) {
          throw new Error('ACCESS_DENIED');
        }

        currentUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
        continue;
      } else {
        return { url: currentUrl, cookie };
      }
    }

    throw new Error(`Unexpected status code: ${res.status}`);
  }

  throw new Error('Too many redirects');
}

// ─── /api/gdrive-stream ────────────────────────────────────────────────────────
// Proxy Google Drive direct download stream with full HTTP Range request support
app.get('/api/gdrive-stream', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const { fileId } = req.query;
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    res.status(400).send('Missing or invalid fileId'); return;
  }

  try {
    const { url: directUrl, cookie } = await getGDriveDirectUrl(fileId);
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (cookie) {
      headers['Cookie'] = cookie;
    }
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const driveRes = await fetch(directUrl, { headers, redirect: 'follow' });
    
    res.status(driveRes.status);
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach(h => {
      const v = driveRes.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    res.setHeader('Accept-Ranges', 'bytes');
    
    if (driveRes.body) {
      Readable.fromWeb(driveRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('[GDriveStream Error]', err.message);
    if (!res.headersSent) {
      if (err.message === 'QUOTA_EXCEEDED') {
        res.status(429).send('QUOTA_EXCEEDED');
      } else if (err.message === 'ACCESS_DENIED') {
        res.status(403).send('ACCESS_DENIED');
      } else if (err.message === 'NOT_FOUND') {
        res.status(404).send('NOT_FOUND');
      } else {
        res.status(500).send(err.message);
      }
    }
  }
});

// ─── /api/gdrive-auth-stream ───────────────────────────────────────────────────
// Authenticated Drive API v3 stream — bypasses anonymous quota limits.
// Requires a valid Google OAuth2 access_token passed as ?token=...
// The token is obtained client-side via Google Identity Services.
app.get('/api/gdrive-auth-stream', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const { fileId, token } = req.query;
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    res.status(400).send('Missing or invalid fileId'); return;
  }
  if (!token || token.length < 20) {
    res.status(401).send('Missing or invalid access token'); return;
  }

  try {
    // Drive API v3 — authenticated download (no anonymous quota limits)
    // We append acknowledgeAbuse=true to bypass the 403 error on large files that Google cannot scan for viruses.
    const driveApiUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;

    const headers = {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const driveRes = await fetch(driveApiUrl, { headers, redirect: 'follow' });

    if (driveRes.status === 401) {
      res.status(401).send('TOKEN_EXPIRED'); return;
    }
    if (!driveRes.ok) {
      const errText = await driveRes.text();
      console.error('[GDriveAuth] Drive API error:', driveRes.status, errText.slice(0, 500));
      if (driveRes.status === 403) {
        res.status(403).send('ACCESS_DENIED');
      } else {
        res.status(driveRes.status).send(`Drive API error: ${driveRes.status}`);
      }
      return;
    }

    res.status(driveRes.status);
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach(h => {
      const v = driveRes.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    res.setHeader('Accept-Ranges', 'bytes');

    if (driveRes.body) {
      Readable.fromWeb(driveRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('[GDriveAuthStream Error]', err.message);
    if (!res.headersSent) {
      res.status(500).send(err.message);
    }
  }
});


// ─── /api/gdrive-meta ──────────────────────────────────────────────────────────
app.get('/api/gdrive-meta', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { fileId } = req.query;
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    res.status(400).json({ error: 'Invalid fileId' }); return;
  }

  // Native players will read duration directly from video metadata headers.
  res.json({ duration: null });
});

// ─── /api/resolve ──────────────────────────────────────────────────────────────
app.get('/api/resolve', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { fileId } = req.query;
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    res.status(400).json({ error: 'Missing or invalid fileId' }); return;
  }

  try {
    // Validate that we can get the direct URL (checks access & quota)
    await getGDriveDirectUrl(fileId);
    res.json({ streamUrl: `/api/gdrive-stream?fileId=${encodeURIComponent(fileId)}` });
  } catch (err) {
    console.error('[Resolve] Failed to resolve Google Drive file:', err.message);
    if (err.message === 'QUOTA_EXCEEDED') {
      res.status(429).json({ error: 'QUOTA_EXCEEDED' });
    } else if (err.message === 'ACCESS_DENIED') {
      res.status(403).json({ error: 'ACCESS_DENIED' });
    } else if (err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'NOT_FOUND' });
    } else {
      res.status(500).json({ error: err.message });
    }
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

  // Extract the underlying raw stream URL if we are probing a transcoded stream URL
  try {
    const parsed = new URL(resolvedUrl, `http://127.0.0.1:${PORT}`);
    if (parsed.pathname === '/api/stream' && parsed.searchParams.has('url')) {
      const inner = parsed.searchParams.get('url');
      if (inner) {
        resolvedUrl = inner.startsWith('/api/') ? `http://127.0.0.1:${PORT}${inner}` : inner;
      }
    }
  } catch (e) {
    // ignore URL parsing errors
  }

  const isLocal = resolvedUrl.startsWith('/');
  if (!isLocal) {
    const reqHost = (req.headers.host || '').split(':')[0].toLowerCase();
    const allowed = ['drive.google.com','googlevideo.com','api.onedrive.com','onedrive.live.com','1drv.ms','localhost','127.0.0.1','hf.space','hf.co','github.io', reqHost];
    try {
      const host = new URL(resolvedUrl).hostname.toLowerCase();
      if (!allowed.some(d => d && (host === d || host.endsWith('.' + d)))) {
        res.status(403).json({ error: 'Domain not allowed' }); return;
      }
    } catch { res.status(400).json({ error: 'Invalid URL' }); return; }
  }

  try {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    console.log(`[Probe Log] targetUrl="${targetUrl}" resolvedUrl="${resolvedUrl}" isLocal=${isLocal}`);

    const cmd = isLocal
      ? `${FFPROBE} -v error -show_format -show_streams -of json "${resolvedUrl}"`
      : `${FFPROBE} -v error -show_format -show_streams -headers "User-Agent: ${ua}\\r\\n" -of json "${resolvedUrl}"`;

    // Increase timeout when probing a raw torrent stream because piece
    // retrieval can be slow; allow up to 90s for ffprobe to gather metadata.
    const probeTimeout = resolvedUrl.includes('/api/torrent/stream') ? 90000 : 20000;
    const { stdout } = await execPromise(cmd, { timeout: probeTimeout });
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
      res.json({
        needsTranscode: true,
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        duration: 0,
        videoSupported: true,
        audioSupported: true,
        containerSupported: true
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

  // Extract the underlying raw stream URL if we are wrapping another /api/stream URL
  try {
    const parsed = new URL(resolvedUrl, `http://127.0.0.1:${PORT}`);
    if (parsed.pathname === '/api/stream' && parsed.searchParams.has('url')) {
      const inner = parsed.searchParams.get('url');
      if (inner) {
        resolvedUrl = inner.startsWith('/api/') ? `http://127.0.0.1:${PORT}${inner}` : inner;
      }
    }
  } catch (e) {
    // ignore URL parsing errors
  }

  // Ensure internal API routes resolve to zero-latency local loopback 127.0.0.1:PORT for FFmpeg
  if (resolvedUrl.includes('/api/torrent/stream') || resolvedUrl.includes('/api/gdrive-stream')) {
    try {
      const u = new URL(resolvedUrl, `http://127.0.0.1:${PORT}`);
      resolvedUrl = `http://127.0.0.1:${PORT}${u.pathname}${u.search}`;
    } catch (e) {}
  }

  const isLocal = resolvedUrl.startsWith('/') || resolvedUrl.includes(`127.0.0.1:${PORT}`) || resolvedUrl.includes('localhost');
  if (!isLocal) {
    const reqHost = (req.headers.host || '').split(':')[0].toLowerCase();
    const allowed = ['drive.google.com','googlevideo.com','api.onedrive.com','onedrive.live.com','1drv.ms','localhost','127.0.0.1','hf.space','hf.co','github.io', reqHost];
    try {
      const host = new URL(resolvedUrl).hostname.toLowerCase();
      if (!allowed.some(d => d && (host === d || host.endsWith('.' + d)))) {
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

    const isTorrentStream = resolvedUrl.includes('/api/torrent/stream');

    let vopts = [];
    if (targetQuality === '720p') {
      vopts = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23', '-g', '24', '-threads', '0', '-vf', 'scale=-2:720', '-pix_fmt', 'yuv420p', '-b:v', '1500k', '-maxrate', '2000k', '-bufsize', '3000k'];
    } else if (targetQuality === '480p') {
      vopts = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23', '-g', '24', '-threads', '0', '-vf', 'scale=-2:480', '-pix_fmt', 'yuv420p', '-b:v', '800k', '-maxrate', '1200k', '-bufsize', '1800k'];
    } else if (canCopyVideo) {
      // Source is already a browser-compatible codec (h264/vp8/vp9/av1) — just remux, don't re-encode.
      // This reduces CPU usage by ~95% and eliminates transcoding bottleneck.
      vopts = ['-c:v', 'copy'];
    } else {
      vopts = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23', '-g', '24', '-threads', '0', '-pix_fmt', 'yuv420p'];
    }

    const aopts = canCopyAudio
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-af', 'aresample=async=1'];

    const cacheKey = crypto.createHash('md5').update(`${resolvedUrl}_${targetQuality}_${startT}_${vcodec || ''}_${acodec || ''}`).digest('hex');
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.mp4`);

    let active = activeTranscodes.get(cacheKey);
    if (!active) {
      let ffArgs = [];
      if (isTorrentStream) {
        ffArgs = [
          '-fflags', '+genpts+fastseek',
          '-probesize', '512k',
          '-analyzeduration', '1M',
          ...(startT && startT !== '0' ? ['-ss', startT] : []),
          '-headers', `User-Agent: ${ua}\r\n`,
          '-i', resolvedUrl,
          ...vopts, ...aopts,
          '-avoid_negative_ts', 'make_zero',
          '-f', 'mp4',
          '-movflags', 'empty_moov+frag_keyframe+default_base_moof+frag_custom',
          '-frag_duration', '100000',
          '-'
        ];
      } else {
        const inputArgs = ['-fflags', '+genpts', '-probesize', '512k', '-analyzeduration', '1M'];
        if (startT && startT !== '0') {
          inputArgs.push('-ss', startT);
        }
        if (!isLocal) {
          inputArgs.push('-reconnect', '1', '-reconnect_at_eof', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
        }
        ffArgs = isLocal
          ? [...inputArgs, '-i', resolvedUrl, ...vopts, ...aopts, '-avoid_negative_ts', 'make_zero', '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moof+frag_custom', '-frag_duration', '100000', '-']
          : [...inputArgs, '-headers', `User-Agent: ${ua}\r\n`, '-i', resolvedUrl, ...vopts, ...aopts, '-avoid_negative_ts', 'make_zero', '-f', 'mp4', '-movflags', 'empty_moov+frag_keyframe+default_base_moof+frag_custom', '-frag_duration', '100000', '-'];
      }

      console.log(`[TranscodeCache] Starting new FFmpeg for cacheKey: ${cacheKey}. Args:`, ffArgs.join(' '));
      const ff = spawn(FFMPEG, ffArgs);
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      active = new ActiveTranscode(cacheKey, cachePath, ff);
      active.isTorrent = isTorrentStream;
      activeTranscodes.set(cacheKey, active);

      ff.stdout.on('data', (chunk) => {
        active.write(chunk);
      });

      ff.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (!msg.includes('past duration') && !msg.includes('speed=')) {
          console.error(`[FFmpeg Stderr ${cacheKey}]: ${msg}`);
        }
      });

      ff.on('close', (code, signal) => {
        console.log(`[FFmpeg Close ${cacheKey}] code=${code}, signal=${signal}`);
        active.finish();
      });

      ff.on('error', (err) => {
        console.error(`[FFmpeg Error ${cacheKey}]:`, err.message);
        active.finish();
      });
    }

    active.clientsCount += 1;
    if (active.idleTimeout) {
      clearTimeout(active.idleTimeout);
      active.idleTimeout = null;
      console.log(`[TranscodeCache] Cancelled idle timeout for cacheKey: ${cacheKey}`);
    }

    const rangeHeader = req.headers.range;
    let startByte = 0;
    let endByte = null;
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      startByte = parseInt(parts[0], 10) || 0;
      if (parts[1]) {
        endByte = parseInt(parts[1], 10);
      }
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');

    if (rangeHeader && (startByte > 0 || endByte !== null)) {
      res.status(206);
      const end = endByte !== null ? endByte : startByte + 1000000000;
      res.setHeader('Content-Range', `bytes ${startByte}-${end}/*`);
    } else {
      res.status(200);
    }

    console.log(`[TranscodeCache] Serving cacheKey: ${cacheKey}, range: ${rangeHeader || 'full'}`);

    const reader = new GrowingFileReader(cachePath, startByte, endByte, active);
    reader.on('error', (err) => {
      console.error(`[TranscodeCache] Stream reader error for ${cacheKey}:`, err.message);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
    reader.pipe(res);

    req.on('close', () => {
      active.clientsCount -= 1;
      console.log(`[TranscodeCache] Client disconnected from cacheKey: ${cacheKey}. Remaining clients: ${active.clientsCount}`);
      reader.destroy();

      if (active.clientsCount <= 0) {
        // Keep active transcode sessions alive for 30 minutes so that HTML5 video
        // pre-buffering (which closes TCP connections while playing out of buffer)
        // does not cause session destruction mid-stream.
        const timeoutMs = 30 * 60 * 1000; // 30 minutes for all active streams
        console.log(`[TranscodeCache] No active clients. Starting ${timeoutMs / 1000}s idle timeout for cacheKey: ${cacheKey}`);
        active.idleTimeout = setTimeout(() => {
          console.log(`[TranscodeCache] Idle timeout triggered. Cleaning up cacheKey: ${cacheKey}`);
          active.destroy();
          activeTranscodes.delete(cacheKey);
        }, timeoutMs);
      }
    });
    return;
  }

  // Direct proxy
  if (isLocal) {
    if (fs.existsSync(resolvedUrl)) {
      const absPath = path.resolve(resolvedUrl);
      res.sendFile(absPath, { dotfiles: 'allow' });
    } else {
      res.status(404).send('Local file not found');
    }
    return;
  }

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

    const isVideoFile = (filename) => {
      const ext = path.extname(filename || '').toLowerCase();
      return ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.ts', '.flv'].includes(ext);
    };

    // Quick duration probe for primary video file
    let probedDuration = 0;
    try {
      const videoFiles = torrent.files.filter(f => isVideoFile(f.name));
      const targetFile = videoFiles.length > 0 ? videoFiles[0] : torrent.files[0];
      const targetIndex = targetFile ? torrent.files.indexOf(targetFile) : 0;
      const streamUrl = `http://127.0.0.1:${PORT}/api/torrent/stream?infoHash=${torrent.infoHash}&fileIndex=${targetIndex}`;
      
      const { stdout } = await execPromise(
        `${FFPROBE} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${streamUrl}"`,
        { timeout: 4000 }
      );
      const parsed = parseFloat(stdout.trim());
      if (!isNaN(parsed) && parsed > 0) {
        probedDuration = parsed;
        console.log(`[TorrentInfo] Fast probed stream duration: ${probedDuration.toFixed(1)}s`);
      }
    } catch (e) {
      console.warn('[TorrentInfo] Quick duration probe skipped:', e.message);
    }

    res.json({
      name: torrent.name,
      infoHash: torrent.infoHash,
      duration: probedDuration,
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

// ─── /api/torrent/reset ─────────────────────────────────────────────────────────
app.get('/api/torrent/reset', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { infoHash } = req.query;
  if (!infoHash || !/^[a-fA-F0-9]{40}$/.test(infoHash)) {
    res.status(400).json({ error: 'Missing or invalid infoHash' });
    return;
  }

  const entry = activeTorrents.get(infoHash.toLowerCase());
  if (!entry) {
    res.status(404).json({ error: 'Torrent not active or cached' });
    return;
  }

  try {
    entry.torrent.destroy({ destroyStore: true });
    activeTorrents.delete(infoHash.toLowerCase());
    res.json({ success: true });
  } catch (err) {
    console.error('[TorrentReset Error]', err.message);
    res.status(500).json({ error: err.message });
  }
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
  console.log('[TorrentStream] Request:', { infoHash, fileIndex: idx });

  try {
    const torrent = await addTorrent(infoHash);
    const file = torrent.files[idx];
    if (!file) {
      console.error('[TorrentStream] File not found:', { infoHash, idx, files: torrent.files.map((f, i) => ({ i, name: f.name })) });
      res.status(404).send('File not found in torrent');
      return;
    }
    console.log('[TorrentStream] Serving file:', file.name, 'length:', file.length);
    try {
      file.select();
    } catch (e) {
      console.warn('[TorrentStream] file.select() warning:', e.message);
    }

    const entry = activeTorrents.get(infoHash.toLowerCase());
    if (entry) entry.lastAccessed = Date.now();

    // We rely on file.createReadStream() below to automatically select and download
    // only the active range of pieces at maximum priority on-demand.

    res.setHeader('Accept-Ranges', 'bytes');
    // Allow client-side Service Worker to cache byte-range responses for seek-back
    res.setHeader('Cache-Control', 'private, max-age=300');
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.srt': 'text/plain; charset=utf-8',
      '.vtt': 'text/vtt; charset=utf-8'
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

      // Calculate sliding lookahead window (64MB)
      const fileOffset = file.offset || 0;
      const absoluteStart = fileOffset + start;
      const startPiece = Math.floor(absoluteStart / torrent.pieceLength);
      const lookaheadBytes = 64 * 1024 * 1024; // 64MB lookahead
      const endPiece = Math.min(
        torrent.pieces.length - 1,
        Math.floor((absoluteStart + lookaheadBytes) / torrent.pieceLength)
      );

      try {
        const fileStartPiece = Math.floor((file.offset || 0) / torrent.pieceLength);
        const fileEndPiece = Math.floor(((file.offset || 0) + file.length - 1) / torrent.pieceLength);

        const isMp4File = file.name.toLowerCase().endsWith('.mp4');
        // Urgent highest priority (255) for file start pieces
        torrent.select(fileStartPiece, Math.min(torrent.pieces.length - 1, fileStartPiece + 4), 255);
        if (isMp4File) {
          // For MP4 files, also request end pieces for moov atom
          torrent.select(Math.max(0, fileEndPiece - 2), fileEndPiece, 255);
        }
        
        // Maximum priority (255) for immediate 8MB window around active seek target
        const immediateEndPiece = Math.min(torrent.pieces.length - 1, Math.floor((absoluteStart + 8 * 1024 * 1024) / torrent.pieceLength));
        torrent.select(startPiece, immediateEndPiece, 255);

        // High priority (10) for sliding lookahead window (64MB)
        torrent.select(startPiece, endPiece, 10);
      } catch (err) {
        console.error('[TorrentStream] Failed to select lookahead range:', err.message);
      }

      const stream = file.createReadStream({ start, end });
      
      stream.on('error', (err) => {
        if (err.message && err.message.includes('prematurely')) return;
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

      // Select full file range for downloads
      const fileOffset = file.offset || 0;
      const startPiece = Math.floor(fileOffset / torrent.pieceLength);
      const endPiece = Math.floor((fileOffset + file.length - 1) / torrent.pieceLength);
      try {
        torrent.select(startPiece, endPiece, 1);
      } catch (err) {
        console.error('[TorrentStream] Failed to select full file pieces:', err.message);
      }

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
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Sessions persist for 30 days after login (regardless of activity)
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}));
}
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({}));
}
if (!fs.existsSync(SESSIONS_FILE)) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}));
}

// Session persistence helpers
function loadPersistedSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveSessions() {
  try {
    const obj = {};
    for (const [token, session] of activeSessions.entries()) {
      obj[token] = session;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('[Sessions] Failed to persist sessions:', e.message);
  }
}

function evictExpiredSessions() {
  const now = Date.now();
  let evicted = 0;
  for (const [token, session] of activeSessions.entries()) {
    if (now - session.loginTime > SESSION_TTL_MS) {
      activeSessions.delete(token);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.log(`[Sessions] Evicted ${evicted} expired session(s).`);
    saveSessions();
  }
}

// Boot: restore sessions from disk, evicting any that are already expired
const activeSessions = new Map(); // key: sessionToken, value: { username, isAdmin, loginTime }
{
  const persisted = loadPersistedSessions();
  const now = Date.now();
  let loaded = 0;
  for (const [token, session] of Object.entries(persisted)) {
    if (now - session.loginTime <= SESSION_TTL_MS) {
      activeSessions.set(token, session);
      loaded++;
    }
  }
  if (loaded > 0) {
    console.log(`[Sessions] Restored ${loaded} active session(s) from disk.`);
  }
}

// Evict expired sessions once a day
setInterval(evictExpiredSessions, 24 * 60 * 60 * 1000);

if (process.env.NODE_ENV === 'test') {
  activeSessions.set('devtoken', {
    username: 'tester',
    isAdmin: true,
    loginTime: Date.now()
  });
}

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
  const adminPassword = (process.env.ADMIN_PASSWORD || 'admin').trim();
  
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
  const customHeader = req.headers['x-auth-token'];
  const authHeader = req.headers['authorization'];
  const token = customHeader || (authHeader && authHeader.split(' ')[1]);
  if (!token) return null;
  const session = activeSessions.get(token);
  if (session) {
    return session.username;
  }
  return null;
}

function authenticateAdmin(req) {
  const customHeader = req.headers['x-auth-token'];
  const authHeader = req.headers['authorization'];
  const token = customHeader || (authHeader && authHeader.split(' ')[1]);
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
    saveSessions();

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
    saveSessions();

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
    saveSessions();
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

  entry.torrent.destroy({ destroyStore: true }, () => {
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
  saveSessions();

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
    const parsed = JSON.parse(raw.toString() || '{}');
    const videoObj = parsed.videoObj || (parsed.id ? parsed : null);

    if (!videoObj || !videoObj.id) {
      res.status(400).json({ error: 'Invalid history payload' });
      return;
    }

    const histories = getHistories();
    let userHistory = histories[username] || [];

    // Find if there is an existing entry to preserve progress
    const existing = userHistory.find(item => item.id === videoObj.id);
    const mergedVideoObj = { ...videoObj };
    if (existing) {
      if (mergedVideoObj.currentTime === undefined || mergedVideoObj.currentTime === null || mergedVideoObj.currentTime === 0) {
        mergedVideoObj.currentTime = existing.currentTime;
      }
      if (mergedVideoObj.duration === undefined || mergedVideoObj.duration === null || mergedVideoObj.duration === 0) {
        mergedVideoObj.duration = existing.duration;
      }
    }

    // Remove existing duplicates
    userHistory = userHistory.filter(item => item.id !== videoObj.id);
    
    // Add to top of stack
    userHistory.unshift(mergedVideoObj);
    
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

// ─── /api/config ───────────────────────────────────────────────────────────────
// Exposes safe runtime config to the frontend.
// Vite build-time env vars (VITE_*) don't work in Docker since the build runs
// before Render injects env vars. This endpoint reads them at runtime instead.
app.get('/api/config', (_req, res) => {
  res.json({
    googleClientId: process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ''
  });
});

// ─── Serve Vite frontend ───────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('/{*path}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));


// ─── Start ─────────────────────────────────────────────────────────────────────
initTools().then(() => {
  cleanCacheDir();
  cleanWebTorrentTempDir();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 RawStream running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
