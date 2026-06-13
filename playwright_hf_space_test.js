import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const host = process.env.TEST_URL || 'https://huggingface.co/spaces/Maverick9876/Rawstream';
const spaceAppHost = process.env.SPACE_APP_URL || 'https://maverick9876-rawstream.hf.space';

function logSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function safeStep(name, fn, results) {
  try {
    const details = await fn();
    results.push({ name, status: 'passed', details });
    console.log(`[PASS] ${name}${details ? `: ${details}` : ''}`);
  } catch (error) {
    results.push({ name, status: 'failed', details: error.message });
    console.error(`[FAIL] ${name}: ${error.message}`);
  }
}

async function waitForApp(page) {
  await page.goto(spaceAppHost, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 120000 });
  await page.waitForSelector('body', { timeout: 30000 });
}

async function getVideoState(page) {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return null;
    return {
      currentTime: video.currentTime,
      paused: video.paused,
      src: video.currentSrc || video.src || '',
      readyState: video.readyState,
      duration: video.duration
    };
  });
}

async function clickAny(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click({ timeout: 5000 });
        return selector;
      } catch (_err) {
        // Keep trying alternative selectors.
      }
    }
  }
  throw new Error(`No clickable selector found from: ${selectors.join(', ')}`);
}

async function waitForPlayback(page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getVideoState(page);
    if (state && state.currentTime > 0.1 && !state.paused) {
      return state;
    }
    await page.evaluate(() => {
      const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
      if (playOverlay) playOverlay.click();
      const video = document.querySelector('video');
      if (video && video.paused) video.play().catch(() => {});
    });
    await page.waitForTimeout(1000);
  }
  throw new Error('Playback did not start progressing in time');
}

async function dumpArtifacts(page, prefix) {
  const pngPath = path.join(projectRoot, `${prefix}.png`);
  const htmlPath = path.join(projectRoot, `${prefix}.html`);
  await page.screenshot({ path: pngPath, fullPage: true });
  fs.writeFileSync(htmlPath, await page.content(), 'utf8');
  return { pngPath, htmlPath };
}

async function run() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const testUser = `hf_tester_${Date.now().toString().slice(-8)}`;
  const results = [];
  const consoleMessages = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error' || text.includes('[Debug]') || /failed|error/i.test(text)) {
      console.log(`[browser console] ${msg.type().toUpperCase()}: ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    console.error(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText || 'unknown';
    failedRequests.push({ url: req.url(), failure });
    console.error(`[requestfailed] ${req.url()} -> ${failure}`);
  });
  page.on('dialog', async (dialog) => {
    console.log(`[dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });

  try {
    logSection('Open Space');
    await safeStep('Reach Space app', async () => {
      await waitForApp(page);
      const title = await page.title();
      return `title="${title}" url="${page.url()}"`;
    }, results);

    await safeStep('Auth overlay visible', async () => {
      await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 15000 });
      return 'login/register gate rendered';
    }, results);

    await safeStep('Register new user', async () => {
      await clickAny(page, ['.auth-switch-btn']);
      await page.fill('#register-username', testUser);
      await page.fill('#register-password', 'Password123');
      await page.fill('#register-confirm-password', 'Password123');
      await clickAny(page, ['#register-form button[type="submit"]']);
      await page.waitForSelector('.auth-overlay', { state: 'hidden', timeout: 30000 });
      return `registered ${testUser}`;
    }, results);

    await safeStep('Logout and login', async () => {
      await clickAny(page, ['.logout-btn']);
      await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 15000 });
      if (await page.locator('#register-form').isVisible().catch(() => false)) {
        await clickAny(page, ['.auth-switch-btn']);
      }
      await page.fill('#login-username', testUser);
      await page.fill('#login-password', 'Password123');
      await clickAny(page, ['#login-form button[type="submit"]']);
      await page.waitForSelector('.auth-overlay', { state: 'hidden', timeout: 30000 });
      return 're-login succeeded';
    }, results);

    await safeStep('History/settings shell renders', async () => {
      await page.waitForSelector('#history-sidebar, .history-sidebar', { timeout: 15000 });
      await clickAny(page, ['button[title="Settings"]', '.settings-btn', '.topbar-actions button:has-text("Settings")']);
      await page.waitForTimeout(1000);
      const settingsVisible = await page.locator('#settings-dialog[open], #settings-dialog').count();
      return settingsVisible ? 'settings reachable' : 'settings button clicked';
    }, results);

    await safeStep('Google Drive sample link loads or shows fallback', async () => {
      const input = page.locator('input[placeholder*="Paste cloud link"]').first();
      await input.fill('https://drive.google.com/file/d/1rqN6qiR7lhAxsDpOj-8nMPNHYuhObySQ/view?usp=sharing');
      await clickAny(page, ['button.load-media-action', 'button[type="submit"]']);
      await page.waitForTimeout(8000);

      const quotaButton = page.locator('button:has-text("Play via Google Drive Embedded Player")').first();
      if (await quotaButton.count()) {
        await quotaButton.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const iframeCount = await page.locator('iframe[title*="Google Drive"], iframe[src*="drive.google.com"]').count();
        if (iframeCount > 0) return 'quota/access fallback iframe rendered';
      }

      const state = await getVideoState(page);
      if (state && state.readyState >= 1) {
        return `video element created src=${state.src.slice(0, 120)}`;
      }

      const placeholderText = await page.locator('.player-placeholder, .toast-container, .toast').first().textContent().catch(() => '');
      if (placeholderText) return `fallback message: ${placeholderText.trim().slice(0, 140)}`;

      throw new Error('No direct playback, iframe fallback, or visible error state detected');
    }, results);

    await safeStep('Torrent sample initializes', async () => {
      const input = page.locator('input[placeholder*="Paste cloud link"]').first();
      await input.fill('magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel');
      await clickAny(page, ['button.load-media-action', 'button[type="submit"]']);
      await page.waitForTimeout(10000);

      const badgeText = await page.locator('.metadata-badge-list, .torrent-files-explorer, .toast').first().textContent().catch(() => '');
      const serverModeVisible = await page.locator('button:has-text("Server Stream")').count();
      const p2pModeVisible = await page.locator('button:has-text("Browser P2P")').count();
      if (serverModeVisible || p2pModeVisible || badgeText) {
        return `torrent UI reacted${badgeText ? `: ${badgeText.trim().slice(0, 140)}` : ''}`;
      }
      throw new Error('Torrent flow did not expose stream mode or metadata UI');
    }, results);

    await safeStep('Torrent sample playback attempt', async () => {
      const state = await waitForPlayback(page, 15000);
      return `playing currentTime=${state.currentTime.toFixed(2)} src=${state.src.slice(0, 120)}`;
    }, results);

    await safeStep('Admin dialog reachable', async () => {
      await clickAny(page, ['button[title*="Admin"]', '.admin-btn', 'button:has-text("Admin")']);
      await page.waitForTimeout(1500);
      const visible = await page.locator('#admin-dialog[open], #admin-dialog').count();
      if (!visible) throw new Error('admin dialog did not appear');
      return 'admin dialog rendered';
    }, results);

    const artifacts = await dumpArtifacts(page, 'hf_space_e2e');
    fs.writeFileSync(
      path.join(projectRoot, 'hf_space_e2e_results.json'),
      JSON.stringify({
        testedAt: new Date().toISOString(),
        host,
        spaceAppHost,
        finalUrl: page.url(),
        testUser,
        results,
        failedRequests,
        consoleMessages: consoleMessages.slice(-200),
        artifacts
      }, null, 2),
      'utf8'
    );
    console.log(`Artifacts saved: ${artifacts.pngPath}, ${artifacts.htmlPath}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
