/**
 * Service Worker: Range-Based Byte Cache for Torrent Streams
 * 
 * Intercepts fetch requests to /api/torrent/stream and caches downloaded
 * byte ranges. When the user seeks back to an already-downloaded range,
 * this SW serves it from cache instead of re-fetching from the server.
 * 
 * Communication with the main thread:
 * - Posts 'RANGE_CACHE_UPDATE' messages with the current cached byte ranges
 *   so the UI can visualize which portions of the video are cached.
 */

const CACHE_NAME = 'torrent-range-cache-v1';
const MAX_CACHE_SIZE_BYTES = 512 * 1024 * 1024; // 512 MB max cache per torrent

// In-memory tracking of cached byte ranges per torrent stream key
// key: "infoHash:fileIndex", value: Array<{ start: number, end: number }>
const cachedRangesMap = new Map();

// Track total cached bytes per key for eviction
const cachedBytesMap = new Map();

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * Parse a URL for torrent stream parameters
 */
function parseTorrentStreamUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith('/api/torrent/stream')) return null;
    const infoHash = parsed.searchParams.get('infoHash');
    const fileIndex = parsed.searchParams.get('fileIndex') || '0';
    if (!infoHash) return null;
    return { infoHash: infoHash.toLowerCase(), fileIndex, key: `${infoHash.toLowerCase()}:${fileIndex}` };
  } catch (e) {
    return null;
  }
}

/**
 * Parse Range header to get start/end bytes
 */
function parseRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : (totalSize ? totalSize - 1 : null);
  return { start, end };
}

/**
 * Merge overlapping/adjacent ranges and sort them
 */
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    // Merge if overlapping or adjacent (within 1 byte)
    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * Check if a requested range is fully contained within cached ranges
 */
function isRangeCached(cachedRanges, start, end) {
  for (const range of cachedRanges) {
    if (range.start <= start && range.end >= end) {
      return true;
    }
  }
  return false;
}

/**
 * Generate a unique cache key for a specific byte range request
 */
function cacheKeyForRange(url, start, end) {
  // Strip any existing range params from the URL and create a unique key
  const baseUrl = url.split('?')[0];
  const parsed = new URL(url);
  const infoHash = parsed.searchParams.get('infoHash') || '';
  const fileIndex = parsed.searchParams.get('fileIndex') || '0';
  return `${baseUrl}?infoHash=${infoHash}&fileIndex=${fileIndex}&_range=${start}-${end}`;
}

/**
 * Broadcast cached range info to all connected clients
 */
async function broadcastCachedRanges(streamKey, totalSize) {
  const ranges = cachedRangesMap.get(streamKey) || [];
  const clients = await self.clients.matchAll({ type: 'window' });
  const message = {
    type: 'RANGE_CACHE_UPDATE',
    streamKey,
    ranges: ranges.map(r => ({ start: r.start, end: r.end })),
    totalSize
  };
  for (const client of clients) {
    client.postMessage(message);
  }
}

/**
 * Add a range to the cached ranges for a stream key
 */
function addCachedRange(streamKey, start, end) {
  const existing = cachedRangesMap.get(streamKey) || [];
  existing.push({ start, end });
  const merged = mergeRanges(existing);
  cachedRangesMap.set(streamKey, merged);

  // Calculate total cached bytes
  const totalBytes = merged.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
  cachedBytesMap.set(streamKey, totalBytes);
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  const streamInfo = parseTorrentStreamUrl(url);

  // Only intercept torrent stream requests
  if (!streamInfo) return;

  // Only intercept GET requests with Range headers (video seeking)
  if (event.request.method !== 'GET') return;

  const rangeHeader = event.request.headers.get('Range');
  if (!rangeHeader) return; // Let full requests pass through

  event.respondWith(handleRangeRequest(event.request, streamInfo, rangeHeader));
});

async function handleRangeRequest(request, streamInfo, rangeHeader) {
  const { key: streamKey } = streamInfo;
  const cachedRanges = cachedRangesMap.get(streamKey) || [];

  // We need to know the total file size to construct proper 206 responses.
  // Try to get it from an existing cached response first.
  let totalSize = null;
  const cache = await caches.open(CACHE_NAME);

  // Parse requested range (we may not know totalSize yet)
  const requestedRange = parseRangeHeader(rangeHeader, null);
  if (!requestedRange || requestedRange.start === null) {
    return fetch(request);
  }

  // Check if this range is already cached
  if (requestedRange.end !== null && isRangeCached(cachedRanges, requestedRange.start, requestedRange.end)) {
    // Serve from cache
    const cacheKey = cacheKeyForRange(request.url, requestedRange.start, requestedRange.end);
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      return cachedResponse;
    }
  }

  // Not cached - fetch from server
  try {
    const response = await fetch(request);

    // Only cache successful 206 Partial Content responses
    if (response.status === 206) {
      const contentRange = response.headers.get('Content-Range');
      if (contentRange) {
        const crMatch = contentRange.match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
        if (crMatch) {
          const start = parseInt(crMatch[1], 10);
          const end = parseInt(crMatch[2], 10);
          totalSize = crMatch[3] !== '*' ? parseInt(crMatch[3], 10) : null;

          // Check cache budget - don't cache if we've exceeded the max
          const currentCachedBytes = cachedBytesMap.get(streamKey) || 0;
          const chunkSize = end - start + 1;

          if (currentCachedBytes + chunkSize <= MAX_CACHE_SIZE_BYTES) {
            // Clone the response to cache it (response body can only be read once)
            const responseClone = response.clone();

            // Store in cache with a range-specific key
            const cacheKey = cacheKeyForRange(request.url, start, end);
            
            // Cache asynchronously (don't block the response)
            cache.put(cacheKey, responseClone).then(() => {
              addCachedRange(streamKey, start, end);
              if (totalSize) {
                broadcastCachedRanges(streamKey, totalSize);
              }
            }).catch((err) => {
              // Silently fail cache writes (quota exceeded, etc.)
            });
          }
        }
      }
    }

    return response;
  } catch (err) {
    // Network error - try to serve from cache as last resort
    const cacheKey = cacheKeyForRange(request.url, requestedRange.start, requestedRange.end || requestedRange.start);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw err;
  }
}

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  const { type, streamKey } = event.data || {};

  if (type === 'GET_CACHED_RANGES') {
    const ranges = cachedRangesMap.get(streamKey) || [];
    event.source.postMessage({
      type: 'RANGE_CACHE_UPDATE',
      streamKey,
      ranges: ranges.map(r => ({ start: r.start, end: r.end })),
      totalSize: event.data.totalSize || null
    });
  }

  if (type === 'CLEAR_CACHE') {
    // Clear cache for a specific stream or all
    if (streamKey) {
      cachedRangesMap.delete(streamKey);
      cachedBytesMap.delete(streamKey);
      caches.open(CACHE_NAME).then(cache => {
        cache.keys().then(keys => {
          keys.forEach(key => {
            if (key.url.includes(streamKey.split(':')[0])) {
              cache.delete(key);
            }
          });
        });
      });
    } else {
      cachedRangesMap.clear();
      cachedBytesMap.clear();
      caches.delete(CACHE_NAME);
    }
  }
});
