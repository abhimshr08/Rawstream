import parseTorrent from 'parse-torrent';

const magnet = 'magnet:?xt=urn:btih:3F2F600C7A5637DE5ADF972B053996E57F2B8B0D&dn=Project%20Hail%20Mary%20(2026)%20%5B1080p%5D%20%5BWEBRip%5D%20%5B5.1%5D&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=udp%3A%2F%2Fpublic.popcorn-tracker.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fglotorrents.pw%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.copp';

try {
  const result = parseTorrent(magnet);
  console.log('✅ Parsed successfully!');
  console.log('Result:', result);
} catch (e) {
  console.error('❌ Failed to parse:', e.message);
}
