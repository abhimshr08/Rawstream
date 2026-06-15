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

async function runE2ETests() {
  const isHeadless = process.env.HEADLESS !== 'false';
  const testUser = 'e2e_tester_' + Math.floor(Math.random() * 1000000);
  console.log(`Starting expanded E2E verification test suite (headless=${isHeadless}, user=${testUser})...`);

  // Start Express server with seeded admin password
  const server = spawn(serverCmd, serverArgs, {
    cwd: projectRoot,
    env: { ...process.env, ADMIN_PASSWORD: 'adminpassword', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  let browser;
  let page;
  try {
    await waitForServer(`${host}/`, 20000);
    console.log('Server is responding. Launching browser context...');

    browser = await chromium.launch({
      headless: isHeadless,
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    page.on('console', msg => console.log(`[browser console] ${msg.type().toUpperCase()}: ${msg.text()}`));
    page.on('pageerror', err => console.error(`[browser pageerror] ${err}`));
    page.on('dialog', async dialog => {
      console.log(`[browser dialog] Type: ${dialog.type()}, Message: ${dialog.message()}`);
      await dialog.accept();
    });

    console.log('Navigating to RawStream...');
    await page.goto(host, { waitUntil: 'networkidle' });

    // Step 1: Verify AuthOverlay is visible on clean load
    console.log('Verifying AuthOverlay...');
    await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 5000 });
    console.log('AuthOverlay is visible.');

    // Step 1b: Register a new user
    console.log('Attempting user registration...');
    await page.click('.auth-switch-btn');
    await page.waitForSelector('#register-form', { state: 'visible', timeout: 5000 });
    await page.fill('#register-username', testUser);
    await page.fill('#register-password', 'Password123');
    await page.fill('#register-confirm-password', 'Password123');
    await page.click('#register-form button[type="submit"]');

    // Wait for auth overlay to close and main panel to show
    await page.waitForSelector('.auth-overlay', { state: 'hidden', timeout: 10000 });
    console.log('User registration and auto-login successful.');

    // Logout registered user to test login flow
    console.log('Logging out registered user...');
    await page.click('.logout-btn');
    await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 5000 });

    // Log in registered user
    console.log('Logging back in as registered user...');
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
    console.log('Login successful.');

    // Step 2: Stream local video file
    console.log('Streaming local test video...');
    const localVideoPath = path.join(projectRoot, 'test_faststart.mp4');
    const urlInput = await page.waitForSelector('input[placeholder*="Paste cloud link"]', { state: 'visible', timeout: 5000 });
    await urlInput.fill(localVideoPath);
    await page.click('button.load-media-action');

    // Verify video element created and playing
    console.log('Waiting for local video player start...');
    await page.waitForSelector('video', { timeout: 20000 });
    
    // Auto-click play overlay if present
    await page.evaluate(() => {
      const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
      if (playOverlay) playOverlay.click();
    });

    // Wait up to 15 seconds for local video playback to progress
    let startPlay = Date.now();
    let isLocalPlaying = false;
    while (Date.now() - startPlay < 15000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { readyState: v.readyState, currentTime: v.currentTime, paused: v.paused } : null;
      });
      console.log('Playback state (Local Video):', state);
      if (state && state.currentTime > 0.1 && !state.paused) {
        isLocalPlaying = true;
        break;
      }
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
        if (playOverlay) playOverlay.click();
      });
    }

    if (!isLocalPlaying) {
      throw new Error('Local video failed to play or progress.');
    } else {
      console.log('Local video is streaming successfully.');
    }

    // Step 2b: Toggle quality presets (Quality Switching & Transcoding) on local video
    console.log('Testing quality preset switching on local video...');
    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Quality resolution presets"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('#quality-menu', { state: 'attached', timeout: 5000 });
    
    // Click 720p option (second item)
    await page.evaluate(() => {
      const items = document.querySelectorAll('#quality-menu li');
      if (items && items[1]) items[1].click();
    });
    console.log('Switched to 720p. Waiting for source update...');

    // Wait for playback source to reflect quality parameter
    startPlay = Date.now();
    let qualitySwitched = false;
    while (Date.now() - startPlay < 15000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { src: v.src, currentTime: v.currentTime, paused: v.paused } : null;
      });
      console.log('Playback state after quality switch:', state);
      if (state && state.src.includes('quality=720p')) {
        qualitySwitched = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
    if (!qualitySwitched) {
      throw new Error('Quality parameter "quality=720p" not detected in video source.');
    } else {
      console.log('Successfully switched video stream to 720p quality preset.');
    }

    // Step 2c: Stream public Google Drive video link
    console.log('Streaming Google Drive test video...');
    const gdLink = 'https://drive.google.com/file/d/1rqN6qiR7lhAxsDpOj-8nMPNHYuhObySQ/view?usp=sharing';
    const gdUrlInput = await page.waitForSelector('input[placeholder*="Paste cloud link"]', { state: 'visible', timeout: 5000 });
    await gdUrlInput.fill(gdLink);
    await page.click('button.load-media-action');

    // Verify video element created and playing
    console.log('Waiting for Google Drive video player start...');
    await page.waitForSelector('video', { timeout: 20000 });
    
    // Auto-click play overlay if present
    await page.evaluate(() => {
      const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
      if (playOverlay) playOverlay.click();
    });

    // Wait up to 15 seconds for video playback to progress OR detect quota/access screens
    startPlay = Date.now();
    let isGDPlaying = false;
    let isQuotaScreen = false;
    while (Date.now() - startPlay < 15000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        const quotaPlaceholder = document.querySelector('.player-placeholder h3');
        const hasQuota = quotaPlaceholder && (quotaPlaceholder.textContent.includes('Quota') || quotaPlaceholder.textContent.includes('Access'));
        return { 
          currentTime: v ? v.currentTime : 0, 
          paused: v ? v.paused : true,
          hasQuota: !!hasQuota,
          quotaText: quotaPlaceholder ? quotaPlaceholder.textContent : ''
        };
      });
      console.log('Google Drive Playback check:', state);
      if (state.currentTime > 0.1 && !state.paused) {
        isGDPlaying = true;
        break;
      }
      if (state.hasQuota) {
        isQuotaScreen = true;
        break;
      }
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
        if (playOverlay) playOverlay.click();
      });
    }

    if (isGDPlaying) {
      console.log('Google Drive video is streaming directly and successfully.');
    } else if (isQuotaScreen) {
      console.log('Google Drive quota/access restriction detected. Switching to Embedded Player fallback...');
      await page.click('button:has-text("Play via Google Drive Embedded Player")');
      
      console.log('Waiting for Google Drive preview iframe to load...');
      const iframe = await page.waitForSelector('iframe[title="Google Drive Embedded Player"]', { state: 'visible', timeout: 10000 });
      if (iframe) {
        console.log('Google Drive preview iframe fallback verified successfully.');
      } else {
        throw new Error('Google Drive preview iframe did not load.');
      }
    } else {
      throw new Error('Google Drive streaming timed out without direct playback or fallback screen.');
    }

    // Step 3: BitTorrent / Magnet Playback
    console.log('Streaming Sintel BitTorrent Magnet link...');
    const magnetLink = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel';
    const inputForMagnet = await page.waitForSelector('input[placeholder*="Paste cloud link"]', { state: 'visible', timeout: 5000 });
    await inputForMagnet.fill(magnetLink);
    await page.click('button.load-media-action');

    console.log('Waiting for files explorer to load (up to 45s for torrent metadata resolution)...');
    await page.waitForSelector('.torrent-files-card', { state: 'visible', timeout: 45000 });
    console.log('Torrent files resolved. Selecting Sintel.mp4...');

    // Find and click the Stream button next to Sintel.mp4 if not already playing
    const fileRow = await page.waitForSelector('.file-row:has-text("Sintel.mp4")', { state: 'visible', timeout: 5000 });
    const streamBtn = await fileRow.$('.btn-action.stream');
    const isAlreadyPlaying = await streamBtn.evaluate(btn => btn.disabled);
    if (!isAlreadyPlaying) {
      console.log('Clicking stream button for Sintel.mp4...');
      await streamBtn.click();
    } else {
      console.log('Sintel.mp4 is already active/playing. Skipping click.');
    }

    console.log('Waiting for torrent video playback to start...');
    await page.waitForSelector('video', { timeout: 25000 });
    await page.evaluate(() => {
      const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
      if (playOverlay) playOverlay.click();
    });

    startPlay = Date.now();
    let torrentPlaying = false;
    while (Date.now() - startPlay < 20000) {
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { readyState: v.readyState, currentTime: v.currentTime, paused: v.paused } : null;
      });
      console.log('Torrent playback state:', state);
      if (state && state.currentTime > 0.1 && !state.paused) {
        torrentPlaying = true;
        break;
      }
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        const playOverlay = document.querySelector('#play-overlay') || document.querySelector('.large-play-btn');
        if (playOverlay) playOverlay.click();
      });
    }

    if (!torrentPlaying) {
      throw new Error('Torrent playback failed to start or progress in time.');
    } else {
      console.log('BitTorrent magnet stream Sintel.mp4 is playing successfully.');
    }

    // Step 3b: Test seeking in Sintel torrent
    console.log('Testing seeking forward in Sintel torrent direct stream...');
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) v.currentTime = 10;
    });
    console.log('Seeked Sintel to 10 seconds. Waiting to verify playback resumes...');
    await page.waitForTimeout(4000);
    const postSeekState = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? { currentTime: v.currentTime, paused: v.paused } : null;
    });
    console.log('Post-seek Sintel state:', postSeekState);
    if (!postSeekState || postSeekState.currentTime < 9.9 || postSeekState.paused) {
      throw new Error('Seeking in Sintel torrent direct stream failed or hung.');
    }
    console.log('Seeking in Sintel torrent verified successfully!');

    // Pause the video and keep currentTime at 10s to ensure subtitle cue remains active
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.pause();
        v.currentTime = 10;
      }
    });

    // Step 3c: Test custom subtitles timing
    console.log('Testing custom subtitles upload and timing...');
    const testSubsPath = path.join(projectRoot, 'test_subs.srt');
    fs.writeFileSync(testSubsPath, `1
00:00:08,000 --> 00:00:15,000
This is a subtitle at 10 seconds!`, 'utf8');

    // Click subtitles button to open subtitles menu so file input is rendered
    await page.click('button[title="Subtitles"]');
    await page.setInputFiles('#sub-upload-file', testSubsPath);
    console.log('Uploaded subtitles file test_subs.srt.');
    await page.waitForTimeout(2000); // wait for track loading and UI update

    const activeSubtitleText = await page.evaluate(() => {
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
      return activeText || 'No active showing cues';
    });
    console.log('Active subtitle cue text at 10s:', activeSubtitleText);
    if (!activeSubtitleText || !activeSubtitleText.includes('This is a subtitle at 10 seconds!')) {
      throw new Error(`Subtitle timing check failed: expected text not active. Got: ${activeSubtitleText}`);
    }
    console.log('Subtitle track timing and loading verified successfully!');

    // Clean up test subtitles file from disk
    try {
      fs.unlinkSync(testSubsPath);
    } catch (e) {}

    // Step 5: Check Watch History list & rename title
    console.log('Verifying History Sidebar operations...');
    
    // Open history sidebar if collapsed
    const isSidebarCollapsed = await page.evaluate(() => {
      return document.getElementById('history-sidebar')?.classList.contains('collapsed');
    });
    if (isSidebarCollapsed) {
      await page.click('button[title="Toggle Stream History"]');
    }

    const historyItem = await page.waitForSelector('.history-item', { state: 'visible', timeout: 5000 });
    const originalTitle = await historyItem.$eval('.item-title', el => el.textContent);
    console.log('History original title:', originalTitle);

    // Edit title
    await page.click('.history-item .item-action-btn.edit');
    await page.waitForSelector('.history-item .edit-title-input', { state: 'visible', timeout: 5000 });
    await page.fill('.history-item .edit-title-input', 'Renamed Torrent Stream');
    await page.click('.history-item .action-btn.save');

    // Wait for input to disappear
    await page.waitForSelector('.history-item .edit-title-input', { state: 'hidden', timeout: 5000 });

    const titleEl = await page.waitForSelector('.history-item .item-title', { state: 'visible', timeout: 5000 });
    const renamedTitle = (await titleEl.textContent()).trim();
    console.log('History renamed title:', renamedTitle);
    if (renamedTitle !== 'Renamed Torrent Stream') {
      throw new Error(`Renamed title mismatch: expected "Renamed Torrent Stream", got "${renamedTitle}"`);
    }
    console.log('History rename verified successfully.');

    // Step 6: Admin Panel Verification
    console.log('Logging out tester user...');
    await page.click('.logout-btn');
    await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 5000 });

    console.log('Logging in as admin...');
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

    console.log('Opening Admin Control Center...');
    const adminBtn = await page.waitForSelector('button[title="Admin Dashboard"]', { state: 'visible', timeout: 5000 });
    await adminBtn.click();

    // Verify dialog opened
    await page.waitForSelector('#admin-dialog', { state: 'visible', timeout: 5000 });
    console.log('Admin Dashboard opened.');

    // Wait for telemetry stats
    await page.waitForTimeout(2000);
    const metrics = await page.evaluate(() => {
      const activeUsers = document.querySelector('.metric-card:nth-child(1) .metric-value')?.textContent;
      const ramUsage = document.querySelector('.metric-card:nth-child(3) .metric-value')?.textContent;
      return { activeUsers, ramUsage };
    });
    console.log('Dashboard live telemetry:', metrics);

    // Switch to Users tab
    console.log('Switching to Users tab...');
    await page.click('.admin-tab-btn:has-text("Users")');
    await page.waitForTimeout(1000);

    // Verify e2e_tester_user is in the user list table
    const userRow = await page.waitForSelector(`tr:has-text("${testUser}")`, { state: 'visible', timeout: 5000 });
    console.log(`Found ${testUser} row in Users admin list.`);

    // Delete e2e_tester_user
    const deleteUserBtn = await userRow.$('.admin-action-btn');
    console.log(`Deleting registered ${testUser}...`);
    await deleteUserBtn.click();

    // Wait for the row to disappear
    await page.waitForSelector(`tr:has-text("${testUser}")`, { state: 'hidden', timeout: 5000 });
    console.log(`${testUser} successfully deleted from server users table.`);

    // Switch to Torrent Streams tab
    console.log('Switching to Torrent Streams tab...');
    await page.click('.admin-tab-btn:has-text("Torrent Streams")');
    await page.waitForTimeout(1000);

    // Close admin dialog
    await page.click('#admin-dialog .close-dialog-btn');
    await page.waitForSelector('#admin-dialog', { state: 'hidden', timeout: 5000 });
    console.log('Admin Control Center closed.');

    // Logout admin
    console.log('Logging out admin...');
    await page.click('.logout-btn');
    await page.waitForSelector('.auth-overlay', { state: 'visible', timeout: 5000 });
    console.log('Admin logged out successfully.');

    await browser.close();
    console.log('All comprehensive E2E tests passed successfully!');
    process.exitCode = 0;
  } catch (err) {
    console.error('E2E test suite failed:', err);
    if (page) {
      try {
        const screenshotPath = path.join(projectRoot, 'e2e_error.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log('Error screenshot saved to', screenshotPath);
        const htmlPath = path.join(projectRoot, 'e2e_error.html');
        const html = await page.content();
        fs.writeFileSync(htmlPath, html, 'utf8');
        console.log('Error HTML page dumped to', htmlPath);
      } catch (dumpErr) {
        console.error('Failed to dump page content on error:', dumpErr);
      }
    }
    process.exitCode = 1;
  } finally {
    server.kill();
    console.log('Server stopped.');
  }
}

runE2ETests().catch(err => {
  console.error('Unhandled E2E runner error:', err);
  process.exit(1);
});
