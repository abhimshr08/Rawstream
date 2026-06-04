import WebTorrent from 'webtorrent';

const client = new WebTorrent();
const magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel';

console.log('Adding Sintel torrent...');
client.add(magnet, (torrent) => {
  console.log(`Torrent ready: ${torrent.name}`);
  console.log('Files list:');
  torrent.files.forEach((file, idx) => {
    console.log(`Index: ${idx}, Name: ${file.name}, Length: ${file.length}`);
  });
  client.destroy();
});
