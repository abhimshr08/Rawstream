import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const serverCmd = 'npx';
const serverArgs = ['vite', 'preview', '--port', '3000', '--host', '127.0.0.1'];

function waitForServer(url, timeout = 15000) {
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
  const server = spawn(serverCmd, serverArgs, {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  server.stderr.on('data', (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  try {
    await waitForServer('http://127.0.0.1:3000', 15000);
    const isHeadless = process.env.HEADLESS !== 'false';
    console.log(`Server is responding. Launching browser (headless=${isHeadless})...`);
    const browser = await chromium.launch({ headless: isHeadless });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try {
        localStorage.setItem('rawstream_session_username', 'tester');
        localStorage.setItem('rawstream_session_token', 'devtoken');
        localStorage.setItem('rawstream_session_is_admin', 'true');
      } catch (e) {}
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      console.log(`[browser console] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.error(`[browser pageerror] ${err}`);
    });
    page.on('requestfailed', (req) => {
      console.error(`[browser requestfailed] ${req.url()} — ${req.failure()?.errorText}`);
    });

    console.log('Navigating to app...');
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    const pageTitle = await page.title();
    console.log('Page title:', pageTitle);

    const input = await page.$('input[type="text"]');
    if (!input) {
      throw new Error('Main URL input not found on page');
    }

    const submitButton = await page.$('button[type="submit"]');
    if (!submitButton) {
      throw new Error('Submit button not found on page');
    }

    console.log('Typing a Google Drive link and submitting form...');
    await input.fill('https://drive.google.com/file/d/INVALID_FILE_ID/view');
    await submitButton.click({ force: true });

    // Some overlays may intercept clicks; if necessary, submit directly via JS.
    await page.evaluate(() => {
      const submit = document.querySelector('button[type="submit"]');
      if (submit) submit.click();
    });

    await page.waitForTimeout(8000);

    const errorText = await page.evaluate(() => {
      const err = document.querySelector('.app-error, .toast, .player-placeholder h3');
      return err ? err.textContent : null;
    });
    console.log('Error/placeholder text found:', errorText);

    const screenshotPath = path.join(projectRoot, 'headless_smoke.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('Screenshot saved to', screenshotPath);

    const htmlPath = path.join(projectRoot, 'headless_smoke.html');
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('Page HTML dumped to', htmlPath);

    await browser.close();
    console.log('Headless browser test completed successfully.');
  } catch (err) {
    console.error('Headless smoke test failed:', err);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});