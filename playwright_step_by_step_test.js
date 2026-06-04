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

function printBanner(stepNum, title, description) {
  console.log('\n========================================================================');
  console.log(`STEP ${stepNum}: ${title.toUpperCase()}`);
  console.log(`Description: ${description}`);
  console.log('========================================================================\n');
}

async function clickPlay(page) {
  try {
    // Hover over the player to reveal controls/overlay if needed
    if (await page.locator('#player-container').isVisible()) {
      await page.hover('#player-container');
    }
    if (await page.locator('#play-overlay').isVisible()) {
      console.log('Clicking #play-overlay...');
      await page.click('#play-overlay');
    } else if (await page.locator('.large-play-btn').isVisible()) {
      console.log('Clicking .large-play-btn...');
      await page.click('.large-play-btn');
    } else if (await page.locator('#play-btn').isVisible()) {
      console.log('Clicking #play-btn...');
      await page.click('#play-btn');
    } else if (await page.locator('#video-element').isVisible()) {
      console.log('Clicking #video-element directly to toggle play...');
      await page.click('#video-element');
    } else {
      console.log('No play control visible. Attempting evaluate play()...');
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v && v.paused) v.play().catch(() => {});
      });
    }
  } catch (e) {
    console.error('clickPlay error:', e.message);
  }
}

async function runStepByStepTest() {
  const testUser = 'step_tester_' + Math.floor(Math.random() * 1000000);
  console.log(`Initializing Step-by-Step E2E Verification (User: ${testUser})...`);

  // Start Express server
  const server = spawn(serverCmd, serverArgs, {
    cwd: projectRoot,
    env: { ...process.env, ADMIN_PASSWORD: 'adminpassword', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (chunk) => {
    const line = chunk.toString();
    // Only print relevant server logs to keep console clean
    if (line.includes('running at') || line.includes('[Torrent') || line.includes('[Transcode') || line.includes('[AdminSync]')) {
      process.stdout.write(`[server] ${line}`);
    }
  });
  server.stderr.on('data', (chunk) => process.stderr.write(`[server-err] ${chunk}`));

  let browser;
  let page;
  try {
    await waitForServer(`${host}/`, 20000);
    console.log('Server is online and responding.');

    // Launch browser in headful mode (HEADLESS=false)
    browser = await chromium.launch({
      headless: false,
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Debug]') || text.includes('Error') || text.includes('failed')) {
        console.log(`[browser console] ${msg.type().toUpperCase()}: ${text}`);
      }
    });

    page.on('pageerror', err => console.error(`[browser pageerror] ${err}`));

    page.on('dialog', async dialog => {
      console.log(`[browser dialog] Type: ${dialog.type()}, Message: ${dialog.message()}`);
      await dialog.accept();
    });

    console.log('Navigating to RawStream URL...');
    await page.goto(host, { waitUntil: 'networkidle' });

    // ────────────────────────────────────────────────────────────────────────
    printBanner(1, 'Auth & Account Creation', `Registering test user "${testUser}", logging out, and logging back in.`);
    
    await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 5000 });
    await page.click('.auth-switch-btn'); // Switch to Register form
    await page.waitForSelector('#register-form', { state: 'visible', timeout: 5000 });
    
    await page.fill('#register-username', testUser);
    await page.fill('#register-password', 'Password123');
    await page.fill('#register-confirm-password', 'Password123');
    await page.click('#register-form button[type="submit"]');

    // Wait for auth overlay to close
    await page.waitForSelector('.auth-overlay', { state: 'hidden', timeout: 10000 });
    console.log('✓ Account registered and auto-logged in.');
    await page.waitForTimeout(2000);

    // Logout
    console.log('Logging out test user...');
    await page.click('.logout-btn');
    await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 5000 });

    // Log back in
    console.log('Logging back in...');
    const isRegisterVisible = await page.isVisible('#register-form');
    if (isRegisterVisible) {
      console.log('Switching from register to login form...');
      await page.click('.auth-switch-btn');
    }
    await page.waitForSelector('#login-form', { state: 'visible', timeout: 5000 });
    await page.fill('#login-username', testUser);
    await page.fill('#login-password', 'Password123');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('.auth-overlay', { state: 'hidden', timeout: 10000 });
    console.log('✓ Login successful.');
    
    console.log('Pausing 4 seconds for step review...');
    await page.waitForTimeout(4000);

    // ────────────────────────────────────────────────────────────────────────
    printBanner(2, 'Local Video Playback', 'Loading and playing local test_faststart.mp4. Verifying direct playback.');

    const localVideoPath = path.join(projectRoot, 'test_faststart.mp4');
    const urlInput = await page.waitForSelector('input[placeholder*="Paste cloud link"]', { state: 'visible', timeout: 5000 });
    await urlInput.fill(localVideoPath);
    await page.click('button.load-media-action');

    // Wait for .metadata-badge-list to indicate that the video loaded and is ready
    await page.waitForSelector('.metadata-badge-list', { state: 'visible', timeout: 15000 });
    await page.waitForSelector('video', { timeout: 5000 });
    
    // Autoplay play-overlay clicker helper
    await clickPlay(page);

    console.log('Verifying playback progression...');
    let startPlay = Date.now();
    let isLocalPlaying = false;
    while (Date.now() - startPlay < 10000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { currentTime: v.currentTime, paused: v.paused } : null;
      });
      if (state && state.currentTime > 0.1 && !state.paused) {
        isLocalPlaying = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!isLocalPlaying) {
      throw new Error('Local video playback did not start or progress.');
    }
    console.log('✓ Local video is streaming directly.');

    console.log('Pausing 5 seconds for step review...');
    await page.waitForTimeout(5000);

    // ────────────────────────────────────────────────────────────────────────
    printBanner(3, 'Quality Preset Transcoding', 'Switching video stream to 720p transcoding preset.');

    // Click quality presets button
    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Quality resolution presets"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('#quality-menu', { state: 'attached', timeout: 5000 });
    
    // Select 720p option (second item in dropdown)
    await page.evaluate(() => {
      const items = document.querySelectorAll('#quality-menu li');
      if (items && items[1]) items[1].click();
    });
    console.log('Switched to 720p. Checking video source query parameters...');

    let qualitySwitched = false;
    startPlay = Date.now();
    while (Date.now() - startPlay < 10000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { src: v.src, currentTime: v.currentTime, paused: v.paused } : null;
      });
      if (state && state.src.includes('quality=720p')) {
        qualitySwitched = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!qualitySwitched) {
      throw new Error('Quality switch to "720p" failed.');
    }
    console.log('✓ Video source successfully switched to 720p transcoded stream.');

    console.log('Pausing 5 seconds for step review...');
    await page.waitForTimeout(5000);

    // ────────────────────────────────────────────────────────────────────────
    printBanner(4, 'Google Drive Fallback & Iframe Embed', 'Loading Google Drive link, verifying quota block, and testing official iframe player fallback.');

    const gdLink = 'https://drive.google.com/file/d/1rqN6qiR7lhAxsDpOj-8nMPNHYuhObySQ/view?usp=sharing';
    const gdUrlInput = await page.waitForSelector('input[placeholder*="Paste cloud link"]', { state: 'visible', timeout: 5000 });
    await gdUrlInput.fill(gdLink);
    await page.click('button.load-media-action');

    console.log('Waiting for Google Drive player or Quota Block screen...');
    await page.waitForSelector('video, .player-placeholder', { timeout: 15000 });

    let isQuotaScreen = false;
    startPlay = Date.now();
    while (Date.now() - startPlay < 10000) {
      const isQuota = await page.evaluate(() => {
        const placeholder = document.querySelector('.player-placeholder h3');
        return placeholder && (placeholder.textContent.includes('Quota') || placeholder.textContent.includes('Access'));
      });
      if (isQuota) {
        isQuotaScreen = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!isQuotaScreen) {
      throw new Error('Quota/Access block screen did not appear for Google Drive link.');
    }

    console.log('Quota Exceeded screen detected. Clicking "Play via Google Drive Embedded Player"...');
    await page.click('button:has-text("Play via Google Drive Embedded Player")');

    console.log('Waiting for official iframe embed container...');
    const iframe = await page.waitForSelector('iframe[title="Google Drive Embedded Player"]', { state: 'visible', timeout: 10000 });
    if (!iframe) {
      throw new Error('Embedded player iframe failed to mount.');
    }
    console.log('✓ Google Drive Embedded iframe fallback loaded successfully.');

    console.log('Pausing 6 seconds for step review...');
    await page.waitForTimeout(6000);

    // ────────────────────────────────────────────────────────────────────────
    printBanner(5, 'Sintel Torrent playback, Seeking, and Subtitles', 'Loading Sintel Torrent mock, verifying transition from iframe, testing seeking, and custom subtitle cue rendering.');

    const magnetLink = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel';
    const inputForMagnet = await page.waitForSelector('input[placeholder*="Paste cloud link"]', { state: 'visible', timeout: 5000 });
    await inputForMagnet.fill(magnetLink);
    await page.click('button.load-media-action');

    console.log('Waiting for torrent files list and metadata...');
    await page.waitForSelector('.torrent-files-card', { state: 'visible', timeout: 20000 });
    console.log('Torrent files resolved. Waiting for .metadata-badge-list to confirm video mounted...');

    // Wait for .metadata-badge-list to confirm currentVideo loaded into the player
    await page.waitForSelector('.metadata-badge-list', { state: 'visible', timeout: 20000 });
    await page.waitForSelector('video', { state: 'visible', timeout: 5000 });
    
    await clickPlay(page);

    console.log('Verifying torrent playback starts...');
    startPlay = Date.now();
    let torrentPlaying = false;
    while (Date.now() - startPlay < 15000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { readyState: v.readyState, currentTime: v.currentTime, paused: v.paused } : null;
      });
      console.log('Torrent playback status:', state);
      if (state && state.currentTime > 0.1 && !state.paused) {
        torrentPlaying = true;
        break;
      }
      await page.waitForTimeout(1000);
      await clickPlay(page);
    }

    if (!torrentPlaying) {
      throw new Error('Sintel torrent playback failed to start.');
    }
    console.log('✓ Torrent playback started.');
    await page.waitForTimeout(3000);

    // Test Seeking
    console.log('Seeking Sintel torrent to 10 seconds...');
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) v.currentTime = 10;
    });

    await page.waitForTimeout(3000);
    const postSeekState = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? { currentTime: v.currentTime, paused: v.paused } : null;
    });
    console.log('Post-seek torrent state:', postSeekState);
    if (!postSeekState || postSeekState.currentTime < 9.5 || postSeekState.paused) {
      throw new Error('Seeking torrent direct stream failed or hung.');
    }
    console.log('✓ Direct seek progressed immediately without buffer loop.');
    await page.waitForTimeout(2000);

    // Test Subtitle Upload and Cue Rendering (10 minutes/seconds simulation)
    console.log('Simulating subtitle upload after playback progress...');
    const testSubsPath = path.join(projectRoot, 'test_subs.srt');
    fs.writeFileSync(testSubsPath, `1
00:00:08,000 --> 00:00:15,000
This is a subtitle cue at 10s!`, 'utf8');

    // Click subtitles button to expand menu
    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Subtitles"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('#subtitles-menu', { state: 'visible', timeout: 5000 });

    console.log('Uploading test_subs.srt...');
    await page.setInputFiles('#sub-upload-file', testSubsPath);
    await page.waitForTimeout(4000); // Wait for file loading, VTT conversion, Blob creation, track load

    // Seek into the cue window (8s-15s) so browser re-evaluates activeCues at this timestamp
    console.log('Seeking to 10s (inside cue window 8-15s) to trigger activeCues evaluation...');
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) v.currentTime = 10;
    });
    await page.waitForTimeout(1500); // Allow browser to re-evaluate active cues after seek

    // Check active cue
    const tracksInfo = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return 'No video element';
      let info = [];
      const trackEls = video.querySelectorAll('track');
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        const el = trackEls[i];
        info.push({
          label: track.label,
          mode: track.mode,
          cuesLength: track.cues ? track.cues.length : null,
          activeCuesLength: track.activeCues ? track.activeCues.length : null,
          activeCuesText: track.activeCues ? Array.from(track.activeCues).map(c => c.text).join(', ') : '',
          elReadyState: el ? el.readyState : 'no element',
          elSrc: el ? el.src : 'no element',
          elOuterHTML: el ? el.outerHTML : 'no element'
        });
      }
      return info;
    });
    console.log('Tracks info:', JSON.stringify(tracksInfo, null, 2));

    const activeCueText = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return 'No video element';
      let activeText = '';
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.mode === 'showing' && track.activeCues) {
          for (let j = 0; j < track.activeCues.length; j++) {
            activeText += track.activeCues[j].text;
          }
        }
      }
      return activeText || 'No active cues found';
    });

    console.log('Active subtitle cue at 10s is:', activeCueText);
    if (!activeCueText || !activeCueText.includes('This is a subtitle cue at 10s!')) {
      throw new Error(`Subtitle cue timing verification failed. Got: ${activeCueText}`);
    }
    console.log('✓ Uploaded subtitles cue renders correctly at the active timestamp.');

    try {
      fs.unlinkSync(testSubsPath);
    } catch (e) {}

    console.log('Pausing 8 seconds for step review (Sintel torrent visible playback)...');
    await page.waitForTimeout(8000);

    // ────────────────────────────────────────────────────────────────────────
    printBanner(6, 'Admin Panel & Account Deletion', 'Logging in as Admin, inspecting live telemetry, and deleting the test user.');

    // Logout tester
    console.log('Logging out tester...');
    await page.click('.logout-btn');
    await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 5000 });

    // Log in as Admin
    console.log('Logging in as Admin...');
    const isAdminRegisterVisible = await page.isVisible('#register-form');
    if (isAdminRegisterVisible) {
      console.log('Switching from register to login form for admin...');
      await page.click('.auth-switch-btn');
    }
    await page.waitForSelector('#login-form', { state: 'visible', timeout: 5000 });
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'adminpassword');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('.auth-overlay', { state: 'hidden', timeout: 10000 });

    // Open Admin Control Center
    console.log('Opening Admin Control Center...');
    const adminBtn = await page.waitForSelector('button[title="Admin Dashboard"]', { state: 'visible', timeout: 5000 });
    await adminBtn.click();
    await page.waitForSelector('#admin-dialog', { state: 'visible', timeout: 5000 });
    console.log('✓ Admin Dashboard visible.');
    await page.waitForTimeout(2000);

    // Switch to Users tab
    console.log('Navigating to Users tab...');
    await page.click('.admin-tab-btn:has-text("Users")');
    await page.waitForTimeout(1000);

    // Verify row for testUser exists
    const userRow = await page.waitForSelector(`tr:has-text("${testUser}")`, { state: 'visible', timeout: 5000 });
    console.log(`Found row for registered user: ${testUser}`);

    // Click delete user button
    const deleteBtn = await userRow.$('.admin-action-btn');
    console.log('Deleting user account...');
    await deleteBtn.click();

    // Verify user row disappears
    await page.waitForSelector(`tr:has-text("${testUser}")`, { state: 'hidden', timeout: 5000 });
    console.log(`✓ User ${testUser} successfully purged from database. No hung records.`);

    // Close admin dialog
    await page.click('#admin-dialog .close-dialog-btn');
    await page.waitForSelector('#admin-dialog', { state: 'hidden', timeout: 5000 });

    // Logout admin
    console.log('Logging out admin...');
    await page.click('.logout-btn');
    await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 5000 });
    
    console.log('✓ Admin logout completed.');
    await page.waitForTimeout(3000);

    await browser.close();
    console.log('\n========================================================================');
    console.log('ALL STEP-BY-STEP E2E CHECKS PASSED SUCCESSFULLY!');
    console.log('========================================================================\n');
    process.exitCode = 0;
  } catch (err) {
    console.error('\nE2E STEP-BY-STEP SUITE FAILED:', err);
    if (page) {
      try {
        const screenshotPath = path.join(projectRoot, 'e2e_error.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log('Error screenshot saved to:', screenshotPath);
        const htmlPath = path.join(projectRoot, 'e2e_error.html');
        fs.writeFileSync(htmlPath, await page.content(), 'utf8');
        console.log('Error HTML dumped to:', htmlPath);
      } catch (dumpErr) {
        console.error('Failed to dump on error:', dumpErr);
      }
    }
    process.exitCode = 1;
  } finally {
    server.kill();
    console.log('Express server stopped.');
  }
}

runStepByStepTest().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
