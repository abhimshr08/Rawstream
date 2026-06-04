import WebTorrent from 'webtorrent';

const client = new WebTorrent();
const magnet = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'; // A valid test torrent infohash/magnet

client.add(magnet, (torrent) => {
  console.log('Torrent ready. Has deselect:', typeof torrent.deselect);
  if (typeof torrent.deselect === 'function') {
    try {
      torrent.deselect(0, torrent.pieces.length - 1, 1);
      console.log('Successfully deselected all pieces.');
    } catch (e) {
      console.error('Error deselecting pieces:', e.message);
    }
  }
  client.destroy(() => {
    console.log('Client destroyed.');
    process.exit(0);
  });
});
