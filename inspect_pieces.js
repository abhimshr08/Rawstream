import WebTorrent from 'webtorrent';

const client = new WebTorrent();
const magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel';

console.log('Adding Sintel torrent to client...');
const torrent = client.add(magnet, { deselect: true });

torrent.on('ready', () => {
  console.log('Torrent is ready.');
  console.log('pieces length:', torrent.pieces.length);
  
  let nullCount = 0;
  let undefinedCount = 0;
  for (let i = 0; i < torrent.pieces.length; i++) {
    if (torrent.pieces[i] === null) nullCount++;
    else if (torrent.pieces[i] === undefined) undefinedCount++;
  }
  
  console.log('Null pieces count:', nullCount);
  console.log('Undefined pieces count:', undefinedCount);
  console.log('First 5 pieces:', torrent.pieces.slice(0, 5));
  
  client.destroy();
});
