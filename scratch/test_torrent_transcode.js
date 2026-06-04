import WebTorrent from 'webtorrent';
import { spawn } from 'child_process';
import path from 'path';

// Use the exact magnet link from the user's report
const magnet = 'magnet:?xt=urn:btih:A6013BE727AA5E7AEEC5C63D8DA2B20B4DC51E36&dn=The.Rookie.S08E10.1080p.x265-ELiTE&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=udp%3A%2F%2Fpublic.popcorn-tracker.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fglotorrents.pw%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftorrent.gresille.org%3A80%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337';

const client = new WebTorrent();

console.log('Connecting to torrent...');
client.add(magnet, (torrent) => {
  console.log(`Torrent ready: ${torrent.name}`);
  // Find the MKV file (index 4 in user report)
  const videoFile = torrent.files.find(f => f.name.endsWith('.mkv'));
  if (!videoFile) {
    console.error('No video file found in torrent');
    client.destroy();
    return;
  }
  console.log(`Found video file: ${videoFile.name}, length: ${videoFile.length}`);
  
  // Create a read stream from the torrent file
  const stream = videoFile.createReadStream();
  console.log('Spawning ffmpeg transcode...');

  // Spawn ffmpeg with similar options to server.js
  const ffmpeg = spawn('/opt/homebrew/bin/ffmpeg', [
    '-ss', '0',
    '-i', 'pipe:0', // read from stdin
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '23',
    '-pix_fmt', 'yuv420p', // test with pix_fmt
    '-c:a', 'aac',
    '-b:a', '192k',
    '-f', 'mp4',
    '-movflags', 'empty_moov+frag_keyframe+default_base_moof',
    'pipe:1' // write to stdout
  ]);

  let transcodeBytes = 0;
  ffmpeg.stdout.on('data', (chunk) => {
    transcodeBytes += chunk.length;
    if (transcodeBytes < 100000) {
      console.log(`Transcoded ${transcodeBytes} bytes...`);
    }
  });

  ffmpeg.stderr.on('data', (data) => {
    console.error(`[ffmpeg stderr] ${data.toString().trim()}`);
  });

  stream.pipe(ffmpeg.stdin);

  ffmpeg.on('close', (code) => {
    console.log(`ffmpeg exited with code ${code}`);
    client.destroy();
  });

  // Stop after 20 seconds
  setTimeout(() => {
    console.log('Stopping test after 20 seconds...');
    ffmpeg.kill('SIGKILL');
    client.destroy();
  }, 20000);
});
