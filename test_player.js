import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import fs from 'fs';

// 1. Start the Vite dev server in the background
console.log("Starting Vite dev server...");
const serverProcess = exec('npx vite --port 3000', { cwd: '/Users/abhishekmishra/.gemini/antigravity/scratch/cloudstream' });

serverProcess.stdout.on('data', (data) => {
  console.log(`[Vite] ${data.trim()}`);
});

serverProcess.stderr.on('data', (data) => {
  console.error(`[Vite Error] ${data.trim()}`);
});

// Wait 4 seconds for server to boot
setTimeout(async () => {
  let browser;
  try {
    console.log("Launching headless official Google Chrome...");
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Capture page console logs
    page.on('console', msg => {
      console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    
    page.on('pageerror', err => {
      console.error(`[Browser PageError] ${err.toString()}`);
    });

    page.on('request', req => {
      const url = req.url();
      if (url.includes('google') || url.includes('localhost')) {
        console.log(`[Request] ${req.method()} ${url}`);
      }
    });

    page.on('requestfailed', req => {
      console.error(`[Request Failed] ${req.url()} - Error: ${req.failure()?.errorText}`);
    });

    page.on('response', async res => {
      const url = res.url();
      if (url.includes('google')) {
        console.log(`[Response] ${res.status()} ${url}`);
        console.log(`[Response Headers] ${JSON.stringify(res.headers())}`);
        try {
          const text = await res.text();
          console.log(`[Response Body Snippet] ${text.substring(0, 300)}`);
        } catch (e) {
          console.log(`[Response Body Error] Could not read body: ${e.message}`);
        }
      } else if (url.includes('localhost')) {
        console.log(`[Response] ${res.status()} ${url}`);
      }
    });

    console.log("Navigating to http://localhost:3000/ ...");
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });

    console.log("Waiting for form elements...");
    await page.waitForSelector('#media-target-url');

    console.log("Typing video link...");
    await page.type('#media-target-url', 'https://drive.google.com/file/d/1A0JjqxMXtdgAI-Nv95JfpSGoFIZLNQx6/view?usp=sharing');

    console.log("Clicking Load Stream button...");
    await page.click('#trigger-stream-load');

    console.log("Waiting for video load attempt (12 seconds)...");
    await new Promise(resolve => setTimeout(resolve, 12000));

    // Get live debug logs from HTML
    const debugLogsText = await page.evaluate(() => {
      return document.getElementById('debug-logs').innerText;
    });
    console.log("\n--- Live Debug Logs from Page ---");
    console.log(debugLogsText);
    console.log("---------------------------------\n");

    const htmlContent = await page.content();
    fs.writeFileSync('/Users/abhishekmishra/.gemini/antigravity/scratch/cloudstream/dom.html', htmlContent);
    console.log("DOM HTML dumped to dom.html");

    console.log("Taking screenshot...");
    await page.screenshot({ path: '/Users/abhishekmishra/.gemini/antigravity/brain/d2d83ca9-f28d-48bb-b99f-c798034a1a2c/screenshot.png' });
    console.log("Screenshot saved!");

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }
    console.log("Stopping Vite server...");
    serverProcess.kill();
    process.exit(0);
  }
}, 4000);
