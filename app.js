/**
 * CloudStream - Core Client-Side Logic
 * Handles URL parsing, custom media player controls, local storage history, and keyboard accessibility.
 */

class CloudStreamApp {
  constructor() {
    // State
    this.history = this.loadHistory();
    this.currentVideo = null;
    this.controlsTimeout = null;
    this.volumeMemory = 1.0;
    this.isMuted = false;
    this.torrentClient = null;
    this.activeTorrent = null;
    this.videoRotation = 0;
    this.videoAspect = 'contain';
    this.videoMirror = 'none';
    this.needsTranscode = false;
    this.transcodeStartTime = 0;
    this.mediaDuration = 0;
    this.vcodec = '';
    this.acodec = '';
    this.currentDriveFileId = null;  // set when streaming a Google Drive file
    this.driveCurrentTime = 0;       // tracked manually for Drive streams

    // DOM Elements Cache
    this.dom = {
      streamForm: document.getElementById('media-parser-form'),
      streamUrl: document.getElementById('media-target-url'),
      pasteBtn: document.getElementById('paste-control-trigger'),
      loadBtn: document.getElementById('trigger-stream-load'),
      clearBtn: document.getElementById('trigger-reset-fields'),
      detectionBadge: document.getElementById('detection-badge'),
      detectedServiceName: document.getElementById('detected-service-name'),
      
      // Torrent Stats elements
      torrentStatsCard: document.getElementById('torrent-stats-card'),
      torrentName: document.getElementById('torrent-name'),
      torrentSpeed: document.getElementById('torrent-speed'),
      torrentPeers: document.getElementById('torrent-peers'),
      torrentProgress: document.getElementById('torrent-progress'),
      inputCard: document.querySelector('.input-card'),
      
      // Player
      playerContainer: document.getElementById('player-container'),
      video: document.getElementById('video-element'),
      playOverlay: document.getElementById('play-overlay'),
      videoControls: document.getElementById('video-controls'),
      progressBar: document.getElementById('progress-bar'),
      progressHoverTime: document.getElementById('progress-hover-time'),
      playBtn: document.getElementById('play-btn'),
      skipBackBtn: document.getElementById('skip-back-btn'),
      skipForwardBtn: document.getElementById('skip-forward-btn'),
      muteBtn: document.getElementById('mute-btn'),
      volumeSlider: document.getElementById('volume-slider'),
      currentTime: document.getElementById('current-time'),
      durationTime: document.getElementById('duration-time'),
      speedBtn: document.getElementById('speed-btn'),
      speedMenu: document.getElementById('speed-menu'),
      theaterBtn: document.getElementById('theater-btn'),
      fullscreenBtn: document.getElementById('fullscreen-btn'),
      aspectOrientBtn: document.getElementById('aspect-orient-btn'),
      aspectOrientMenu: document.getElementById('aspect-orient-menu'),
      playerPlaceholder: document.getElementById('player-placeholder'),
      playerLoader: document.getElementById('player-loader'),
      
      // History Sidebar
      toggleHistoryBtn: document.getElementById('toggle-history-btn'),
      historySidebar: document.getElementById('history-sidebar'),
      historyList: document.getElementById('history-list'),
      historyEmpty: document.getElementById('history-empty'),
      clearHistoryBtn: document.getElementById('clear-history-btn'),
      
      // Modals & Notifications
      helpBtn: document.getElementById('help-btn'),
      shortcutsDialog: document.getElementById('shortcuts-dialog'),
      notification: document.getElementById('notification'),
      notificationMessage: document.getElementById('notification-message'),
      
      // Live Debug Log
      debugLogs: document.getElementById('debug-logs'),
      clearDebugBtn: document.getElementById('clear-debug-btn')
    };

    this.originalPlaceholderHtml = this.dom.playerPlaceholder.innerHTML;

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupDragAndDrop();
    this.setupResizeObserver();
    this.renderHistory();
    this.checkClipboardPermission();
  }

  setupEventListeners() {
    // Form Events
    this.dom.streamForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
    this.dom.streamUrl.addEventListener('input', () => this.handleUrlInput());
    this.dom.clearBtn.addEventListener('click', () => this.clearInput());
    this.dom.pasteBtn.addEventListener('click', () => this.pasteFromClipboard());

    // Video Playback Events
    this.dom.video.addEventListener('play', () => this.onPlay());
    this.dom.video.addEventListener('pause', () => this.onPause());
    this.dom.video.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.dom.video.addEventListener('durationchange', () => this.onDurationChange());
    this.dom.video.addEventListener('waiting', () => this.showLoader(true));
    this.dom.video.addEventListener('playing', () => this.showLoader(false));
    this.dom.video.addEventListener('ended', () => this.onVideoEnded());
    this.dom.video.addEventListener('error', (e) => this.onVideoError(e));
    // Track real-time position for Drive streams
    this.dom.video.addEventListener('timeupdate', () => {
      if (this.currentDriveFileId) {
        this.driveCurrentTime = this.driveSeekBase + this.dom.video.currentTime;
      }
    });

    // Custom Controls Interactive Events
    this.dom.playBtn.addEventListener('click', () => this.togglePlay());
    this.dom.playOverlay.addEventListener('click', () => this.togglePlay());
    this.dom.skipBackBtn.addEventListener('click', () => this.skip(-10));
    this.dom.skipForwardBtn.addEventListener('click', () => this.skip(10));
    this.dom.progressBar.addEventListener('input', (e) => this.onProgressBarInput(e));
    this.dom.progressBar.addEventListener('change', (e) => this.onProgressBarChange(e));
    this.dom.progressBar.addEventListener('mousemove', (e) => this.onProgressBarHover(e));
    this.dom.volumeSlider.addEventListener('input', (e) => this.onVolumeInput(e));
    this.dom.muteBtn.addEventListener('click', () => this.toggleMute());
    
    // Playback Speed dropdown
    this.dom.speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dom.speedMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      this.dom.speedMenu.classList.add('hidden');
    });
    this.dom.speedMenu.querySelectorAll('li').forEach(item => {
      item.addEventListener('click', (e) => this.changeSpeed(e));
    });

    // Screen Toggles
    this.dom.theaterBtn.addEventListener('click', () => this.toggleTheaterMode());
    this.dom.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    
    // Aspect & Orientation dropdown toggles
    this.dom.aspectOrientBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dom.aspectOrientMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      this.dom.aspectOrientMenu.classList.add('hidden');
    });
    this.dom.aspectOrientMenu.querySelectorAll('li[data-action]').forEach(item => {
      item.addEventListener('click', (e) => this.handleAspectOrientChange(e));
    });

    this.dom.video.addEventListener('dblclick', () => this.toggleFullscreen());
    window.addEventListener('resize', () => this.applyVideoStyles());

    // Hover reveals controls
    this.dom.playerContainer.addEventListener('mousemove', () => this.showControlsWithTimeout());
    this.dom.playerContainer.addEventListener('mouseleave', () => this.hideControls());

    // Sidebar Toggles
    this.dom.toggleHistoryBtn.addEventListener('click', () => this.toggleHistorySidebar());
    this.dom.clearHistoryBtn.addEventListener('click', () => this.clearAllHistory());

    // Help Dialog Modal
    this.dom.helpBtn.addEventListener('click', () => this.dom.shortcutsDialog.showModal());

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

    // Debug clear button
    if (this.dom.clearDebugBtn) {
      this.dom.clearDebugBtn.addEventListener('click', () => {
        if (this.dom.debugLogs) this.dom.debugLogs.innerHTML = '[Logs cleared]';
      });
    }

    // Detailed Video Debug Event Logging
    const events = [
      'loadstart', 'suspend', 'abort', 'error', 'emptied', 'stalled', 
      'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 
      'playing', 'waiting', 'seeking', 'seeked'
    ];
    events.forEach(eventName => {
      this.dom.video.addEventListener(eventName, (e) => {
        let extra = '';
        if (eventName === 'error' && this.dom.video.error) {
          extra = ` (code: ${this.dom.video.error.code}, message: ${this.dom.video.error.message})`;
        } else if (eventName === 'loadedmetadata') {
          extra = ` (duration: ${this.formatTime(this.dom.video.duration)})`;
        }
        this.logDebug(`Video Event: ${eventName}${extra} [networkState: ${this.dom.video.networkState}, readyState: ${this.dom.video.readyState}]`);
      });
    });

    // Window Errors Logging
    window.addEventListener('error', (e) => {
      this.logDebug(`JS Error: ${e.message} at ${e.filename}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.logDebug(`Promise Reject: ${e.reason}`);
    });
  }

  // Helper: Display Alert Notifications
  showNotification(message, duration = 3000) {
    this.dom.notificationMessage.textContent = message;
    this.dom.notification.classList.remove('hidden');
    
    // Force a redraw
    this.dom.notification.offsetHeight;
    
    setTimeout(() => {
      this.dom.notification.classList.add('hidden');
    }, duration);
  }

  // Check clipboard permission for "Paste" button
  async checkClipboardPermission() {
    try {
      const result = await navigator.permissions.query({ name: 'clipboard-read' });
      if (result.state === 'denied') {
        this.dom.pasteBtn.style.opacity = '0.5';
        this.dom.pasteBtn.title = 'Clipboard access blocked. Please paste manually.';
      }
    } catch (e) {
      // Permission API not supported fully in this configuration, fallback silently
    }
  }

  // Paste URL directly from clipboard
  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      this.dom.streamUrl.value = text;
      this.handleUrlInput();
      this.showNotification('URL pasted from clipboard');
      this.dom.streamUrl.focus();
    } catch (err) {
      this.showNotification('Failed to read clipboard. Please paste using Cmd+V/Ctrl+V.');
    }
  }

  // Clear URL input field
  clearInput() {
    this.dom.streamUrl.value = '';
    this.dom.detectionBadge.classList.add('hidden');
    this.destroyTorrent();
    this.dom.streamUrl.focus();
  }

  // Auto-detect service on input
  handleUrlInput() {
    const url = this.dom.streamUrl.value.trim();
    this.logDebug(`Input changed (length: ${url.length})`);
    if (!url) {
      this.dom.detectionBadge.classList.add('hidden');
      return;
    }

    const service = this.detectService(url);
    if (service !== 'unknown') {
      let serviceLabel = '';
      if (service === 'google') serviceLabel = 'Google Drive';
      else if (service === 'onedrive') serviceLabel = 'Microsoft OneDrive';
      else if (service === 'torrent') serviceLabel = 'BitTorrent Magnet';
      else if (service === 'local') serviceLabel = 'Local File';

      this.dom.detectedServiceName.textContent = `${serviceLabel} detected`;
      this.dom.detectionBadge.className = 'detection-badge';
      this.dom.detectionBadge.classList.remove('hidden');
    } else {
      this.dom.detectionBadge.classList.add('hidden');
    }
  }

  // Form Submit Handler
  handleFormSubmit(e) {
    e.preventDefault();
    const url = this.dom.streamUrl.value.trim();
    this.logDebug(`Form submitted. URL: "${url}"`);
    if (!url) {
      this.logDebug("Form submit blocked: empty URL");
      return;
    }

    this.loadVideoFromUrl(url);
  }

  // Core Link Parsers
  detectService(url) {
    const lowerUrl = url.toLowerCase();
    if (url.startsWith('/') || /^[a-zA-Z]:\\/.test(url)) {
      return 'local';
    }
    if (lowerUrl.startsWith('magnet:') || lowerUrl.endsWith('.torrent')) {
      return 'torrent';
    }
    if (lowerUrl.includes('drive.google.com') || lowerUrl.includes('docs.google.com')) {
      return 'google';
    } else if (
      lowerUrl.includes('onedrive.live.com') || 
      lowerUrl.includes('1drv.ms') || 
      lowerUrl.includes('sharepoint.com') || 
      lowerUrl.includes('api.onedrive.com')
    ) {
      return 'onedrive';
    }
    return 'unknown';
  }

  parseGoogleDriveLink(url) {
    // Match common Google Drive URL variants to extract file ID
    const reg1 = /\/file\/d\/([a-zA-Z0-9_-]+)/;
    const reg2 = /[?&]id=([a-zA-Z0-9_-]+)/;
    const match = url.match(reg1) || url.match(reg2);
    
    if (match && match[1]) {
      return { id: match[1] };
    }
    return null;
  }

  parseOneDriveLink(url) {
    try {
      // If it's already a transformed OneDrive API link, use it directly
      if (url.includes('api.onedrive.com/v1.0/shares/')) {
        return {
          id: url.split('u!')[1].split('/')[0],
          streamUrl: url
        };
      }
      
      // Standard Microsoft Graph API conversion: Base64 encode the share link
      const base64Value = btoa(url);
      const safeBase64 = base64Value
        .replace(/\//g, '_')
        .replace(/\+/g, '-')
        .replace(/=+$/, '');
      
      return {
        id: safeBase64,
        streamUrl: `https://api.onedrive.com/v1.0/shares/u!${safeBase64}/root/content`
      };
    } catch (e) {
      console.error('OneDrive parse error', e);
      return null;
    }
  }

  // Load Video Logic
  async loadVideoFromUrl(url, customTitle = null) {
    // Clean up any running torrent first
    this.destroyTorrent();

    // Reset settings
    this.videoRotation = 0;
    this.videoAspect = 'contain';
    this.videoMirror = 'none';
    this.updateAspectOrientMenuUI();
    this.applyVideoStyles();
    // Reset Drive seek state
    this.currentDriveFileId = null;
    this.driveCurrentTime = 0;
    this.driveSeekBase = 0;

    const service = this.detectService(url);
    if (service === 'torrent') {
      this.needsTranscode = false;
      this.loadTorrent(url);
      return;
    }

    // Show loading spinner immediately
    this.showLoader(true);
    this.dom.playerPlaceholder.classList.add('hidden');
    this.dom.videoControls.classList.add('hidden-controls');

    let id = '';
    let streamUrl = '';

    // ── Google Drive: use Puppeteer-based resolver ──────────────────────────
    if (service === 'google') {
      const parsedData = this.parseGoogleDriveLink(url);
      if (!parsedData) {
        this.showNotification('Error: Could not extract Google Drive file ID from this link.');
        this.resetPlayerToPlaceholder();
        return;
      }

      id = parsedData.id;
      this.setLoaderMessage('Connecting to Google Drive stream...');
      this.logDebug(`Resolving Google Drive stream for fileId: ${id}`);

      try {
        const resolveRes = await fetch(`/api/resolve?fileId=${encodeURIComponent(id)}`);
        const resolveData = await resolveRes.json();

        if (!resolveRes.ok || resolveData.error) {
          throw new Error(resolveData.error || `Resolve failed (${resolveRes.status})`);
        }

        streamUrl = resolveData.streamUrl; // /api/gdrive-stream?fileId=...
        this.logDebug(`Drive stream resolved. Proxy URL: ${streamUrl}`);
        this.currentDriveFileId = id;
        this.driveSeekBase = 0;
        this.driveCurrentTime = 0;

        // Probe duration using yt-dlp metadata endpoint
        try {
          const metaRes = await fetch(`/api/gdrive-meta?fileId=${encodeURIComponent(id)}`);
          if (metaRes.ok) {
            const meta = await metaRes.json();
            if (meta.duration) {
              this.mediaDuration = meta.duration;
              this.dom.durationTime.textContent = this.formatTime(meta.duration);
              this.logDebug(`Drive duration from metadata: ${this.formatTime(meta.duration)}`);
            }
          }
        } catch (metaErr) {
          this.logDebug(`Metadata fetch skipped: ${metaErr.message}`);
        }

        // Google Drive's player transcodes server-side — browser always gets h264/mp4
        this.needsTranscode = false;
        this.transcodeStartTime = 0;
        this.vcodec = 'h264';
        this.acodec = 'aac';

        this.setLoaderMessage('Stream ready — buffering...');

      } catch (err) {
        this.logDebug(`Drive resolve error: ${err.message}`);
        this.showResolveError(err.message);
        return;
      }

    // ── OneDrive / local / generic ──────────────────────────────────────────
    } else {
      if (service === 'local') {
        id = 'local_' + url.replace(/[^a-zA-Z0-9]/g, '_');
        streamUrl = url;
      } else if (service === 'onedrive') {
        const parsedData = this.parseOneDriveLink(url);
        if (!parsedData) {
          this.showNotification('Error: Could not parse OneDrive link.');
          this.resetPlayerToPlaceholder();
          return;
        }
        id = parsedData.id;
        streamUrl = parsedData.streamUrl;
      } else {
        this.showNotification('Error: Unsupported link. Paste a Google Drive, OneDrive, or Magnet URI.');
        this.resetPlayerToPlaceholder();
        return;
      }

      // Probe for codec info and transcoding need
      this.setLoaderMessage('Analyzing media...');
      this.logDebug(`Probing media: ${streamUrl}`);
      try {
        const probeRes = await fetch(`/api/probe?url=${encodeURIComponent(streamUrl)}`);
        const probeData = await probeRes.json();

        if (probeData.error) throw new Error(probeData.error);

        this.logDebug(`Probe: needsTranscode=${probeData.needsTranscode}, v=${probeData.videoCodec}, a=${probeData.audioCodec}`);
        this.needsTranscode = probeData.needsTranscode;
        this.mediaDuration = probeData.duration;
        this.vcodec = probeData.videoCodec;
        this.acodec = probeData.audioCodec;
        this.transcodeStartTime = 0;
      } catch (err) {
        this.logDebug(`Probe skipped (${err.message}), using direct stream.`);
        this.needsTranscode = false;
        this.mediaDuration = 0;
        this.transcodeStartTime = 0;
      }

      if (this.needsTranscode) {
        streamUrl = `/api/stream?url=${encodeURIComponent(streamUrl)}&transcode=true&vcodec=${encodeURIComponent(this.vcodec)}&acodec=${encodeURIComponent(this.acodec)}`;
        this.logDebug('Video requires transcoding/remuxing. Spawning ffmpeg source.');
      } else {
        streamUrl = `/api/stream?url=${encodeURIComponent(streamUrl)}`;
        this.logDebug('Video codec natively supported. Loading direct stream.');
      }
    }

    // ── Set source and start playback ────────────────────────────────────────
    this.setLoaderMessage('Buffering stream...');
    this.logDebug(`Setting video src: ${streamUrl}`);
    this.dom.video.src = streamUrl;
    this.dom.video.load();
    this.dom.videoControls.classList.remove('hidden-controls');

    if (this.needsTranscode && this.mediaDuration > 0) {
      this.dom.durationTime.textContent = this.formatTime(this.mediaDuration);
    }

    const formattedDate = new Date().toLocaleDateString();
    let autoTitle = '';
    if (service === 'local') {
      autoTitle = customTitle || `${url.split('/').pop()} (Local)`;
    } else {
      const serviceLabel = service === 'google' ? 'Google Drive' : 'OneDrive';
      autoTitle = customTitle || `Stream - ${serviceLabel} (${formattedDate})`;
    }

    this.currentVideo = {
      id,
      title: autoTitle,
      originalUrl: url,
      streamUrl,
      service,
      timestamp: Date.now()
    };

    this.dom.video.play()
      .then(() => {
        this.logDebug('Autoplay succeeded.');
        this.addToHistory(this.currentVideo);
      })
      .catch((err) => {
        this.logDebug(`Autoplay blocked: ${err.name}. Click Play to start.`);
        this.addToHistory(this.currentVideo);
      });
  }

  showResolveError(message) {
    this.showLoader(false);
    this.dom.playerPlaceholder.classList.remove('hidden');
    this.dom.videoControls.classList.add('hidden-controls');
    
    this.dom.playerPlaceholder.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" style="width: 64px; height: 64px; margin-bottom: 1rem;">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <h3 style="color: #ef4444; font-size: 1.25rem; font-weight: 600;">Stream Resolution Failed</h3>
      <p style="max-width: 440px; margin: 0.5rem auto; line-height: 1.5; color: rgba(255,255,255,0.7); font-size: 0.9rem;">
        Could not resolve the Google Drive stream. This can happen if the file's sharing is set to <strong style="color:white">"Restricted"</strong> instead of <strong style="color:white">"Anyone with the link"</strong>.
      </p>
      <p style="font-size: 0.8rem; color: rgba(255,255,255,0.4); margin-top: 0.5rem; font-family: monospace;">${message}</p>
      <div style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px; padding: 0.85rem; margin-top: 1.2rem; font-size: 0.85rem; max-width: 450px; text-align: left; line-height: 1.6; color: rgba(255,255,255,0.85);">
        <strong style="color: #ef4444; display: block; margin-bottom: 0.4rem;">Fix sharing permissions:</strong>
        Open the file in Google Drive → click <strong>Share</strong> → under General Access, set to <strong>"Anyone with the link can view"</strong> → copy the link and try again.
      </div>
    `;
  }

  setLoaderMessage(msg) {
    const p = this.dom.playerLoader ? this.dom.playerLoader.querySelector('p') : null;
    if (p) p.innerHTML = msg.replace(/\n/g, '<br>');
  }

  showQuotaExceededWarning() {
    // Legacy — now handled automatically via Puppeteer resolver. Show generic error.
    this.showResolveError('Download quota exceeded — try the Puppeteer resolver path.');
  }

  showAccessDeniedWarning() {
    this.showLoader(false);
    this.dom.playerPlaceholder.classList.remove('hidden');
    this.dom.videoControls.classList.add('hidden-controls');
    
    this.dom.playerPlaceholder.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.5" style="width: 64px; height: 64px; margin-bottom: 1rem;">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <circle cx="12" cy="16" r="1"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
      </svg>
      <h3 style="color: #f59e0b; font-size: 1.25rem; font-weight: 600;">File Access Restricted (Private File)</h3>
      <p style="max-width: 420px; margin: 0.5rem auto; line-height: 1.5; color: rgba(255, 255, 255, 0.7); font-size: 0.9rem;">
        Google Drive has returned a "Not Found" or "Access Denied" error. This is because the sharing link is private or restricted.
      </p>
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 0.85rem; margin-top: 1.2rem; font-size: 0.85rem; max-width: 450px; text-align: left; line-height: 1.5; color: rgba(255,255,255,0.85);">
        <strong style="color: #f59e0b; display: block; margin-bottom: 0.25rem;">How to fix this:</strong>
        <ol style="margin: 0; padding-left: 1.2rem;">
          <li>Go to your Google Drive and open the file.</li>
          <li>Click the <strong>Share</strong> button in the top right.</li>
          <li>Under <strong>General Access</strong>, change the setting from <strong>Restricted</strong> to <strong>"Anyone with the link can view"</strong>.</li>
          <li>Copy the new link and paste it here to stream!</li>
        </ol>
      </div>
    `;
    this.showNotification('Access denied. Verify file sharing permissions.');
  }

  resetPlayerToPlaceholder() {
    this.showLoader(false);
    this.dom.playerPlaceholder.innerHTML = this.originalPlaceholderHtml;
    this.dom.playerPlaceholder.classList.remove('hidden');
    this.dom.videoControls.classList.add('hidden-controls');
    this.dom.video.removeAttribute('src');
    this.dom.video.load();
  }

  // Video Events Handlers
  onPlay() {
    this.dom.playBtn.querySelector('.play-icon').classList.add('hidden');
    this.dom.playBtn.querySelector('.pause-icon').classList.remove('hidden');
    this.dom.playOverlay.classList.add('faded');
    this.showControlsWithTimeout();
  }

  onPause() {
    this.dom.playBtn.querySelector('.play-icon').classList.remove('hidden');
    this.dom.playBtn.querySelector('.pause-icon').classList.add('hidden');
    this.dom.playOverlay.classList.remove('faded');
    this.showControls();
  }

  onTimeUpdate() {
    const video = this.dom.video;
    let duration, displayTime;

    if (this.currentDriveFileId && this.mediaDuration > 0) {
      // Drive stream: use driveSeekBase + video.currentTime for true position
      duration = this.mediaDuration;
      displayTime = this.driveSeekBase + video.currentTime;
    } else if (this.needsTranscode) {
      duration = this.mediaDuration;
      displayTime = this.transcodeStartTime + video.currentTime;
    } else {
      duration = video.duration;
      displayTime = video.currentTime;
    }

    if (isNaN(duration) || duration <= 0) return;

    const percentage = (displayTime / duration) * 100;
    this.dom.progressBar.value = Math.min(percentage, 100);
    this.updateProgressBarGradient();
    this.dom.currentTime.textContent = this.formatTime(displayTime);
  }

  onDurationChange() {
    if (this.currentDriveFileId) {
      // Duration is known from metadata; show it but don't overwrite it from video element
      if (this.mediaDuration > 0) {
        this.dom.durationTime.textContent = this.formatTime(this.mediaDuration);
      }
    } else if (!this.needsTranscode) {
      this.dom.durationTime.textContent = this.formatTime(this.dom.video.duration);
    }
  }

  showLoader(show) {
    if (show) {
      this.dom.playerLoader.classList.remove('hidden');
    } else {
      this.dom.playerLoader.classList.add('hidden');
    }
  }

  onVideoEnded() {
    this.onPause();
    this.dom.progressBar.value = 0;
    this.updateProgressBarGradient();
    this.dom.video.currentTime = 0;
  }

  async onVideoError(e) {
    console.error('Video element loading error:', e);
    this.showLoader(false);

    const proxiedUrl = this.dom.video.src;
    if (proxiedUrl && proxiedUrl.includes('/api/stream')) {
      this.logDebug(`Video loading failed. Diagnosing stream error...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        const checkRes = await fetch(proxiedUrl, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const contentType = checkRes.headers.get('content-type') || '';
        
        if (!checkRes.ok || checkRes.status === 429 || contentType.includes('application/json') || contentType.includes('text/html')) {
          // Read the small error payload
          const errText = await checkRes.text();
          let errData = {};
          try {
            errData = JSON.parse(errText);
          } catch (pErr) {}

          if (errData.error === 'QUOTA_EXCEEDED' || checkRes.status === 429 || errText.includes('Quota exceeded')) {
            this.logDebug(`Diagnosis: Google Drive quota exceeded.`);
            this.showQuotaExceededWarning();
            return;
          } else if (
            errData.error === 'AUTH_REQUIRED' || 
            errData.error === 'ACCESS_DENIED' || 
            checkRes.status === 401 || 
            checkRes.status === 403 || 
            checkRes.status === 404 || 
            errText.includes('sign in') || 
            errText.includes('Sign in')
          ) {
            this.logDebug(`Diagnosis: Authentication or permissions required (status: ${checkRes.status}).`);
            this.showAccessDeniedWarning();
            return;
          }
        } else {
          // Success response headers received. Abort download to save bandwidth
          this.logDebug(`Diagnosis: Stream headers ok (status: ${checkRes.status}). Aborting diagnostic stream.`);
          controller.abort();
        }
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') {
          this.logDebug(`Diagnostics: Connection check timed out or aborted cleanly.`);
        } else {
          this.logDebug(`Diagnostics check failed: ${fetchErr.message}`);
        }
      }
    }

    this.showNotification('Error loading stream. Ensure the file permissions are public ("Anyone with the link can view").');
    this.resetPlayerToPlaceholder();
  }

  // Custom Controls Functions
  togglePlay() {
    if (this.dom.video.paused) {
      this.dom.video.play().catch(err => {
        this.showNotification('Play failed. Check connectivity or link permissions.');
      });
    } else {
      this.dom.video.pause();
    }
  }

  skip(seconds) {
    if (this.currentDriveFileId && this.mediaDuration > 0) {
      const currentPos = this.driveSeekBase + this.dom.video.currentTime;
      const seekTime = Math.max(0, Math.min(this.mediaDuration, currentPos + seconds));
      this.seekGDriveStream(seekTime);
    } else {
      const duration = this.needsTranscode ? this.mediaDuration : this.dom.video.duration;
      const currentTime = this.needsTranscode
        ? (this.transcodeStartTime + this.dom.video.currentTime)
        : this.dom.video.currentTime;
      const seekTime = Math.max(0, Math.min(duration || 0, currentTime + seconds));
      if (this.needsTranscode) {
        this.seekTranscodedStream(seekTime);
      } else {
        this.dom.video.currentTime = seekTime;
      }
    }
  }

  onProgressBarInput(e) {
    // Keep styling gradient during slider drag
    this.updateProgressBarGradient();
  }

  onProgressBarChange(e) {
    const duration = this.currentDriveFileId
      ? this.mediaDuration
      : (this.needsTranscode ? this.mediaDuration : this.dom.video.duration);
    if (isNaN(duration) || duration <= 0) return;
    
    const percentage = e.target.value;
    const seekTime = (percentage / 100) * duration;

    if (this.currentDriveFileId) {
      this.seekGDriveStream(seekTime);
    } else if (this.needsTranscode) {
      this.seekTranscodedStream(seekTime);
    } else {
      this.dom.video.currentTime = seekTime;
    }
  }

  onProgressBarHover(e) {
    const duration = this.needsTranscode ? this.mediaDuration : this.dom.video.duration;
    if (isNaN(duration) || duration <= 0) return;

    const rect = this.dom.progressBar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const hoverTimeSeconds = pos * duration;
    
    this.dom.progressHoverTime.textContent = this.formatTime(hoverTimeSeconds);
    this.dom.progressHoverTime.style.left = `${pos * 100}%`;
  }

  updateProgressBarGradient() {
    const value = this.dom.progressBar.value;
    // Creates visual active track fill using CSS gradients
    this.dom.progressBar.style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${value}%, rgba(255, 255, 255, 0.2) ${value}%, rgba(255, 255, 255, 0.2) 100%)`;
  }

  onVolumeInput(e) {
    const vol = parseFloat(e.target.value);
    this.dom.video.volume = vol;
    this.volumeMemory = vol;

    if (vol === 0) {
      this.isMuted = true;
      this.setMuteIcons(true);
    } else {
      this.isMuted = false;
      this.setMuteIcons(false);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.dom.video.volume = 0;
      this.dom.volumeSlider.value = 0;
      this.setMuteIcons(true);
    } else {
      const restoreVol = this.volumeMemory > 0.05 ? this.volumeMemory : 1.0;
      this.dom.video.volume = restoreVol;
      this.dom.volumeSlider.value = restoreVol;
      this.setMuteIcons(false);
    }
  }

  setMuteIcons(muted) {
    if (muted) {
      this.dom.muteBtn.querySelector('.volume-high-icon').classList.add('hidden');
      this.dom.muteBtn.querySelector('.volume-muted-icon').classList.remove('hidden');
    } else {
      this.dom.muteBtn.querySelector('.volume-high-icon').classList.remove('hidden');
      this.dom.muteBtn.querySelector('.volume-muted-icon').classList.add('hidden');
    }
  }

  changeSpeed(e) {
    const rate = parseFloat(e.target.getAttribute('data-speed'));
    this.dom.video.playbackRate = rate;

    // Toggle dropdown active item UI
    this.dom.speedMenu.querySelectorAll('li').forEach(item => item.classList.remove('active'));
    e.target.classList.add('active');
    
    // Update button text
    this.dom.speedBtn.querySelector('span').textContent = `${rate === 1 ? '1.0' : rate}x`;
    this.showNotification(`Playback speed: ${rate}x`);
  }

  toggleTheaterMode() {
    this.dom.playerContainer.classList.toggle('theater');
    const isTheater = this.dom.playerContainer.classList.contains('theater');
    this.showNotification(isTheater ? 'Theater mode entered' : 'Standard mode entered');
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.dom.playerContainer.requestFullscreen()
        .then(() => {
          this.dom.fullscreenBtn.querySelector('.fullscreen-enter').classList.add('hidden');
          this.dom.fullscreenBtn.querySelector('.fullscreen-exit').classList.remove('hidden');
        })
        .catch(err => {
          this.showNotification('Fullscreen not supported or blocked by browser.');
        });
    } else {
      document.exitFullscreen()
        .then(() => {
          this.dom.fullscreenBtn.querySelector('.fullscreen-enter').classList.remove('hidden');
          this.dom.fullscreenBtn.querySelector('.fullscreen-exit').classList.add('hidden');
        });
    }
  }

  handleAspectOrientChange(e) {
    const action = e.target.getAttribute('data-action');
    const val = e.target.getAttribute('data-val');
    if (!action || val === null) return;

    if (action === 'rotate') {
      this.videoRotation = parseInt(val);
      this.showNotification(`Rotation: ${this.videoRotation}°`);
    } else if (action === 'aspect') {
      this.videoAspect = val;
      this.showNotification(`Aspect ratio: ${e.target.textContent}`);
    } else if (action === 'mirror') {
      this.videoMirror = val;
      this.showNotification(`Mirroring: ${e.target.textContent}`);
    }

    // Update active class in menu UI
    const siblings = e.target.parentNode.querySelectorAll(`li[data-action="${action}"]`);
    siblings.forEach(li => li.classList.remove('active'));
    e.target.classList.add('active');

    this.applyVideoStyles();
  }

  updateAspectOrientMenuUI() {
    const menu = this.dom.aspectOrientMenu;
    if (!menu) return;
    
    // Clear active classes
    menu.querySelectorAll('li[data-action]').forEach(li => li.classList.remove('active'));
    
    // Set active based on current state
    const rotLi = menu.querySelector(`li[data-action="rotate"][data-val="${this.videoRotation}"]`);
    const aspLi = menu.querySelector(`li[data-action="aspect"][data-val="${this.videoAspect}"]`);
    const mirLi = menu.querySelector(`li[data-action="mirror"][data-val="${this.videoMirror}"]`);
    
    if (rotLi) rotLi.classList.add('active');
    if (aspLi) aspLi.classList.add('active');
    if (mirLi) mirLi.classList.add('active');
  }

  applyVideoStyles() {
    const video = this.dom.video;
    if (!video) return;

    // Reset styles
    video.style.transform = '';
    video.style.width = '';
    video.style.height = '';
    video.style.aspectRatio = '';
    video.style.objectFit = '';

    // Apply aspect ratio (object-fit / aspect-ratio)
    if (this.videoAspect === 'contain' || this.videoAspect === 'cover' || this.videoAspect === 'fill') {
      video.style.objectFit = this.videoAspect;
      video.style.width = '100%';
      video.style.height = '100%';
    } else if (this.videoAspect === '16-9') {
      video.style.objectFit = 'fill';
      video.style.aspectRatio = '16 / 9';
      video.style.width = '100%';
      video.style.height = 'auto';
    } else if (this.videoAspect === '4-3') {
      video.style.objectFit = 'fill';
      video.style.aspectRatio = '4 / 3';
      video.style.width = 'auto';
      video.style.height = '100%';
    }

    // Apply rotation & mirroring
    let transforms = [];
    
    if (this.videoRotation !== 0) {
      transforms.push(`rotate(${this.videoRotation}deg)`);
    }

    if (this.videoMirror === 'horizontal') {
      transforms.push('scaleX(-1)');
    } else if (this.videoMirror === 'vertical') {
      transforms.push('scaleY(-1)');
    }

    // If rotated 90 or 270 degrees, scale to fit inside parent container
    if (this.videoRotation === 90 || this.videoRotation === 270) {
      const containerWidth = this.dom.playerContainer.clientWidth;
      const containerHeight = this.dom.playerContainer.clientHeight;
      if (containerWidth && containerHeight) {
        const scaleFactor = Math.min(containerWidth / containerHeight, containerHeight / containerWidth);
        transforms.push(`scale(${scaleFactor})`);
      }
    }

    if (transforms.length > 0) {
      video.style.transform = transforms.join(' ');
    }
  }

  // ── Google Drive seek ────────────────────────────────────────────────────────
  // Re-spawn yt-dlp from the requested time offset using --download-sections.
  seekGDriveStream(seconds) {
    if (!this.currentDriveFileId) return;
    this.logDebug(`[GDrive] Seeking to ${this.formatTime(seconds)}`);
    this.showLoader(true);
    this.driveSeekBase = seconds;
    this.driveCurrentTime = seconds;

    const seekUrl = `/api/gdrive-stream?fileId=${encodeURIComponent(this.currentDriveFileId)}&start=${Math.floor(seconds)}`;
    this.dom.video.src = seekUrl;
    this.dom.video.load();
    this.dom.video.play()
      .then(() => this.logDebug('[GDrive] Resumed after seek.'))
      .catch(err => this.logDebug(`[GDrive] Seek play blocked: ${err.message}`));
  }

  seekTranscodedStream(seconds) {
    this.logDebug(`Seeking transcoded stream to: ${this.formatTime(seconds)}`);
    this.showLoader(true);

    this.transcodeStartTime = seconds;
    const streamUrl = this.currentVideo.streamUrl;
    const proxiedUrl = `/api/stream?url=${encodeURIComponent(streamUrl)}&transcode=true&vcodec=${encodeURIComponent(this.vcodec)}&acodec=${encodeURIComponent(this.acodec)}&start=${Math.floor(seconds)}`;

    this.dom.video.src = proxiedUrl;
    this.dom.video.load();
    this.dom.video.play()
      .then(() => {
        this.logDebug('Transcoded playback resumed.');
      })
      .catch((err) => {
        this.logDebug(`Playback resume rejected: ${err.message}`);
      });
  }

  setupResizeObserver() {
    if (!this.dom.streamUrl) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        const width = entry.contentRect.width;
        if (width < 320) {
          this.dom.streamUrl.placeholder = "Paste link...";
        } else if (width < 460) {
          this.dom.streamUrl.placeholder = "Paste link or drop torrent...";
        } else {
          this.dom.streamUrl.placeholder = "Paste cloud link, magnet URI, or drop .torrent...";
        }
      }
    });
    observer.observe(this.dom.streamUrl);
  }

  // Hover Controls Helpers
  showControls() {
    this.dom.videoControls.classList.remove('hidden-controls');
    this.dom.playerContainer.style.cursor = 'default';
  }

  hideControls() {
    if (this.dom.video.paused) return; // Keep visible if paused
    this.dom.videoControls.classList.add('hidden-controls');
    this.dom.playerContainer.style.cursor = 'none';
  }

  showControlsWithTimeout() {
    this.showControls();
    clearTimeout(this.controlsTimeout);
    
    this.controlsTimeout = setTimeout(() => {
      this.hideControls();
    }, 3000);
  }

  // Formatting Helper
  formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const pad = (num) => String(num).padStart(2, '0');
    
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }

  // Local Storage / History Manager
  loadHistory() {
    try {
      const data = localStorage.getItem('cloudstream_history');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('History load failed:', e);
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem('cloudstream_history', JSON.stringify(this.history));
    } catch (e) {
      console.error('History save failed:', e);
    }
  }

  addToHistory(videoObj) {
    // Filter existing duplicates
    this.history = this.history.filter(item => item.id !== videoObj.id);
    
    // Add to top of stack
    this.history.unshift(videoObj);
    
    // Cap size at 50 entries
    if (this.history.length > 50) {
      this.history.pop();
    }

    this.saveHistory();
    this.renderHistory();
  }

  deleteHistoryItem(id, event) {
    event.stopPropagation(); // prevent loading item
    this.history = this.history.filter(item => item.id !== id);
    this.saveHistory();
    this.renderHistory();
    this.showNotification('Stream removed from history');
  }

  clearAllHistory() {
    if (confirm('Are you sure you want to clear your streaming history?')) {
      this.history = [];
      this.saveHistory();
      this.renderHistory();
      this.showNotification('History cleared');
    }
  }

  editHistoryItemTitle(id, newTitle) {
    this.history = this.history.map(item => {
      if (item.id === id) {
        return { ...item, title: newTitle };
      }
      return item;
    });
    
    // Update current video title if playing
    if (this.currentVideo && this.currentVideo.id === id) {
      this.currentVideo.title = newTitle;
    }

    this.saveHistory();
    this.renderHistory();
    this.showNotification('Title updated');
  }

  renderHistory() {
    const list = this.dom.historyList;
    list.innerHTML = '';

    if (this.history.length === 0) {
      this.dom.historyEmpty.classList.remove('hidden');
      return;
    }

    this.dom.historyEmpty.classList.add('hidden');

    this.history.forEach(item => {
      const li = document.createElement('li');
      li.className = `history-item ${this.currentVideo && this.currentVideo.id === item.id ? 'active' : ''}`;
      
      const formattedDate = new Date(item.timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      });

      li.innerHTML = `
        <div class="item-meta">
          <span class="item-service ${item.service}">${item.service}</span>
          <span class="item-date">${formattedDate}</span>
        </div>
        <div class="item-title-wrapper">
          <span class="item-title" id="title-text-${item.id}">${this.escapeHtml(item.title)}</span>
          <div class="item-actions">
            <button class="item-action-btn edit" data-id="${item.id}" title="Rename stream">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="item-action-btn delete" data-id="${item.id}" title="Remove">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="edit-title-form hidden" id="edit-form-${item.id}">
          <input type="text" class="edit-title-input" id="edit-input-${item.id}" value="${this.escapeHtml(item.title)}">
          <button class="action-btn save" data-id="${item.id}">Save</button>
        </div>
      `;

      // Click item to load
      li.addEventListener('click', (e) => {
        // Prevent trigger if clicking action buttons or forms
        if (
          e.target.closest('.item-actions') || 
          e.target.closest('.edit-title-form')
        ) return;
        
        this.dom.streamUrl.value = item.originalUrl;
        this.handleUrlInput();
        this.loadVideoFromUrl(item.originalUrl, item.title);
      });

      list.appendChild(li);
    });

    // Wire action buttons manually for dynamic list elements
    list.querySelectorAll('.item-action-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.deleteHistoryItem(btn.getAttribute('data-id'), e);
      });
    });

    list.querySelectorAll('.item-action-btn.edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const textSpan = document.getElementById(`title-text-${id}`);
        const formDiv = document.getElementById(`edit-form-${id}`);
        const inputField = document.getElementById(`edit-input-${id}`);
        
        textSpan.classList.add('hidden');
        formDiv.classList.remove('hidden');
        inputField.focus();
      });
    });

    list.querySelectorAll('.edit-title-form button.save').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const inputField = document.getElementById(`edit-input-${id}`);
        const newTitle = inputField.value.trim();
        
        if (newTitle) {
          this.editHistoryItemTitle(id, newTitle);
        }
      });
    });
  }

  // Helper utility to sanitize html rendering
  escapeHtml(string) {
    const div = document.createElement('div');
    div.textContent = string;
    return div.innerHTML;
  }

  // Sidebar controls
  toggleHistorySidebar() {
    const sidebar = this.dom.historySidebar;
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    this.dom.toggleHistoryBtn.setAttribute('aria-expanded', !isCollapsed);
  }

  // Keyboard Shortcuts Handler
  handleKeyboardShortcuts(e) {
    // Disable shortcuts if typing in input fields
    if (
      document.activeElement.tagName === 'INPUT' || 
      document.activeElement.tagName === 'TEXTAREA' ||
      document.activeElement.hasAttribute('contenteditable')
    ) {
      return;
    }

    const key = e.key.toLowerCase();

    // Prevent default scroll on Spacebar only when player has been active
    if (key === ' ' || e.key === 'Spacebar') {
      if (this.currentVideo) {
        e.preventDefault();
        this.togglePlay();
      }
    }

    if (key === 'm') {
      this.toggleMute();
      this.showNotification(this.isMuted ? 'Muted' : 'Unmuted');
    }

    if (key === 'f') {
      this.toggleFullscreen();
    }

    if (key === 't') {
      this.toggleTheaterMode();
    }

    if (e.key === 'ArrowRight') {
      this.skip(10);
      this.showNotification('→ Forward 10s');
    }

    if (e.key === 'ArrowLeft') {
      this.skip(-10);
      this.showNotification('← Backward 10s');
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentVol = this.dom.video.volume;
      const newVol = Math.min(1.0, currentVol + 0.1);
      this.dom.video.volume = newVol;
      this.dom.volumeSlider.value = newVol;
      this.volumeMemory = newVol;
      this.setMuteIcons(false);
      this.showNotification(`Volume: ${Math.round(newVol * 100)}%`);
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentVol = this.dom.video.volume;
      const newVol = Math.max(0.0, currentVol - 0.1);
      this.dom.video.volume = newVol;
      this.dom.volumeSlider.value = newVol;
      this.volumeMemory = newVol;
      if (newVol === 0) {
        this.setMuteIcons(true);
      }
      this.showNotification(`Volume: ${Math.round(newVol * 100)}%`);
    }
  }

  setupDragAndDrop() {
    const card = this.dom.inputCard;
    if (!card) return;
    
    // Prevent default behaviors for drag events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      card.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    // Add drag over classes
    ['dragenter', 'dragover'].forEach(eventName => {
      card.addEventListener(eventName, () => card.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      card.addEventListener(eventName, () => card.classList.remove('drag-over'), false);
    });

    // Handle dropped files
    card.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.torrent')) {
          this.logDebug(`Torrent file dropped: ${file.name}`);
          this.loadTorrentFile(file);
        } else {
          this.showNotification('Please drop a valid .torrent file.');
        }
      }
    }, false);
  }

  loadTorrentFile(file) {
    this.showLoader(true);
    this.dom.playerLoader.querySelector('p').textContent = 'Reading torrent file...';
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = new Uint8Array(e.target.result);
      this.loadTorrent(buffer);
    };
    reader.onerror = () => {
      this.showNotification('Error reading torrent file.');
      this.showLoader(false);
    };
    reader.readAsArrayBuffer(file);
  }

  loadTorrent(torrentSource) {
    this.destroyTorrent();
    this.showLoader(true);

    // Clear any previous video source — prevents stale events from old streams
    this.dom.video.removeAttribute('src');
    this.dom.video.load();
    this.dom.playerPlaceholder.classList.add('hidden');

    this.setLoaderMessage('Connecting to peers...');

    try {
      if (!this.torrentClient) {
        this.torrentClient = new window.WebTorrent();
      }

      this.logDebug('WebTorrent client initialized. Adding torrent...');

      // CRITICAL: Browsers CANNOT use UDP trackers (udp://). Only WebSocket (wss://) trackers
      // work in a browser context. We inject reliable public wss trackers so peer discovery
      // succeeds even when the magnet's own tracker list is entirely UDP-only.
      const wsTrackers = [
        'wss://tracker.btorrent.xyz',
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.webtorrent.dev',
        'wss://tracker.lab.vvc.niif.hu',
      ];

      this.torrentClient.add(torrentSource, { announce: wsTrackers }, (torrent) => {
        this.activeTorrent = torrent;
        this.logDebug(`Torrent metadata resolved. Name: "${torrent.name}", Hash: ${torrent.infoHash}, Files: ${torrent.files.length}`);

        // Find first video file
        const videoFile = torrent.files.find(file => {
          const name = file.name.toLowerCase();
          return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') ||
                 name.endsWith('.avi') || name.endsWith('.mov') || name.endsWith('.ogv') ||
                 name.endsWith('.m4v') || name.endsWith('.ts');
        });

        if (!videoFile) {
          this.logDebug('Error: No playable video files found in this torrent.');
          this.showNotification('No playable video found in torrent.');
          this.destroyTorrent();
          this.resetPlayerToPlaceholder();
          return;
        }

        this.logDebug(`Selected: "${videoFile.name}" (${this.formatBytes(videoFile.length)})`);
        this.dom.torrentStatsCard.classList.remove('hidden');
        this.dom.torrentName.textContent = videoFile.name;

        this.showLoader(false);
        this.dom.videoControls.classList.remove('hidden-controls');

        // renderTo is the current WebTorrent API; fall back to streamTo for older builds
        const onStreamError = (err) => {
          this.logDebug(`Torrent stream error: ${err ? err.message : 'unknown'}`);
          this.showNotification('Stream failed — not enough peers yet. Wait a moment and try again.');
        };

        if (typeof videoFile.renderTo === 'function') {
          videoFile.renderTo(this.dom.video, { autoplay: true }, (err) => {
            if (err) {
              this.logDebug(`renderTo failed (${err.message}), trying streamTo...`);
              if (typeof videoFile.streamTo === 'function') {
                videoFile.streamTo(this.dom.video, (err2) => { if (err2) onStreamError(err2); });
              } else {
                onStreamError(err);
              }
            } else {
              this.logDebug('renderTo succeeded — streaming from torrent.');
            }
          });
        } else if (typeof videoFile.streamTo === 'function') {
          videoFile.streamTo(this.dom.video, (err) => { if (err) onStreamError(err); });
        } else {
          this.logDebug('No renderTo or streamTo available on this WebTorrent build.');
          this.showNotification('WebTorrent API unavailable. Try refreshing.');
        }

        this.currentVideo = {
          title: videoFile.name,
          originalUrl: typeof torrentSource === 'string'
            ? torrentSource
            : `magnet:?xt=urn:btih:${torrent.infoHash}`,
          service: 'torrent',
          timestamp: Date.now()
        };

        this.addToHistory(this.currentVideo);

        torrent.on('download', () => this.updateTorrentStats(torrent));
        torrent.on('upload',   () => this.updateTorrentStats(torrent));

        // Log each new peer connection for debugging
        torrent.on('wire', (wire) => {
          this.logDebug(`Peer connected (total: ${torrent.numPeers}) — ${wire.remoteAddress || 'WebRTC'}`);
          this.updateTorrentStats(torrent);
        });
      });

      this.torrentClient.on('error', (err) => {
        this.logDebug(`WebTorrent error: ${err.message}`);
        this.showNotification(`Torrent error: ${err.message}`);
        this.destroyTorrent();
        this.resetPlayerToPlaceholder();
      });

    } catch (err) {
      this.logDebug(`WebTorrent init failed: ${err.message}`);
      this.showNotification('WebTorrent failed to start. Please refresh.');
      this.showLoader(false);
    }
  }

  updateTorrentStats(torrent) {
    this.dom.torrentPeers.textContent = `${torrent.numPeers} peer${torrent.numPeers !== 1 ? 's' : ''}`;
    this.dom.torrentSpeed.textContent = `${this.formatBytes(torrent.downloadSpeed)}/s`;
    this.dom.torrentProgress.textContent = `${(torrent.progress * 100).toFixed(1)}%`;
  }

  destroyTorrent() {
    this.dom.torrentStatsCard.classList.add('hidden');
    this.dom.playerLoader.querySelector('p').textContent = 'Fetching file streams...';
    
    if (this.activeTorrent) {
      try {
        this.activeTorrent.destroy();
      } catch (e) {}
      this.activeTorrent = null;
    }
    
    if (this.torrentClient) {
      try {
        this.torrentClient.destroy();
      } catch (e) {}
      this.torrentClient = null;
      this.logDebug("WebTorrent client destroyed.");
    }
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  logDebug(msg) {
    if (!this.dom.debugLogs) return;
    const time = new Date().toLocaleTimeString();
    this.dom.debugLogs.innerHTML += `<br>[${time}] ${msg}`;
    this.dom.debugLogs.scrollTop = this.dom.debugLogs.scrollHeight;
    console.log(`[Debug] ${msg}`);
  }
}

// Instantiate application on DOM Load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new CloudStreamApp();
});
