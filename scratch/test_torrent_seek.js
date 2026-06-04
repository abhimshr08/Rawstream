import assert from 'assert';

const PORT = 3000;
const magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.webtorrent.io%3A80&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com';

async function run() {
  console.log('1. Registering user...');
  const username = 'testuser_' + Math.floor(Math.random() * 10000);
  const password = 'password123';
  
  let res = await fetch(`http://127.0.0.1:${PORT}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  
  const regData = await res.json();
  const token = regData.token;
  console.log('Registered, token obtained:', token);

  console.log('\n2. Adding torrent to server cache...');
  res = await fetch(`http://127.0.0.1:${PORT}/api/torrent/info?torrentUrl=${encodeURIComponent(magnet)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const info = await res.json();
  console.log('Torrent added successfully:', info.name);
  console.log('Files:', info.files.map(f => `${f.index}: ${f.name} (${(f.length/1024/1024).toFixed(1)} MB)`));

  const videoFile = info.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm'));
  console.log('Selected video file index:', videoFile.index, videoFile.name);

  // Let's probe it first
  const streamUrl = `/api/torrent/stream?infoHash=${info.infoHash}&fileIndex=${videoFile.index}`;
  console.log('\n3. Probing the torrent stream URL:', streamUrl);
  res = await fetch(`http://127.0.0.1:${PORT}/api/probe?url=${encodeURIComponent(streamUrl)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const probeData = await res.json();
  console.log('Probe results:', probeData);

  // Now, simulate a seek. Request the stream with seek offset = 60s (1 minute)
  const seekTime = 60;
  const transcodeUrl = `http://127.0.0.1:${PORT}/api/stream?url=${encodeURIComponent(streamUrl)}&transcode=true&vcodec=${encodeURIComponent(probeData.videoCodec || 'h264')}&acodec=${encodeURIComponent(probeData.audioCodec || 'aac')}&start=${seekTime}`;
  
  console.log(`\n4. Simulating a seek request to 60s: ${transcodeUrl}`);
  const startTime = Date.now();
  
  // We'll read the first few chunks of the response to see how long it takes and if it gets data
  const streamRes = await fetch(transcodeUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  console.log('Response Status:', streamRes.status);
  console.log('Response Headers:', Object.fromEntries(streamRes.headers.entries()));

  if (!streamRes.ok) {
    console.error('Failed to get stream:', await streamRes.text());
    return;
  }

  const reader = streamRes.body.getReader();
  let chunksReceived = 0;
  let totalBytes = 0;

  console.log('Reading first 3 chunks from transcode stream...');
  while (chunksReceived < 3) {
    const { done, value } = await reader.read();
    if (done) {
      console.log('Stream ended prematurely!');
      break;
    }
    chunksReceived++;
    totalBytes += value.length;
    console.log(`Chunk ${chunksReceived} received: ${value.length} bytes. Time elapsed: ${Date.now() - startTime}ms`);
  }

  console.log(`Successfully received ${chunksReceived} chunks (${totalBytes} bytes total).`);
  console.log('Test completed successfully!');
}

run().catch(err => {
  console.error('Test run failed:', err);
});
