import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;

function waitForServer(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = async () => {
      if (Date.now() - start > timeout) {
        reject(new Error('Server did not start in time'));
        return;
      }
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok || res.status === 200 || res.status === 404) {
          resolve();
          return;
        }
      } catch (err) {
        // ignore
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

async function run() {
  console.log('Starting RawStream server...');
  const server = spawn('node', ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  try {
    await waitForServer('http://127.0.0.1:3000', 20000);
    console.log('Server is responding. Launching browser...');

    const browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext();
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

    console.log('Navigating to app...');
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    // Use known working torrent (Sintel) added in tests: infoHash 08ada5a7... fileIndex=5
    const streamUrl = `http://127.0.0.1:3000/api/stream?url=${encodeURIComponent('/api/torrent/stream?infoHash=08ada5a7a6183aae1e09d831df6748d566095a10&fileIndex=5')}&transcode=true`;

    const input = await page.$('input[type="text"]');
    const submitButton = await page.$('button[type="submit"]');
    if (!input || !submitButton) throw new Error('Form elements not found');

    console.log('Pasting stream URL and submitting form...');
    await input.fill(streamUrl);
    await submitButton.click({ force: true });

    // Auto-click play overlay if present
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
      if (playOverlay) playOverlay.click();
    });

    console.log('Waiting up to 30s for video to start playing...');
    const start = Date.now();
    let playing = false;
    while (Date.now() - start < 30000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return { exists: false };
        return { exists: true, readyState: v.readyState, currentTime: v.currentTime, paused: v.paused };
      });
      console.log('Video state:', state);
      if (state.exists && !state.paused && state.currentTime > 0) { playing = true; break; }
      await page.waitForTimeout(800);
    }

    const screenshotPath = path.join(projectRoot, 'headless_realtime.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('Screenshot saved to', screenshotPath);

    const htmlPath = path.join(projectRoot, 'headless_realtime.html');
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('Page HTML dumped to', htmlPath);

    if (!playing) {
      console.error('Video did not start playing within timeout. Check server logs.');
      process.exitCode = 2;
    } else {
      console.log('Video is playing — real-time feed visible.');
    }

    await browser.close();
  } catch (err) {
    console.error('Realtime smoke test failed:', err);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
}

run().catch(err => { console.error('Unexpected error:', err); process.exit(1); });
