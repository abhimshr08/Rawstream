import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const serverCmd = 'node';
const serverArgs = ['server.js'];
const host = 'http://127.0.0.1:3000';

async function waitForServer(url, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok || res.status === 200 || res.status === 404) return;
    } catch (err) {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server did not start in time');
}

async function clickElement(page, selector) {
  const element = await page.waitForSelector(selector, { state: 'visible', timeout: 30000 });
  try {
    await element.click({ force: true });
  } catch (err) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
    }, selector);
  }
}

async function fillAndSubmit(page, url) {
  await page.fill('input[type="text"]', url);
  await clickElement(page, 'button[type="submit"]');
}

async function awaitVideoReady(page, timeoutMs = 90000) {
  await page.waitForSelector('video', { timeout: timeoutMs });
  
  // Auto-click play overlay if present
  await page.evaluate(() => {
    const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
    if (playOverlay) playOverlay.click();
  });

  const result = await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return { error: 'No video element' };
    const events = [];
    const handler = (name) => () => events.push(`${name}@${Date.now()}`);
    video.addEventListener('waiting', handler('waiting'));
    video.addEventListener('stalled', handler('stalled'));
    video.addEventListener('error', handler('error'));
    video.addEventListener('playing', handler('playing'));
    video.addEventListener('pause', handler('pause'));
    window.__playbackProbe = { events };

    const waitForReady = new Promise((resolve) => {
      if (video.readyState >= 3) resolve(true);
      video.addEventListener('canplay', () => resolve(true), { once: true });
      video.addEventListener('canplaythrough', () => resolve(true), { once: true });
      video.addEventListener('error', () => resolve(false), { once: true });
    });

    video.play().catch(() => {});
    return { ready: await waitForReady, initialTime: video.currentTime };
  });
  return result;
}

async function collectVideoStats(page) {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    const events = window.__playbackProbe?.events || [];
    return {
      currentTime: video?.currentTime || 0,
      paused: video?.paused,
      readyState: video?.readyState,
      duration: video?.duration || 0,
      playbackRate: video?.playbackRate || 0,
      eventLog: events
    };
  });
}

async function seekVideo(page, seconds) {
  return page.evaluate((target) => {
    const video = document.querySelector('video');
    if (!video) return { error: 'No video element' };
    video.currentTime = target;
    video.play().catch(() => {});
    return { requested: target, actual: video.currentTime };
  }, seconds);
}

async function runTest() {
  const server = spawn(serverCmd, serverArgs, { cwd: projectRoot, env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (data) => process.stdout.write(`[server] ${data}`));
  server.stderr.on('data', (data) => process.stderr.write(`[server] ${data}`));

  try {
    await waitForServer(`${host}/`);
    console.log('Server ready. Launching Chromium headless...');

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

    page.on('console', (msg) => console.log(`[browser ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[browser pageerror] ${err.message}`));
    page.on('requestfailed', (req) => console.error(`[browser requestfailed] ${req.url()} ${req.failure()?.errorText}`));

    await page.goto(host, { waitUntil: 'networkidle' });
    console.log('Loaded app page.');

    const tests = [
      {
        name: 'Google Drive',
        url: 'https://drive.google.com/file/d/1rqN6qiR7lhAxsDpOj-8nMPNHYuhObySQ/view?usp=sharing',
        action: async () => {
          await fillAndSubmit(page, 'https://drive.google.com/file/d/1rqN6qiR7lhAxsDpOj-8nMPNHYuhObySQ/view?usp=sharing');
          await page.waitForTimeout(1000);
          const ready = await awaitVideoReady(page, 90000);
          const stats = await collectVideoStats(page);
          return { ready, stats };
        }
      },
      {
        name: 'Torrent Seek',
        url: 'magnet:?xt=urn:btih:88818D739DD494024FB5DC920A6DFC4003635CB9&dn=The%20Rookie%20S08E10%20His%20Name%20Was%20Martin%201080p%20HULU%20WEB-DL%20DD%205%201%20H%20264-playWEB&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=udp%3A%2F%2Fpublic.popcorn-tracker.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fglotorrents.pw%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftorrent.gresille.org%3A80%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337',
        action: async () => {
          await fillAndSubmit(page, 'magnet:?xt=urn:btih:88818D739DD494024FB5DC920A6DFC4003635CB9&dn=The%20Rookie%20S08E10%20His%20Name%20Was%20Martin%201080p%20HULU%20WEB-DL%20DD%205%201%20H%20264-playWEB&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=udp%3A%2F%2Fpublic.popcorn-tracker.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fglotorrents.pw%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftorrent.gresille.org%3A80%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337');
          await page.waitForTimeout(2000);
          const ready = await awaitVideoReady(page, 120000);
          if (!ready.ready) return { ready, stats: null, error: 'Failed to get video ready' };
          const seekResult = await seekVideo(page, 12 * 60);
          console.log('Seek result:', seekResult);
          const initialStats = await collectVideoStats(page);
          console.log('Initial post-seek stats:', initialStats);
          console.log('Watching for 5 minutes after seek...');
          await page.waitForTimeout(300000);
          const finalStats = await collectVideoStats(page);
          return { ready, seekResult, initialStats, finalStats };
        }
      }
    ];

    const results = [];
    for (const test of tests) {
      console.log(`\n=== Running test: ${test.name} ===`);
      const result = await test.action();
      results.push({ name: test.name, result });
      // clear input for next test
      await page.fill('input[type="text"]', '');
      await page.waitForTimeout(1000);
    }

    const outputPath = path.join(projectRoot, 'headless_test_results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
    console.log('Results written to', outputPath);
  } catch (err) {
    console.error('Test run failed:', err);
    process.exitCode = 1;
  } finally {
    server.kill();
    console.log('Server stopped.');
  }
}

runTest().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});