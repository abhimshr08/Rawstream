import React, { useState, useEffect, useRef } from 'react';
import { Play, AlertTriangle, FileVideo, Check } from 'lucide-react';
import Controls from './Controls';

export default function Player({
  currentVideo,
  session,
  mediaDuration,
  setMediaDuration,
  needsTranscode,
  vcodec,
  acodec,
  selectedQuality,
  setSelectedQuality,
  historyList,
  authenticatedFetch,
  addToast,
  logDebug,
  playerLoading,
  playerLoaderMessage,
  onRecoverTorrent,
  googleAuth            // { token, loading, error, requestToken, clearToken }
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const visualizerRef = useRef(null);
  const playerRef = useRef(null);

  // Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState('');
  const [bufferPercent, setBufferPercent] = useState(0);
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const [videoError, setVideoError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheater, setIsTheater] = useState(false);
  const [useEmbed, setUseEmbed] = useState(false);
  const [webtorLoaded, setWebtorLoaded] = useState(false);

  // Synchronize native fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Dynamically load the Webtor Embed SDK script (CDN)
  useEffect(() => {
    if (window.webtor) {
      setWebtorLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js/dist/index.min.js';
    script.async = true;
    script.charset = 'utf-8';
    script.onload = () => {
      logDebug('[Webtor] Embed SDK script loaded successfully.');
      setWebtorLoaded(true);
    };
    script.onerror = () => {
      logDebug('[Webtor] Failed to load Webtor Embed SDK script.');
    };
    document.head.appendChild(script);
  }, []);

  // Initialize Webtor player when currentVideo is torrent and SDK is loaded
  useEffect(() => {
    if (currentVideo?.service !== 'torrent' || !webtorLoaded) return;

    // Webtor player requires a clean container element to boot
    const container = document.getElementById('webtor-player-container');
    if (container) {
      container.innerHTML = ''; // wipe previous iframes/instances
    }

    logDebug(`[Webtor] Initializing torrent stream for infoHash: ${currentVideo.id}`);

    // Standardize magnet URI format
    const magnetUri = currentVideo.originalUrl.startsWith('magnet:')
      ? currentVideo.originalUrl
      : `magnet:?xt=urn:btih:${currentVideo.id}`;

    window.webtor = window.webtor || [];
    window.webtor.push({
      id: 'webtor-player-container',
      magnet: magnetUri,
      width: '100%',
      height: '100%',
      on: function(e) {
        if (e.name === 'ready') {
          logDebug('[Webtor] Torrent stream player ready in viewport.');
        }
      }
    });
  }, [currentVideo, webtorLoaded]);

  const toggleFullscreen = () => {
    const container = playerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {
        addToast('Error enabling fullscreen', 'error');
      });
    } else {
      document.exitFullscreen();
    }
  };

  const toggleTheater = () => {
    setIsTheater(prev => !prev);
  };

  // Layout State
  const [videoRotation, setVideoRotation] = useState(0);
  const [videoAspect, setVideoAspect] = useState('contain');
  const [videoMirror, setVideoMirror] = useState('none');
  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef(null);

  // Resume Progress State
  const [resumeTime, setResumeTime] = useState(0);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const resumeTimeoutRef = useRef(null);

  // Manual Seek Offsets
  const [transcodeStartTime, setTranscodeStartTime] = useState(0);

  // Drag Scrubber states shared
  const isDraggingProgressRef = useRef(false);

  // Waveform Visualizer Animation
  const visualizerAnimRef = useRef(null);

  // Ambient Glow interval
  const ambientIntervalRef = useRef(null);

  // Progress syncing interval
  const syncIntervalRef = useRef(null);

  // Seek Debounce reference
  const seekTimeoutRef = useRef(null);

  // Torrent Recovery tracking refs
  const recoveryAttemptsRef = useRef(0);
  const recoveryTimeRef = useRef(0);
  const initialRetryCountRef = useRef(0); // limit initial-load retries
  const MAX_TORRENT_RECOVERY_ATTEMPTS = 2;

  // Format Helper
  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === Infinity) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  };

  // Video Actions
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || showPlaceholder) return;
    if (video.paused) {
      video.play().catch(() => {
        addToast('Play blocked. Check connection/sharing.', 'error');
      });
    } else {
      video.pause();
    }
  };

  // Skip actions
  const skip = (seconds) => {
    const video = videoRef.current;
    if (!video || showPlaceholder) return;

    if (currentVideo?.service === 'google' && mediaDuration > 0) {
      const seekTime = Math.max(0, Math.min(mediaDuration, video.currentTime + seconds));
      debounceSeekGDrive(seekTime);
    } else {
      const duration = needsTranscode ? mediaDuration : video.duration;
      const currentTime = needsTranscode 
        ? (transcodeStartTime + video.currentTime) 
        : video.currentTime;
      const seekTime = Math.max(0, Math.min(duration || 0, currentTime + seconds));

      if (needsTranscode) {
        debounceSeekTranscoded(seekTime);
      } else {
        video.currentTime = seekTime;
      }
    }
  };

  // Seek Google Drive
  const seekGDriveStream = (seconds) => {
    if (!currentVideo || currentVideo.service !== 'google') return;
    logDebug(`[GDrive] Seeking to: ${formatTime(seconds)}`);
    setIsBuffering(true);
    setLoaderMessage('Seeking Google Drive stream...');

    const video = videoRef.current;
    if (!video) return;
    if (!video.currentSrc) {
      video.src = currentVideo.streamUrl;
      video.load();
    }

    video.currentTime = seconds;
    video.play()
      .then(() => logDebug('[GDrive] Resumed after seek.'))
      .catch((err) => logDebug(`[GDrive] Seek play blocked: ${err.message}`));
  };

  // Seek Transcoded stream
  const seekTranscodedStream = (seconds) => {
    if (!currentVideo) return;
    logDebug(`Seeking transcoded stream to: ${formatTime(seconds)}`);
    setIsBuffering(true);
    setLoaderMessage('Seeking transcoded stream...');
    setTranscodeStartTime(seconds);

    const rawUrl = currentVideo.rawStreamUrl || currentVideo.streamUrl;
    let seekUrl = `/api/stream?url=${encodeURIComponent(rawUrl)}&transcode=true&vcodec=${encodeURIComponent(vcodec)}&acodec=${encodeURIComponent(acodec)}&start=${Math.floor(seconds)}`;
    
    if (selectedQuality && selectedQuality !== 'original') {
      seekUrl += `&quality=${selectedQuality}`;
    }

    const video = videoRef.current;
    video.src = seekUrl;
    video.load();
    video.play()
      .then(() => logDebug('Transcoded stream playback resumed.'))
      .catch((err) => logDebug(`Playback resume rejected: ${err.message}`));
  };

  // Debounced Seek wrappers to prevent server-side FFmpeg process thrashing
  const debounceSeekTranscoded = (seconds) => {
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    setIsBuffering(true);
    setLoaderMessage('Preparing seek stream...');
    seekTimeoutRef.current = setTimeout(() => {
      seekTranscodedStream(seconds);
    }, 400);
  };

  const debounceSeekGDrive = (seconds) => {
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    setIsBuffering(true);
    setLoaderMessage('Preparing seek stream...');
    seekTimeoutRef.current = setTimeout(() => {
      seekGDriveStream(seconds);
    }, 400);
  };

  const resetTorrentCache = async () => {
    if (!currentVideo || currentVideo.service !== 'torrent' || !currentVideo.id) return false;
    try {
      const resetRes = await authenticatedFetch(`/api/torrent/reset?infoHash=${encodeURIComponent(currentVideo.id)}`);
      if (!resetRes.ok) {
        const body = await resetRes.text();
        throw new Error(body || resetRes.statusText);
      }
      logDebug('[Recovery] Server-side torrent cache reset successfully.');
      return true;
    } catch (err) {
      logDebug(`[Recovery] Failed to reset torrent cache: ${err.message}`);
      return false;
    }
  };

  // Resume playback check
  const checkForResumeProgress = (id) => {
    const item = historyList.find(x => x.id === id);
    if (item && item.currentTime && item.duration) {
      const time = item.currentTime;
      const duration = item.duration;
      if (time > 5 && time < duration * 0.95) {
        setResumeTime(time);
        setShowResumePrompt(true);
        if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
        resumeTimeoutRef.current = setTimeout(() => {
          setShowResumePrompt(false);
          setResumeTime(0);
        }, 10000);
      }
    }
  };

  const handleResumePlayback = (confirm) => {
    setShowResumePrompt(false);
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    if (confirm && resumeTime > 0) {
      logDebug(`Resuming playback from: ${formatTime(resumeTime)}`);
      if (currentVideo?.service === 'google') {
        debounceSeekGDrive(resumeTime);
      } else if (needsTranscode || (selectedQuality && selectedQuality !== 'original')) {
        debounceSeekTranscoded(resumeTime);
      } else {
        const video = videoRef.current;
        if (video) video.currentTime = resumeTime;
      }
    }
    setResumeTime(0);
  };

  // Sync playback progress
  const syncPlaybackProgress = async () => {
    const video = videoRef.current;
    if (!video || !currentVideo || !session.token) return;

    let displayTime = video.currentTime;
    if (needsTranscode) {
      displayTime = transcodeStartTime + video.currentTime;
    }

    const duration = mediaDuration || video.duration;

    if (isNaN(displayTime) || isNaN(duration) || duration <= 0) return;

    try {
      await authenticatedFetch(`/api/history/${currentVideo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime: displayTime, duration })
      });
    } catch (e) {
      console.error('Failed to sync progress:', e);
    }
  };

  // Ambient cinema glow drawing
  const updateAmbientGlow = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.paused || video.ended || video.readyState < 2 || video.videoWidth === 0) return;

    try {
      const ctx = canvas.getContext('2d', { alpha: false });
      if (canvas.width !== 16 || canvas.height !== 9) {
        canvas.width = 16;
        canvas.height = 9;
      }
      ctx.drawImage(video, 0, 0, 16, 9);
    } catch (e) {
      // Ignore cross-origin canvas errors
    }
  };

  // Fake Waveform Visualizer for Audio / Buffering State
  const drawWaveformVisualizer = () => {
    const canvas = visualizerRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = canvas.width;
    let height = canvas.height;
    if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      width = canvas.width;
      height = canvas.height;
    }

    ctx.clearRect(0, 0, width, height);
    
    // Draw neon waveforms
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.7)';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(99, 102, 241, 0.5)';
    
    ctx.beginPath();
    const sliceWidth = width / 60;
    const time = Date.now() * 0.004;

    for (let i = 0; i < 60; i++) {
      const x = i * sliceWidth + sliceWidth / 2;
      // Generate standard organic looking sound waves using sine frequencies
      const amp = isBuffering ? 10 : 35;
      const wave = Math.sin(i * 0.15 + time) * Math.cos(i * 0.05 - time * 0.5);
      const val = wave * amp;
      
      ctx.moveTo(x, height / 2 - val);
      ctx.lineTo(x, height / 2 + val);
    }
    ctx.stroke();

    visualizerAnimRef.current = requestAnimationFrame(drawWaveformVisualizer);
  };

  // Event handlers
  const handlePlay = () => {
    setIsPlaying(true);
    setIsBuffering(false);
    // Reset loader message so stale 'Seeking...' text never lingers after seek completes
    setLoaderMessage('Buffering stream...');
    
    // Progress syncing
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    syncIntervalRef.current = setInterval(syncPlaybackProgress, 5000);

    // Ambient glow
    if (ambientIntervalRef.current) clearInterval(ambientIntervalRef.current);
    ambientIntervalRef.current = setInterval(updateAmbientGlow, 100);
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }
    if (ambientIntervalRef.current) {
      clearInterval(ambientIntervalRef.current);
      ambientIntervalRef.current = null;
    }
  };

  const handleEnded = () => {
    handlePause();
    const video = videoRef.current;
    if (video) video.currentTime = 0;
  };

  const handleVideoError = async () => {
    const video = videoRef.current;
    if (!video) return;

    // Ignore aborted loads (often triggered by switching source or seeking)
    if (video.error && video.error.code === 1) {
      logDebug(`[Playback] Load aborted (MEDIA_ERR_ABORTED). Ignoring.`);
      return;
    }

    setIsBuffering(false);

    let displayTime = video.currentTime;
    if (needsTranscode) {
      displayTime = transcodeStartTime + video.currentTime;
    }

    // Torrent Auto-Recovery vs Initial Load Retry
    if (currentVideo?.service === 'torrent') {
      // If it fails at the very start (no peer data yet), retry loading the video (max 5 times)
      if (isNaN(displayTime) || displayTime <= 2) {
        if (initialRetryCountRef.current < 5) {
          initialRetryCountRef.current += 1;
          const retryDelay = Math.min(3000 + initialRetryCountRef.current * 1000, 8000);
          logDebug(`[Playback] Initial load stalled. Retry ${initialRetryCountRef.current}/5 in ${retryDelay/1000}s...`);
          setIsBuffering(true);
          setLoaderMessage(`Waiting for torrent peers... (attempt ${initialRetryCountRef.current}/5)`);
          
          if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
          seekTimeoutRef.current = setTimeout(() => {
            const v = videoRef.current;
            if (v && currentVideo) {
              logDebug(`[Playback] Retrying video load (attempt ${initialRetryCountRef.current})...`);
              v.load();
              v.play().catch((err) => {
                logDebug(`[Playback] Retry play blocked: ${err.message}`);
              });
            }
          }, retryDelay);
          return;
        } else {
          // Max retries reached - show actionable error
          logDebug('[Playback] Max initial retries reached. Torrent may have no peers or be invalid.');
          setVideoError({ type: 'generic', message: 'Cannot connect to torrent peers. The torrent may be dead or have no seeders. Try a different magnet link.' });
          setIsBuffering(false);
          return;
        }
      }

      // If it fails mid-playback, recover the torrent client cache on the server
      if (recoveryAttemptsRef.current < MAX_TORRENT_RECOVERY_ATTEMPTS && onRecoverTorrent) {
        recoveryAttemptsRef.current += 1;
        recoveryTimeRef.current = !isNaN(displayTime) && displayTime > 0 ? displayTime : 0;

        const recoveryDelay = Math.min(2000 + recoveryAttemptsRef.current * 1500, 6000);
        logDebug(`[Recovery] Torrent playback failed mid-stream. Attempt ${recoveryAttemptsRef.current}/${MAX_TORRENT_RECOVERY_ATTEMPTS}, retrying in ${recoveryDelay/1000}s at ${formatTime(recoveryTimeRef.current)}...`);
        setIsBuffering(true);
        setLoaderMessage(`Reconnecting to torrent stream... (attempt ${recoveryAttemptsRef.current}/${MAX_TORRENT_RECOVERY_ATTEMPTS})`);

        if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
        seekTimeoutRef.current = setTimeout(async () => {
          await resetTorrentCache();
          onRecoverTorrent(currentVideo.originalUrl);
        }, recoveryDelay);
        return;
      }
    }

    const proxiedUrl = video.src;
    logDebug(`Video loading failed. URL: ${proxiedUrl}`);

    // If we are playing an authenticated stream, check its error status directly
    if (proxiedUrl && proxiedUrl.includes('/api/gdrive-auth-stream')) {
      try {
        const check = await fetch(proxiedUrl, { method: 'HEAD' }).catch(() => null);
        if (check) {
          if (check.status === 401) {
            if (googleAuth) googleAuth.clearToken();
            setVideoError({ type: 'quota', message: 'Google authentication expired or invalid. Please sign in again.' });
            return;
          }
          if (check.status === 403) {
            setVideoError({ type: 'access', message: 'Google Drive file access restricted. Ensure your Google account has access to this file.' });
            return;
          }
        }
      } catch (err) {
        logDebug(`Auth stream HEAD check failed: ${err.message}`);
      }
      setVideoError({ type: 'generic', message: 'Playback of authenticated Google Drive stream failed.' });
      return;
    }

    // For Google Drive: use the lightweight /api/resolve endpoint to check error type
    // (avoids re-fetching the full stream which would hit quota again)
    if (currentVideo?.service === 'google' && currentVideo?.id) {
      try {
        const check = await authenticatedFetch(`/api/resolve?fileId=${encodeURIComponent(currentVideo.id)}`);
        if (check.status === 429) {
          setVideoError({ type: 'quota', message: 'Google Drive quota exceeded.' });
          return;
        }
        if (check.status === 403) {
          setVideoError({ type: 'access', message: 'File access restricted. Set sharing to "Anyone with the link can view".' });
          return;
        }
      } catch (err) {
        logDebug(`GDrive resolve check failed: ${err.message}`);
      }
    } else if (proxiedUrl && proxiedUrl.includes('/api/stream')) {
      try {
        // Use HEAD to avoid downloading data, just check status
        const check = await authenticatedFetch(proxiedUrl, { method: 'HEAD' }).catch(() => null);
        if (check) {
          if (check.status === 429) {
            setVideoError({ type: 'quota', message: 'Google Drive quota exceeded.' });
            return;
          }
          if (check.status === 403 || check.status === 404) {
            setVideoError({ type: 'access', message: 'File access restricted. Verify file sharing permissions.' });
            return;
          }
        }
      } catch (err) {
        logDebug(`Diagnostic HEAD check failed: ${err.message}`);
      }
    }
    setVideoError({ type: 'generic', message: 'Playback failed. Ensure file permissions are public.' });
    addToast('Playback failed.', 'error');
  };

  // Hover reveals controls
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  const handleMouseLeave = () => {
    if (isPlaying) {
      setShowControls(false);
    }
  };

  // Video layout transformations styling
  const getVideoStyles = () => {
    const styles = {
      transform: '',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      aspectRatio: ''
    };

    if (videoAspect === 'contain' || videoAspect === 'cover' || videoAspect === 'fill') {
      styles.objectFit = videoAspect;
    } else if (videoAspect === '16-9') {
      styles.objectFit = 'fill';
      styles.aspectRatio = '16 / 9';
      styles.height = 'auto';
    } else if (videoAspect === '4-3') {
      styles.objectFit = 'fill';
      styles.aspectRatio = '4 / 3';
      styles.width = 'auto';
    }

    const transforms = [];
    if (videoRotation !== 0) transforms.push(`rotate(${videoRotation}deg)`);
    if (videoMirror === 'horizontal') transforms.push('scaleX(-1)');
    else if (videoMirror === 'vertical') transforms.push('scaleY(-1)');

    // Rotations scale to fit
    if (videoRotation === 90 || videoRotation === 270) {
      // Approximate responsive bounds scale (usually scales down to fit)
      transforms.push('scale(0.56)');
    }

    if (transforms.length > 0) styles.transform = transforms.join(' ');
    return styles;
  };

  // Watch currentVideo changes to load source
  useEffect(() => {
    setUseEmbed(false);
    if (!currentVideo) return;

    if (currentVideo.error) {
      setShowPlaceholder(false);
      if (currentVideo.error === 'QUOTA_EXCEEDED') {
        setVideoError({ type: 'quota', message: 'Google Drive quota exceeded.' });
      } else if (currentVideo.error === 'ACCESS_DENIED') {
        setVideoError({ type: 'access', message: 'File access restricted. Verify file sharing permissions.' });
      } else {
        setVideoError({ type: 'generic', message: currentVideo.error });
      }
      setIsBuffering(false);
      return;
    }

    setShowPlaceholder(false);
    setVideoError(null);
    setTranscodeStartTime(0);

    // If it's a torrent, we initialize Webtor instead of standard HTML5 video tag
    if (currentVideo.service === 'torrent') {
      setIsBuffering(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    // Check if we are recovering from a previous state
    initialRetryCountRef.current = 0; // Reset retry counter for new video
    const autoSeekTime = recoveryTimeRef.current;
    recoveryTimeRef.current = 0; // reset

    if (autoSeekTime > 0) {
      recoveryAttemptsRef.current = 0;
      logDebug(`[Recovery] Auto-seeking recovered stream directly to: ${formatTime(autoSeekTime)}`);
      if (currentVideo.service === 'google') {
        seekGDriveStream(autoSeekTime);
      } else if (needsTranscode || (selectedQuality && selectedQuality !== 'original')) {
        seekTranscodedStream(autoSeekTime);
      } else {
        video.src = currentVideo.streamUrl;
        video.load();
        video.currentTime = autoSeekTime;
        video.play()
          .then(() => logDebug('[Recovery] Resumed direct playback.'))
          .catch((err) => logDebug(`[Recovery] Resume direct play blocked: ${err.message}`));
      }
    } else {
      recoveryAttemptsRef.current = 0;
      video.src = currentVideo.streamUrl;
      video.load();
      setIsBuffering(true);
      setLoaderMessage('Buffering stream...');

      checkForResumeProgress(currentVideo.id);

      video.play()
        .then(() => logDebug('Playback autoplay initiated.'))
        .catch((err) => {
          logDebug(`Autoplay blocked: ${err.message}. Click play to start.`);
          setIsBuffering(false); // clear spinner overlay so user can press play
        });
    }

    return () => {
      video.removeAttribute('src');
      video.load();
    };
  }, [currentVideo]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      if (ambientIntervalRef.current) clearInterval(ambientIntervalRef.current);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
      if (visualizerAnimRef.current) cancelAnimationFrame(visualizerAnimRef.current);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      clearTorrentPolling();
    };
  }, []);

  // Control waveform animation trigger
  const isAudioOnly = currentVideo?.service === 'torrent' && 
    (currentVideo.title.toLowerCase().endsWith('.mp3') || 
     currentVideo.title.toLowerCase().endsWith('.m4a') || 
     currentVideo.title.toLowerCase().endsWith('.aac') ||
     currentVideo.title.toLowerCase().endsWith('.ogg'));

  useEffect(() => {
    if (visualizerAnimRef.current) cancelAnimationFrame(visualizerAnimRef.current);
    if (!showPlaceholder && (isBuffering || isAudioOnly)) {
      drawWaveformVisualizer();
    }
  }, [isBuffering, showPlaceholder, isAudioOnly]);

  return (
    <section 
      ref={playerRef}
      id="player-container" 
      className={`player-container glass-panel aspect-ratio-container ${isTheater ? 'theater' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Ambient Canvas Glow */}
      <canvas ref={canvasRef} id="ambient-glow-canvas" className="ambient-glow-canvas" />

      {/* Loading Overlay */}
      {(isBuffering || playerLoading) && (
        <div id="player-loader" className="player-loader">
          <div className="spinner" />
          <p>{playerLoaderMessage || loaderMessage}</p>
        </div>
      )}

      {/* Audio visualizer canvas */}
      {!showPlaceholder && (isBuffering || isAudioOnly) && (
        <div className="waveform-container">
          <canvas ref={visualizerRef} className="waveform-visualizer" />
        </div>
      )}

      {/* Playback Resume Prompt Modal */}
      {showResumePrompt && (
        <div id="resume-prompt" className="resume-prompt">
          <div className="resume-prompt-content glass-panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style={{ width: '20px', height: '20px', color: 'var(--accent-primary)' }}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Resume playback from <strong>{formatTime(resumeTime)}</strong>?</span>
            <div className="resume-prompt-actions">
              <button className="resume-btn yes" onClick={() => handleResumePlayback(true)}>Resume</button>
              <button className="resume-btn no" onClick={() => handleResumePlayback(false)}>Start Over</button>
            </div>
          </div>
        </div>
      )}

      {/* Player Placeholder Screen */}
      {showPlaceholder && !videoError && !playerLoading && (
        <div id="player-placeholder" className="player-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style={{ width: '64px', height: '64px', marginBottom: '1rem', color: 'rgba(255,255,255,0.3)' }}>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <h3>Awaiting Video Stream</h3>
          <p>Paste a cloud sharing link, drag a torrent, or drop a local video file here to play instantly.</p>
        </div>
      )}

      {/* Google Drive Quota Screen */}
      {videoError?.type === 'quota' && !useEmbed && (
        <div className="player-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" style={{ width: '64px', height: '64px', marginBottom: '1rem' }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h3 style={{ color: '#ef4444' }}>Quota Exceeded</h3>
          <p style={{ maxWidth: '440px', margin: '0.5rem auto', color: 'rgba(255,255,255,0.7)' }}>
            Google Drive's anonymous download quota is exceeded. Sign in with your Google account to stream directly — no limits, fully through RawStream.
          </p>

          {googleAuth && googleAuth.isConfigured && (
            <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.65rem' }}>
              {googleAuth.error && (
                <p style={{ color: '#f59e0b', fontSize: '0.8rem', margin: 0 }}>{googleAuth.error}</p>
              )}
              <button
                type="button"
                disabled={googleAuth.loading}
                onClick={async () => {
                  try {
                    addToast('Signing in with Google...', 'info');
                    const accessToken = await googleAuth.requestToken();
                    // Switch video to authenticated stream endpoint
                    const authStreamUrl = `/api/gdrive-auth-stream?fileId=${encodeURIComponent(currentVideo.id)}&token=${encodeURIComponent(accessToken)}`;
                    logDebug('[GDrive] Switching to authenticated stream after quota bypass...');
                    setVideoError(null);
                    setShowPlaceholder(false);
                    setIsBuffering(true);
                    setLoaderMessage('Loading authenticated stream...');
                    const video = videoRef.current;
                    if (video) {
                      video.src = authStreamUrl;
                      video.load();
                      video.play().catch(err => logDebug(`Auth stream play blocked: ${err.message}`));
                    }
                  } catch (err) {
                    addToast(`Google sign-in failed: ${err.message}`, 'error');
                    logDebug(`[GDrive] Google sign-in failed: ${err.message}`);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: 'white',
                  color: '#1a1a1a',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.6rem 1.25rem',
                  fontWeight: '600',
                  fontSize: '0.9rem',
                  cursor: googleAuth.loading ? 'wait' : 'pointer',
                  opacity: googleAuth.loading ? 0.7 : 1,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  transition: 'all 0.2s'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                {googleAuth.loading ? 'Signing in...' : 'Stream with Google Account'}
              </button>
              <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                One-click sign-in · RawStream streams directly · no data stored
              </p>
            </div>
          )}

          <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', padding: '0.85rem', marginTop: '1.25rem', fontSize: '0.85rem', maxWidth: '450px', textAlign: 'left', lineHeight: '1.6', color: 'rgba(255,255,255,0.85)', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div>
              <strong style={{ color: '#ef4444', display: 'block', marginBottom: '0.4rem' }}>Alternative Iframe Embed (Google Environment):</strong>
              If the direct stream API fails or is restricted, you can switch back to Google's official preview player inside RawStream.
            </div>
            
            <button 
              type="button" 
              onClick={() => {
                setShowPlaceholder(false);
                setUseEmbed(true);
              }}
              style={{
                background: 'var(--accent-primary)',
                border: 'none',
                color: 'white',
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.85rem',
                marginTop: '0.25rem',
                alignSelf: 'flex-start',
                transition: 'background 0.2s'
              }}
            >
              Play via Google Drive Embedded Player
            </button>
          </div>
        </div>
      )}

      {/* Sharing Access restricted Screen */}
      {videoError?.type === 'access' && !useEmbed && (
        <div className="player-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" style={{ width: '64px', height: '64px', marginBottom: '1rem' }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <circle cx="12" cy="16" r="1" />
            <line x1="12" y1="8" x2="12" y2="12" />
          </svg>
          <h3 style={{ color: '#f59e0b' }}>File Access Restricted</h3>
          <p style={{ maxWidth: '440px', margin: '0.5rem auto' }}>Google Drive returned an access denied error. Change General Access to <strong>"Anyone with the link can view"</strong> and try again.</p>

          <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px', padding: '0.85rem', marginTop: '1.2rem', fontSize: '0.85rem', maxWidth: '450px', textAlign: 'left', lineHeight: '1.6', color: 'rgba(255,255,255,0.85)', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div>
              <strong style={{ color: '#f59e0b', display: 'block', marginBottom: '0.4rem' }}>Access Fallback Available:</strong>
              If you have access to this file via your signed-in Google account, you can stream it directly using Google's official preview player.
            </div>
            
            <button 
              type="button" 
              onClick={() => {
                setShowPlaceholder(false);
                setUseEmbed(true);
              }}
              style={{
                background: '#f59e0b',
                border: 'none',
                color: '#1a1a1a',
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.85rem',
                marginTop: '0.25rem',
                alignSelf: 'flex-start',
                transition: 'background 0.2s'
              }}
            >
              Play via Google Drive Embedded Player
            </button>
          </div>
        </div>
      )}

      {/* Generic Error Screen */}
      {videoError?.type === 'generic' && (
        <div className="player-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" style={{ width: '64px', height: '64px', marginBottom: '1rem' }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h3 style={{ color: '#ef4444' }}>Playback Error</h3>
          <p style={{ maxWidth: '440px', margin: '0.5rem auto' }}>{videoError.message}</p>
        </div>
      )}

      {/* Video element or Google Drive preview iframe fallback or Webtor torrent player */}
      {currentVideo?.service === 'torrent' ? (
        <div 
          id="webtor-player-container" 
          className="webtor-player-container"
          style={{ 
            width: '100%', 
            height: '100%', 
            borderRadius: '12px', 
            overflow: 'hidden', 
            background: 'black',
            position: 'relative',
            zIndex: 10
          }}
        />
      ) : useEmbed ? (
        <iframe
          src={`https://drive.google.com/file/d/${currentVideo.id}/preview`}
          width="100%"
          height="100%"
          style={{ border: 'none', borderRadius: '12px', background: 'black', position: 'relative', zIndex: 10 }}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          title="Google Drive Embedded Player"
        />
      ) : (
        <video
          ref={videoRef}
          id="video-element"
          preload="auto"
          playsInline
          referrerPolicy="no-referrer"
          style={getVideoStyles()}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onError={handleVideoError}
          onLoadedMetadata={() => {
            // Sync duration from the video element once the browser parses stream headers.
            // This is critical for torrent/transcoded streams where we skip pre-probing.
            const video = videoRef.current;
            if (video && isFinite(video.duration) && video.duration > 0 && mediaDuration === 0) {
              setMediaDuration(video.duration);
              logDebug(`[Player] Duration synced from stream: ${video.duration.toFixed(1)}s`);
            }
          }}
          onWaiting={() => { setIsBuffering(true); }}
          onPlaying={() => { setIsBuffering(false); setLoaderMessage('Buffering stream...'); }}
          onSeeking={() => { setIsBuffering(true); }}
          onSeeked={() => { setIsBuffering(false); setLoaderMessage('Buffering stream...'); }}
          onProgress={() => {
            // Update buffer bar from video.buffered ranges
            const video = videoRef.current;
            if (!video || !video.buffered || video.buffered.length === 0) return;
            const duration = (needsTranscode ? mediaDuration : video.duration) || video.duration;
            if (!duration || duration <= 0 || !isFinite(duration)) return;
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const globalBufferedEnd = needsTranscode
              ? transcodeStartTime + bufferedEnd
              : bufferedEnd;
            setBufferPercent(Math.min(100, (globalBufferedEnd / duration) * 100));
          }}
        >
          Your browser does not support the video tag.
        </video>
      )}


      {/* Play Overlay Screen Button */}
      {!isPlaying && !showPlaceholder && !videoError && !isBuffering && !useEmbed && currentVideo?.service !== 'torrent' && (
        <div id="play-overlay" className="play-overlay" onClick={togglePlay}>
          <button className="large-play-btn" aria-label="Play">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          </button>
        </div>
      )}

      {/* Controls Overlay */}
      {!showPlaceholder && !useEmbed && currentVideo?.service !== 'torrent' && (
        <Controls 
          show={showControls || !isPlaying}
          videoRef={videoRef}
          isPlaying={isPlaying}
          togglePlay={togglePlay}
          skip={skip}
          mediaDuration={mediaDuration}
          needsTranscode={needsTranscode}
          currentVideo={currentVideo}
          selectedQuality={selectedQuality}
          setSelectedQuality={setSelectedQuality}
          videoRotation={videoRotation}
          setVideoRotation={setVideoRotation}
          videoAspect={videoAspect}
          setVideoAspect={setVideoAspect}
          videoMirror={videoMirror}
          setVideoMirror={setVideoMirror}
          transcodeStartTime={transcodeStartTime}
          seekGDriveStream={debounceSeekGDrive}
          seekTranscodedStream={debounceSeekTranscoded}
          isDraggingProgressRef={isDraggingProgressRef}
          addToast={addToast}
          formatTime={formatTime}
          isFullscreen={isFullscreen}
          toggleFullscreen={toggleFullscreen}
          isTheater={isTheater}
          toggleTheater={toggleTheater}
          bufferPercent={bufferPercent}
        />
      )}

      {/* Torrent Metadata Badges list panel */}
      {currentVideo && !showPlaceholder && (
        <div className="metadata-badge-list" style={{ position: 'absolute', bottom: '-45px', left: 0 }}>
          <div className="metadata-badge">
            <FileVideo size={12} />
            <span>{currentVideo.service}</span>
          </div>
          {useEmbed && (
            <div className="metadata-badge secondary" style={{ color: 'var(--accent-secondary)' }}>
              <span>Google Embed Mode (Authenticated)</span>
            </div>
          )}
          {mediaDuration > 0 && !useEmbed && (
            <div className="metadata-badge">
              <span>{formatTime(mediaDuration)}</span>
            </div>
          )}
          {needsTranscode && !useEmbed && (
            <div className="metadata-badge secondary">
              <AlertTriangle size={12} />
              <span>Transcoded ({vcodec || 'HEVC'} → H.264)</span>
            </div>
          )}
          {!needsTranscode && !useEmbed && (
            <div className="metadata-badge">
              <Check size={12} />
              <span>Direct Stream (Natively Supported)</span>
            </div>
          )}
          {selectedQuality !== 'original' && !useEmbed && (
            <div className="metadata-badge secondary">
              <span>Preset: {selectedQuality}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
