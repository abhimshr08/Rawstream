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

    const browser = await chromium.launch({ headless: false, args: ['--disable-features=site-per-process', '--autoplay-policy=no-user-gesture-required'] });
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

    // Use the user's magnet torrent link for Project Hail Mary
    const magnet = 'magnet:?xt=urn:btih:3F2F600C7A5637DE5ADF972B053996E57F2B8B0D&dn=Project%20Hail%20Mary%20(2026)%20%5B1080p%5D%20%5BWEBRip%5D%20%5B5.1%5D&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=udp%3A%2F%2Fpublic.popcorn-tracker.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fglotorrents.pw%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftorrent.gresille.org%3A80%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337';

    console.log('Pasting magnet link into app input...');
    const input = await page.$('input[type="text"]');
    const submit = await page.$('button[type="submit"]');
    if (!input || !submit) throw new Error('UI elements not found');

    await input.fill(magnet);
    await submit.click({ force: true });

    // Wait a few seconds for the app to attempt load, fallback to server transcoded MP4 stream if needed
    await page.waitForTimeout(5000);
    const stateAfterMagnet = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { exists: false };
      return { exists: true, readyState: v.readyState, currentTime: v.currentTime, paused: v.paused, src: v.currentSrc };
    });
    console.log('State after magnet attempt:', stateAfterMagnet);

    if (!stateAfterMagnet.exists || stateAfterMagnet.readyState === 0) {
      console.log('Falling back to server-transcoded MP4 stream (forces browser-playable format)');
      const serverInner = `http://127.0.0.1:3000/api/torrent/stream?infoHash=3f2f600c7a5637de5adf972b053996e57f2b8b0d&fileIndex=0`;
      const serverStream = `http://127.0.0.1:3000/api/stream?url=${encodeURIComponent(serverInner)}&transcode=true`;
      await input.fill(serverStream);
      await submit.click({ force: true });
    }

    // Try to enable autoplay
    const attemptAutoplay = async (forceMuted = true) => {
      try {
        await page.evaluate((muted) => {
          const v = document.querySelector('video');
          if (v) {
            if (muted) v.muted = true;
            v.play().catch(() => {});
          }
          const overlayBtn = document.querySelector('#play-overlay button.large-play-btn') || document.querySelector('#play-overlay');
          if (overlayBtn) overlayBtn.click();
        }, forceMuted);
      } catch (e) {}
    };
    await attemptAutoplay();

    console.log('Waiting for video to start playing (180s timeout for peer connections)...');
    let start = Date.now();
    let playing = false;
    while (Date.now() - start < 180000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return { exists: false };
        return { exists: true, readyState: v.readyState, currentTime: v.currentTime, paused: v.paused };
      });
      console.log('Video state:', state);
      if (state.exists && !state.paused && state.currentTime > 0) { playing = true; break; }
      await page.waitForTimeout(1000);
      await attemptAutoplay(); // keep attempting autoplay
    }

    if (!playing) {
      console.warn('\n⚠️  Project Hail Mary magnet link did not start playing. Falling back to Sintel...');
      const sintelInner = `/api/torrent/stream?infoHash=08ada5a7a6183aae1e09d831df6748d566095a10&fileIndex=5`;
      const sintelStream = `http://127.0.0.1:3000/api/stream?url=${encodeURIComponent(sintelInner)}&transcode=true`;
      await input.fill(sintelStream);
      await submit.click({ force: true });
      await attemptAutoplay();

      console.log('Waiting up to 45s for fallback Sintel stream to start playing...');
      start = Date.now();
      while (Date.now() - start < 45000) {
        const state = await page.evaluate(() => {
          const v = document.querySelector('video');
          if (!v) return { exists: false };
          return { exists: true, readyState: v.readyState, currentTime: v.currentTime, paused: v.paused };
        });
        console.log('Video state (Sintel):', state);
        if (state.exists && !state.paused && state.currentTime > 0) { playing = true; break; }
        await page.waitForTimeout(1000);
        await attemptAutoplay();
      }
    }

    if (!playing) {
      throw new Error('Video did not start playing. Check server logs.');
    }

    console.log('🎉 Video is playing successfully! Unmuting for human verification and capturing stats...');
    const audioStats1 = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return null;
      v.muted = false;
      v.volume = 1.0;
      return {
        webkitAudioDecodedByteCount: v.webkitAudioDecodedByteCount || null,
        currentTime: v.currentTime
      };
    });
    console.log('Initial stats:', audioStats1);

    console.log('Seeking 10 minutes (600 seconds) ahead...');
    await page.evaluate(() => {
      if (window.seekTranscodedStreamForTesting) {
        window.seekTranscodedStreamForTesting(600);
      } else {
        const v = document.querySelector('video');
        if (v) v.currentTime = 600; // raw fallback
      }
    });

    console.log('Waiting for seek to process and buffer to clear...');
    await page.waitForTimeout(2000); // give some time for seek to trigger load

    // Wait for playback to resume at/after 10:00 (display time)
    const seekStart = Date.now();
    let seekCompleted = false;
    while (Date.now() - seekStart < 45000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        const el = document.querySelector('#current-time');
        if (!v) return { exists: false };
        return {
          exists: true,
          readyState: v.readyState,
          currentTime: v.currentTime,
          paused: v.paused,
          displayTime: el ? el.textContent : ''
        };
      });
      const elapsed = ((Date.now() - seekStart) / 1000).toFixed(1);
      console.log(`Seeking state after ${elapsed}s:`, state);
      if (state.exists && !state.paused && (state.displayTime.startsWith('10:') || state.displayTime.startsWith('11:'))) {
        seekCompleted = true;
        console.log(`🎉 Seek succeeded in ${elapsed}s! Playback resumed at/after 10 minutes.`);
        break;
      }
      await page.waitForTimeout(1000);
      await attemptAutoplay(false);
    }

    if (!seekCompleted) {
      throw new Error('Seek did not complete/resume in time');
    }

    console.log('🎉 Seek succeeded! Playback resumed at/after 10 minutes.');

    // Let it play for 15 seconds to ensure stability
    console.log('Playing for 15 seconds to monitor stability...');
    for (let i = 0; i < 15; i++) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return {
          currentTime: v.currentTime,
          paused: v.paused,
          webkitAudioDecodedByteCount: v.webkitAudioDecodedByteCount || null
        };
      });
      console.log(`[t=${i}s after seek] Video state:`, state);
      await page.waitForTimeout(1000);
    }

    // Save screenshot
    const screenshotPath = '/Users/abhishekmishra/.gemini/antigravity-ide/brain/495075cd-677a-4e06-9833-b158459051f4/seek_success.png';
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot to: ${screenshotPath}`);

    console.log('Test completed successfully. Cleaning up...');
    await browser.close();
    server.kill();
    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error('Headful realtime test failed:', err);
    server.kill();
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
