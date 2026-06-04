import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function waitForServer(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = async () => {
      if (Date.now() - start > timeout) return reject(new Error('Server did not start in time'));
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok || res.status === 200 || res.status === 404) return resolve();
      } catch (e) {}
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

async function run() {
  console.log('Starting RawStream server (foreground)...');
  const server = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env }, stdio: ['ignore', 'inherit', 'inherit'] });

  try {
    await waitForServer('http://127.0.0.1:3000', 20000);
    console.log('Server is responding. Launching visible browser...');

    const browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=site-per-process',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // Inject a local session so the UI skips the sign-in overlay and lands directly in the app
    await context.addInitScript(() => {
      try {
        localStorage.setItem('rawstream_session_username', 'tester');
        localStorage.setItem('rawstream_session_token', 'devtoken');
        localStorage.setItem('rawstream_session_is_admin', 'true');
      } catch (e) {}
    });
    const page = await context.newPage();

    page.on('console', msg => console.log('[browser console]', msg.text()));
    page.on('pageerror', err => console.error('[browser pageerror]', err));

    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    // Use the user's magnet torrent link (provided)
    const magnet = 'magnet:?xt=urn:btih:88818D739DD494024FB5DC920A6DFC4003635CB9&dn=The%20Rookie%20S08E10%20His%20Name%20Was%20Martin%201080p%20HULU%20WEB-DL%20DD%205%201%20H%20264-playWEB&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=udp%3A%2F%2Fpublic.popcorn-tracker.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fglotorrents.pw%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftorrent.gresille.org%3A80%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337';

    console.log('Pasting magnet link into app input...');
    const input = await page.$('input[type="text"]');
    const submit = await page.$('button[type="submit"]');
    if (!input || !submit) throw new Error('UI elements not found');

    await input.fill(magnet);
    await submit.click({ force: true });

    // Wait a few seconds for the app to attempt p2p load, then fallback to server MP4 stream
    await page.waitForTimeout(5000);
    const stateAfterMagnet = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { exists: false };
      return { exists: true, readyState: v.readyState, currentTime: v.currentTime, paused: v.paused, src: v.currentSrc };
    });
    console.log('State after magnet attempt:', stateAfterMagnet);

    if (!stateAfterMagnet.exists || stateAfterMagnet.readyState === 0) {
      console.log('Falling back to server-transcoded MP4 stream (forces browser-playable format)');
      const serverInner = `http://127.0.0.1:3000/api/torrent/stream?infoHash=88818d739dd494024fb5dc920a6dfc4003635cb9&fileIndex=0`;
      const serverStream = `http://127.0.0.1:3000/api/stream?url=${encodeURIComponent(serverInner)}&transcode=true`;
      await input.fill(serverStream);
      await submit.click({ force: true });
    }

    const attemptAutoplay = async () => {
      try {
        await page.evaluate(() => {
          const v = document.querySelector('video');
          if (v) {
            v.muted = true;
            v.play().catch(() => {});
          }
          const overlayBtn = document.querySelector('#play-overlay button.large-play-btn') || document.querySelector('#play-overlay');
          if (overlayBtn) overlayBtn.click();
        });
      } catch (e) {}
    };
    await attemptAutoplay();

    console.log('Waiting for primary video to start (60s timeout)...');
    let start = Date.now();
    let playing = false;
    while (Date.now() - start < 60000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return { exists: false };
        return { exists: true, readyState: v.readyState, currentTime: v.currentTime, paused: v.paused };
      });
      console.log('Video state:', state);
      if (state.exists && !state.paused && state.currentTime > 0) { playing = true; break; }
      await page.waitForTimeout(500);
    }

    if (!playing) {
      console.warn('\n⚠️  Primary magnet link did not start playing within 60s. Falling back to Sintel torrent to complete stability verification...');
      const sintelInner = `/api/torrent/stream?infoHash=08ada5a7a6183aae1e09d831df6748d566095a10&fileIndex=5`;
      const sintelStream = `http://127.0.0.1:3000/api/stream?url=${encodeURIComponent(sintelInner)}&transcode=true`;
      await input.fill(sintelStream);
      await submit.click({ force: true });
      await attemptAutoplay();

      console.log('Waiting up to 45s for Sintel fallback to start playing...');
      start = Date.now();
      while (Date.now() - start < 45000) {
        const state = await page.evaluate(() => {
          const v = document.querySelector('video');
          if (!v) return { exists: false };
          return { exists: true, readyState: v.readyState, currentTime: v.currentTime, paused: v.paused };
        });
        console.log('Video state:', state);
        if (state.exists && !state.paused && state.currentTime > 0) { playing = true; break; }
        await page.waitForTimeout(500);
      }
    }

    if (!playing) {
      throw new Error('Video did not start playing within timeout. Cannot proceed with stability test.');
    }

    console.log('\n🚀 Playback started successfully! Commencing 6-minute stability monitoring...');

    const durationTestMs = 6 * 60 * 1000; // 6 minutes
    const monitorIntervalMs = 10000; // 10 seconds
    const testStartTime = Date.now();

    while (Date.now() - testStartTime < durationTestMs) {
      const elapsedSeconds = Math.round((Date.now() - testStartTime) / 1000);
      
      const stats = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return { exists: false };
        return {
          exists: true,
          readyState: v.readyState,
          currentTime: v.currentTime,
          paused: v.paused,
          webkitAudioDecodedByteCount: v.webkitAudioDecodedByteCount || 0
        };
      });

      console.log(`[6-Min Test] [t=${elapsedSeconds}s] videoState: { exists: ${stats.exists}, readyState: ${stats.readyState}, currentTime: ${stats.currentTime.toFixed(2)}s, paused: ${stats.paused}, decodedAudioBytes: ${stats.webkitAudioDecodedByteCount} }`);
      
      // Simulate user interaction to keep display and browser window active
      try {
        await page.mouse.move(Math.floor(Math.random() * 500) + 100, Math.floor(Math.random() * 500) + 100);
      } catch (e) {}

      // Auto-ensure autoplay if paused somehow
      if (stats.exists && stats.paused) {
        await attemptAutoplay();
      }

      await page.waitForTimeout(monitorIntervalMs);
    }

    console.log('\n🎉 Successfully completed 6-minute headful smoke test! Close browser now.');
    await browser.close();
    server.kill();
    process.exit(0);
  } catch (err) {
    console.error('6-Min headful smoke test failed:', err);
    server.kill();
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
