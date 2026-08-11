import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, 
  Maximize, Minimize, Sliders, Settings, Subtitles, HelpCircle
} from 'lucide-react';

export default function Controls({
  show,
  videoRef,
  isPlaying,
  togglePlay,
  skip,
  mediaDuration,
  needsTranscode,
  currentVideo,
  selectedQuality,
  setSelectedQuality,
  videoRotation,
  setVideoRotation,
  videoAspect,
  setVideoAspect,
  videoMirror,
  setVideoMirror,
  transcodeStartTime,
  seekGDriveStream,
  seekTranscodedStream,
  isDraggingProgressRef,
  addToast,
  formatTime,
  isFullscreen,
  toggleFullscreen,
  isTheater,
  toggleTheater,
  bufferPercent,
  torrentSubtitleOptions = [],
  torrentSubtitlesLoaded = false,
  apiBaseUrl = '',
  cachedRanges = []
}) {
  // Volume state
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const volumeMemoryRef = useRef(1);

  // Time Tracker state
  const [currentTime, setCurrentTime] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [hoverTimeText, setHoverTimeText] = useState('0:00');
  const [hoverTimeLeft, setHoverTimeLeft] = useState('0%');
  const [showHoverTime, setShowHoverTime] = useState(false);

  // Speed state
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // Dropdown States
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);

  // Subtitles state
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [activeSubtitle, setActiveSubtitle] = useState('off');
  const [subtitlesUrl, setSubtitlesUrl] = useState('');
  const [uploadedSubtitles, setUploadedSubtitles] = useState([]); // Array of { label, content }
  const [loadingLazySubtitle, setLoadingLazySubtitle] = useState(false);
  const blobUrlsRef = useRef([]);

  const disableAllSubtitleTracks = () => {
    const video = videoRef.current;
    if (!video) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = 'disabled';
    }
  };

  const removeCustomSubtitleTracks = () => {
    const video = videoRef.current;
    if (!video) return;

    disableAllSubtitleTracks();
    video.querySelectorAll('track[data-custom="true"]').forEach(track => {
      track.remove();
    });
  };

  // Cleanup all blob URLs on unmount
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      });
    };
  }, []);

  // Timeline Progress Scrubber
  const handleProgressInput = (e) => {
    isDraggingProgressRef.current = true;
    const pct = parseFloat(e.target.value);
    setProgressPercent(pct);
  };

  const handleProgressChange = (e) => {
    isDraggingProgressRef.current = false;
    const pct = parseFloat(e.target.value);
    const video = videoRef.current;

    // Get the best available duration: prefer mediaDuration (pre-probed),
    // fall back to the live video element duration (populated once metadata loads)
    const duration = mediaDuration || video?.duration || 0;
    
    if (isNaN(duration) || duration <= 0 || !isFinite(duration)) return;
    const seekTime = (pct / 100) * duration;

    if (currentVideo?.service === 'google') {
      seekGDriveStream(seekTime);
    } else if (needsTranscode) {
      seekTranscodedStream(seekTime);
    } else {
      if (video) video.currentTime = seekTime;
    }
  };

  const handleProgressHover = (e) => {
    const duration = mediaDuration > 0 ? mediaDuration : videoRef.current?.duration;
    if (isNaN(duration) || duration <= 0) return;

    const rect = e.target.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const hoverSeconds = pos * duration;

    setHoverTimeText(formatTime(hoverSeconds));
    setHoverTimeLeft(`${pos * 100}%`);
    setShowHoverTime(true);
  };

  // Sync Progress Bar to Video Element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (isDraggingProgressRef.current) return;

      const useTranscode = needsTranscode || (selectedQuality && selectedQuality !== 'original') || transcodeStartTime > 0 || (video.src && video.src.includes('transcode=true'));
      let displayTime = video.currentTime;
      if (useTranscode) {
        displayTime = transcodeStartTime + video.currentTime;
      }

      // Best available duration: pre-probed mediaDuration first, then live video.duration
      const duration = mediaDuration || video.duration || 0;

      setCurrentTime(displayTime);
      if (duration > 0 && isFinite(duration)) {
        setProgressPercent((displayTime / duration) * 100);
      } else {
        setProgressPercent(0);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [currentVideo, mediaDuration, needsTranscode, transcodeStartTime, selectedQuality]);

  // Sync volume state with native video element (e.g. keyboard shortcuts via Player.jsx)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncVolumeState = () => {
      // Sync muted state
      const muted = video.muted || video.volume === 0;
      setIsMuted(muted);
      if (!muted) {
        setVolume(video.volume);
        volumeMemoryRef.current = video.volume;
      } else {
        setVolume(video.muted ? volumeMemoryRef.current : 0);
      }
    };

    video.addEventListener('volumechange', syncVolumeState);
    return () => video.removeEventListener('volumechange', syncVolumeState);
  }, [currentVideo]);

  // Reset custom subtitles and selection when video changes
  useEffect(() => {
    removeCustomSubtitleTracks();
    setUploadedSubtitles([]);
    setSubtitleTracks([]);
    setActiveSubtitle('off');
  }, [currentVideo]);

  // Volume Handlers
  const handleVolumeChange = (e) => {
    const video = videoRef.current;
    if (!video) return;
    const vol = parseFloat(e.target.value);
    video.volume = vol;
    setVolume(vol);
    volumeMemoryRef.current = vol;
    setIsMuted(vol === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isMuted) {
      const restore = volumeMemoryRef.current > 0.05 ? volumeMemoryRef.current : 1;
      video.volume = restore;
      setVolume(restore);
      setIsMuted(false);
    } else {
      video.volume = 0;
      setVolume(0);
      setIsMuted(true);
    }
  };

  // Speed Handlers
  const handleSpeedSelect = (val) => {
    const video = videoRef.current;
    if (video) video.playbackRate = val;
    setSpeed(val);
    setShowSpeedMenu(false);
    addToast(`Playback speed: ${val}x`, 'info');
  };

  // Aspect & Rotation Handlers
  const handleAspectAction = (action, val) => {
    if (action === 'rotate') {
      setVideoRotation(parseInt(val));
      addToast(`Rotation: ${val}°`, 'info');
    } else if (action === 'aspect') {
      setVideoAspect(val);
      addToast(`Aspect ratio: ${val}`, 'info');
    } else if (action === 'mirror') {
      setVideoMirror(val);
      addToast(`Mirroring: ${val}`, 'info');
    }
    setShowAspectMenu(false);
  };

  // Quality Preset Handlers
  const handleQualitySelect = (quality) => {
    if (selectedQuality === quality) return;
    setSelectedQuality(quality);
    setShowQualityMenu(false);

    const currentPos = needsTranscode
      ? transcodeStartTime + (videoRef.current?.currentTime || 0)
      : videoRef.current?.currentTime || 0;

    addToast(`Changing resolution to: ${quality}`, 'info');

    const video = videoRef.current;
    if (video) {
      if (currentVideo.service === 'google' && quality === 'original') {
        const streamUrl = `https://docs.google.com/uc?export=download&id=${currentVideo.id}`;
        video.src = streamUrl;
        video.load();
        seekGDriveStream(currentPos);
      } else {
        seekTranscodedStream(currentPos, quality);
      }
    }
  };

  // Subtitles Upload Handlers
  const convertSrtToVtt = (srtText) => {
    let vtt = 'WEBVTT\n\n' + srtText;
    vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return vtt;
  };

  const shiftVttTimestamps = (vttText, shiftSeconds) => {
    if (!shiftSeconds || shiftSeconds === 0) return vttText;

    const parseTimeToSeconds = (timeStr) => {
      const parts = timeStr.replace(',', '.').split(':');
      let hrs = 0, mins = 0, secs = 0;
      if (parts.length === 3) {
        hrs = parseFloat(parts[0]);
        mins = parseFloat(parts[1]);
        secs = parseFloat(parts[2]);
      } else if (parts.length === 2) {
        mins = parseFloat(parts[0]);
        secs = parseFloat(parts[1]);
      } else {
        secs = parseFloat(parts[0]) || 0;
      }
      return hrs * 3600 + mins * 60 + secs;
    };

    const formatSecondsToTime = (totalSeconds) => {
      if (totalSeconds < 0) totalSeconds = 0;
      const hrs = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = Math.floor(totalSeconds % 60);
      const ms = Math.floor((totalSeconds % 1) * 1000);
      const pad = (n, width = 2) => String(n).padStart(width, '0');
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`;
    };

    const timestampRegex = /((\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((\d{2}:)?\d{2}:\d{2}[.,]\d{3})/g;

    return vttText.replace(timestampRegex, (match, startStr, p2, endStr) => {
      const startSecs = parseTimeToSeconds(startStr);
      const endSecs = parseTimeToSeconds(endStr);
      
      const newStart = Math.max(0, startSecs - shiftSeconds);
      const newEnd = Math.max(0, endSecs - shiftSeconds);
      
      return `${formatSecondsToTime(newStart)} --> ${formatSecondsToTime(newEnd)}`;
    });
  };

  // Re-synchronize and shift subtitle cue times dynamically whenever transcodeStartTime,
  // uploadedSubtitles, or activeSubtitle changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Clean up existing custom uploaded track elements. Disable first so
    // browsers do not keep painting stale cues after a source switch.
    removeCustomSubtitleTracks();

    if (uploadedSubtitles.length === 0 || activeSubtitle === 'off') {
      disableAllSubtitleTracks();
      setSubtitleTracks([]);
      return;
    }

    // Re-create each custom subtitle track with shifted timestamps
    uploadedSubtitles.forEach(sub => {
      const shiftedContent = shiftVttTimestamps(sub.content, transcodeStartTime);
      const blob = new Blob([shiftedContent], { type: 'text/vtt' });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlsRef.current.push(blobUrl);

      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = sub.label;
      track.srclang = 'en';
      track.src = blobUrl;
      track.setAttribute('data-custom', 'true');
      if (sub.label === activeSubtitle) {
        track.default = true;
      }

      video.appendChild(track);
    });

    // Sync showing state of tracks
    const syncTimeout = setTimeout(() => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].label === activeSubtitle) {
          tracks[i].mode = 'showing';
        } else if (activeSubtitle === 'off') {
          tracks[i].mode = 'disabled';
        } else {
          // If another track was showing, keep it disabled
          if (tracks[i].label !== 'off') {
            tracks[i].mode = 'disabled';
          }
        }
      }

      // Refresh UI tracks list
      const loaded = [];
      for (let i = 0; i < tracks.length; i++) {
        loaded.push({ label: tracks[i].label, mode: tracks[i].mode });
      }
      setSubtitleTracks(loaded);
    }, 100);

    return () => {
      clearTimeout(syncTimeout);
    };
  }, [currentVideo, transcodeStartTime, uploadedSubtitles, activeSubtitle]);

  const handleSubtitlesUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      let content = evt.target.result;
      if (file.name.endsWith('.srt')) {
        content = convertSrtToVtt(content);
      }
      setUploadedSubtitles(prev => [
        ...prev.filter(x => x.label !== file.name),
        { label: file.name, content }
      ]);
      setActiveSubtitle(file.name);
      addToast(`Subtitles uploaded: ${file.name}`, 'success');
    };
    reader.readAsText(file);
    setShowSubtitlesMenu(false);
  };

  const handleSubtitlesUrlLoad = async () => {
    if (!subtitlesUrl.trim()) return;
    try {
      const parsed = new URL(subtitlesUrl);
      const label = `Remote VTT (${parsed.hostname})`;
      addToast('Fetching remote subtitle...', 'info');
      const response = await fetch(subtitlesUrl);
      if (!response.ok) throw new Error('Network response was not ok');
      let content = await response.text();
      if (subtitlesUrl.endsWith('.srt') || (content.includes('-->') && !content.startsWith('WEBVTT'))) {
        content = convertSrtToVtt(content);
      }
      setUploadedSubtitles(prev => [
        ...prev.filter(x => x.label !== label),
        { label, content }
      ]);
      setActiveSubtitle(label);
      setSubtitlesUrl('');
      setShowSubtitlesMenu(false);
      addToast('Remote subtitle loaded.', 'success');
    } catch (e) {
      addToast('Failed to load remote subtitle: ' + e.message, 'error');
    }
  };

  const toggleSubtitleTrack = async (label) => {
    if (label === 'off') {
      disableAllSubtitleTracks();
      setActiveSubtitle('off');
      setShowSubtitlesMenu(false);
      addToast('Subtitles turned off', 'info');
      return;
    }

    // Check if it's a torrent subtitle track that hasn't been fetched yet
    const option = torrentSubtitleOptions.find(opt => opt.label === label);
    const alreadyFetched = uploadedSubtitles.some(x => x.label === label);

    if (option && !alreadyFetched) {
      setLoadingLazySubtitle(true);
      addToast(`Fetching ${label} subtitles...`, 'info');
      try {
        const url = `${apiBaseUrl}/api/torrent/stream?infoHash=${encodeURIComponent(currentVideo.id)}&fileIndex=${encodeURIComponent(option.fileIndex)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let text = await res.text();
        
        // Convert SRT to VTT if needed
        if (label.toLowerCase().endsWith('.srt') || (text.includes('-->') && !text.startsWith('WEBVTT'))) {
          text = convertSrtToVtt(text);
        }
        
        setUploadedSubtitles(prev => [
          ...prev.filter(x => x.label !== label),
          { label, content: text }
        ]);
        setActiveSubtitle(label);
        addToast(`${label} subtitles loaded.`, 'success');
      } catch (err) {
        addToast(`Failed to load subtitles: ${err.message}`, 'error');
      } finally {
        setLoadingLazySubtitle(false);
        setShowSubtitlesMenu(false);
      }
    } else {
      setActiveSubtitle(label);
      setShowSubtitlesMenu(false);
      addToast(`Subtitles: ${label}`, 'info');
    }
  };

  // Close all other dropdowns when one opens
  const openDropdown = (menuSetter) => {
    setShowSpeedMenu(false);
    setShowAspectMenu(false);
    setShowQualityMenu(false);
    setShowSubtitlesMenu(false);
    menuSetter(prev => !prev);
  };

  // Document Click Listener to close menus
  useEffect(() => {
    const handleDocClick = () => {
      setShowSpeedMenu(false);
      setShowAspectMenu(false);
      setShowQualityMenu(false);
      setShowSubtitlesMenu(false);
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  // Best available total duration for the time display: prefer probed mediaDuration, fallback to live video.duration ONLY for native streams
  const useTranscode = needsTranscode || (selectedQuality && selectedQuality !== 'original') || transcodeStartTime > 0 || (videoRef.current?.src && videoRef.current.src.includes('transcode=true'));
  const totalDuration = mediaDuration > 0 
    ? mediaDuration 
    : (useTranscode ? 0 : (videoRef.current?.duration && isFinite(videoRef.current.duration) ? videoRef.current.duration : 0));

  // Gradient fill inline styling with multi-segment cached range visualization
  const maxBuffered = Math.max(progressPercent, bufferPercent || 0);

  // Build a gradient that shows: played (accent), browser buffer (white 40%), cached segments (white 25%), unbuffered (white 20%)
  const buildProgressGradient = () => {
    // If there are cached ranges from the Service Worker, render them as distinct segments
    if (cachedRanges.length > 0) {
      // Create gradient stops: played portion, then cached segments as brighter areas
      const stops = [];
      
      // Played portion (accent color)
      stops.push(`var(--accent-primary) 0%`);
      stops.push(`var(--accent-primary) ${progressPercent}%`);
      
      // Build segment stops for the rest of the bar
      // Collect all "bright" ranges: browser buffer + SW cached ranges
      const brightRanges = [];
      
      // Browser buffer range (from current position to bufferPercent)
      if (bufferPercent > progressPercent) {
        brightRanges.push({ start: progressPercent, end: bufferPercent, opacity: 0.4 });
      }
      
      // SW cached ranges (may be non-contiguous)
      for (const range of cachedRanges) {
        // Only show cached ranges that are beyond the played position
        if (range.end > progressPercent) {
          brightRanges.push({
            start: Math.max(range.start, progressPercent),
            end: range.end,
            opacity: 0.35
          });
        }
      }
      
      // Sort by start position
      brightRanges.sort((a, b) => a.start - b.start);
      
      // Merge overlapping ranges, taking the max opacity
      const merged = [];
      for (const r of brightRanges) {
        if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
          const last = merged[merged.length - 1];
          last.end = Math.max(last.end, r.end);
          last.opacity = Math.max(last.opacity, r.opacity);
        } else {
          merged.push({ ...r });
        }
      }
      
      // Build gradient stops from merged ranges
      let lastEnd = progressPercent;
      for (const seg of merged) {
        if (seg.start > lastEnd) {
          // Gap between segments: dark
          stops.push(`rgba(255, 255, 255, 0.15) ${lastEnd}%`);
          stops.push(`rgba(255, 255, 255, 0.15) ${seg.start}%`);
        }
        // Cached/buffered segment: brighter
        stops.push(`rgba(255, 255, 255, ${seg.opacity}) ${seg.start}%`);
        stops.push(`rgba(255, 255, 255, ${seg.opacity}) ${seg.end}%`);
        lastEnd = seg.end;
      }
      
      // Fill rest of the bar
      if (lastEnd < 100) {
        stops.push(`rgba(255, 255, 255, 0.15) ${lastEnd}%`);
        stops.push(`rgba(255, 255, 255, 0.15) 100%`);
      }
      
      return { background: `linear-gradient(to right, ${stops.join(', ')})` };
    }

    // Default: simple 3-zone gradient (played, buffered, unbuffered)
    return {
      background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${progressPercent}%, rgba(255, 255, 255, 0.4) ${progressPercent}%, rgba(255, 255, 255, 0.4) ${maxBuffered}%, rgba(255, 255, 255, 0.2) ${maxBuffered}%, rgba(255, 255, 255, 0.2) 100%)`
    };
  };

  const progressBgStyle = buildProgressGradient();

  return (
    <div id="video-controls" className={`video-controls ${show ? '' : 'hidden-controls'}`} onClick={(e) => e.stopPropagation()}>
      {/* Progress Bar Container */}
      <div className="progress-container">
        <input 
          type="range" 
          id="progress-bar" 
          min="0" 
          max="100" 
          value={progressPercent} 
          step="0.1" 
          onChange={handleProgressChange}
          onInput={handleProgressInput}
          onMouseMove={handleProgressHover}
          onMouseLeave={() => setShowHoverTime(false)}
          style={progressBgStyle}
          aria-label="Video Progress"
        />
        {showHoverTime && (
          <div id="progress-hover-time" className="hover-time" style={{ left: hoverTimeLeft }}>
            {hoverTimeText}
          </div>
        )}
      </div>

      {/* Control Buttons row */}
      <div className="controls-row">
        <div className="controls-group left">
          {/* Play/Pause */}
          <button id="play-btn" className="control-btn" onClick={togglePlay} aria-label="Play/Pause">
            {isPlaying ? <Pause className="pause-icon" fill="currentColor" /> : <Play className="play-icon" fill="currentColor" />}
          </button>

          {/* 10s Rewind */}
          <button className="control-btn" onClick={() => skip(-10)} aria-label="Rewind 10s">
            <RotateCcw />
            <span className="skip-label">10</span>
          </button>

          {/* 10s Forward */}
          <button className="control-btn" onClick={() => skip(10)} aria-label="Forward 10s">
            <RotateCw />
            <span className="skip-label">10</span>
          </button>

          {/* Volume */}
          <div className="volume-group">
            <button id="mute-btn" className="control-btn" onClick={toggleMute} aria-label="Mute/Unmute">
              {isMuted ? <VolumeX /> : <Volume2 />}
            </button>
            <input 
              type="range" 
              id="volume-slider" 
              min="0" 
              max="1" 
              step="0.05" 
              value={isMuted ? 0 : volume} 
              onChange={handleVolumeChange}
              style={{
                background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.2) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.2) 100%)`
              }}
              aria-label="Volume"
            />
          </div>

          {/* Time display */}
          <span className="time-display">
            <span id="current-time">{formatTime(currentTime)}</span>
            <span className="divider">/</span>
            <span id="duration-time">{formatTime(totalDuration)}</span>
          </span>
        </div>

        {/* Right controls group */}
        <div className="controls-group right">
          {/* Subtitles dropdown */}
          <div style={{ position: 'relative' }}>
            <button className="control-btn" title="Subtitles" onClick={(e) => { e.stopPropagation(); openDropdown(setShowSubtitlesMenu); }}>
              <Subtitles />
            </button>
            {showSubtitlesMenu && (() => {
              const allSubOptions = [];
              
              // Add native/uploaded tracks
              subtitleTracks.forEach(t => {
                if (t.label !== 'off') {
                  allSubOptions.push({
                    label: t.label,
                    isActive: activeSubtitle === t.label,
                    isLazy: false
                  });
                }
              });
              
              // Add torrent options
              torrentSubtitleOptions.forEach(opt => {
                if (!allSubOptions.some(item => item.label === opt.label)) {
                  allSubOptions.push({
                    label: opt.label,
                    isActive: activeSubtitle === opt.label,
                    isLazy: true
                  });
                }
              });
              
              // Sort them alphabetically by language label
              allSubOptions.sort((a, b) => a.label.localeCompare(b.label));

              return (
                <ul className="dropdown-menu" id="subtitles-menu" style={{ width: '220px', bottom: '40px' }}>
                  <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', paddingRight: '4px' }} className="custom-scrollbar">
                    <li className={activeSubtitle === 'off' ? 'active' : ''} onClick={() => toggleSubtitleTrack('off')}>
                      Off
                    </li>
                    {loadingLazySubtitle && (
                      <li style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-dimmed)', cursor: 'default' }}>
                        Loading subtitles...
                      </li>
                    )}
                    {currentVideo?.service === 'torrent' && torrentSubtitlesLoaded && torrentSubtitleOptions.length === 0 && (
                      <li style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-dimmed)', cursor: 'default' }}>
                        No subtitle file available in torrent
                      </li>
                    )}
                    {allSubOptions.map(opt => (
                      <li 
                        key={opt.label} 
                        className={opt.isActive ? 'active' : ''} 
                        onClick={() => toggleSubtitleTrack(opt.label)}
                      >
                        {opt.label}
                      </li>
                    ))}
                  </div>
                  <li className="menu-divider"></li>
                  <li style={{ padding: '8px 12px', cursor: 'default' }}>
                    <label htmlFor="sub-upload-file" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dimmed)', marginBottom: '4px', cursor: 'pointer' }}>
                      Upload subtitles (.srt, .vtt)
                    </label>
                    <input 
                      type="file" 
                      id="sub-upload-file" 
                      accept=".srt,.vtt" 
                      onChange={handleSubtitlesUpload} 
                      style={{ fontSize: '0.75rem', width: '100%', color: 'white' }} 
                    />
                  </li>
                  <li className="menu-divider"></li>
                  <li style={{ padding: '8px 12px', cursor: 'default', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>Load Remote VTT URL</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <input 
                        type="text" 
                        placeholder="https://..." 
                        value={subtitlesUrl}
                        onChange={(e) => setSubtitlesUrl(e.target.value)}
                        style={{ flex: 1, fontSize: '0.75rem', padding: '2px 4px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '4px' }} 
                      />
                      <button 
                        type="button" 
                        onClick={handleSubtitlesUrlLoad}
                        style={{ fontSize: '0.75rem', padding: '2px 6px', background: 'var(--accent-primary)', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Load
                      </button>
                    </div>
                  </li>
                </ul>
              );
            })()}
          </div>

          {/* Quality preset selection */}
          <div style={{ position: 'relative' }}>
            <button className="control-btn" title="Quality resolution presets" onClick={(e) => { e.stopPropagation(); openDropdown(setShowQualityMenu); }}>
              <Settings />
            </button>
            {showQualityMenu && (
              <ul className="dropdown-menu" id="quality-menu">
                <li className={selectedQuality === 'original' ? 'active' : ''} onClick={() => handleQualitySelect('original')}>Original/Auto</li>
                <li className={selectedQuality === '720p' ? 'active' : ''} onClick={() => handleQualitySelect('720p')}>720p (HD)</li>
                <li className={selectedQuality === '480p' ? 'active' : ''} onClick={() => handleQualitySelect('480p')}>480p (SD)</li>
              </ul>
            )}
          </div>

          {/* Speed settings selector */}
          <div style={{ position: 'relative' }}>
            <button className="control-btn text-btn" title="Playback speed" onClick={(e) => { e.stopPropagation(); openDropdown(setShowSpeedMenu); }}>
              <span>{speed === 1 ? '1.0' : speed}x</span>
            </button>
            {showSpeedMenu && (
              <ul className="dropdown-menu" id="speed-menu">
                {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(val => (
                  <li 
                    key={val} 
                    className={speed === val ? 'active' : ''} 
                    onClick={() => handleSpeedSelect(val)}
                  >
                    {val === 1.0 ? 'Normal (1.0x)' : `${val}x`}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Aspect & Rotation dropdown toggler */}
          <div style={{ position: 'relative' }}>
            <button className="control-btn" title="Aspect & Rotate Adjustments" onClick={(e) => { e.stopPropagation(); openDropdown(setShowAspectMenu); }}>
              <Sliders />
            </button>
            {showAspectMenu && (
              <ul className="dropdown-menu aspect-orient-menu" id="aspect-orient-menu">
                <li style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', cursor: 'default', padding: '4px 12px' }}>Rotate</li>
                <li className={videoRotation === 0 ? 'active' : ''} onClick={() => handleAspectAction('rotate', 0)}>0°</li>
                <li className={videoRotation === 90 ? 'active' : ''} onClick={() => handleAspectAction('rotate', 90)}>90°</li>
                <li className={videoRotation === 180 ? 'active' : ''} onClick={() => handleAspectAction('rotate', 180)}>180°</li>
                <li className={videoRotation === 270 ? 'active' : ''} onClick={() => handleAspectAction('rotate', 270)}>270°</li>
                <li className="menu-divider"></li>
                <li style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', cursor: 'default', padding: '4px 12px' }}>Aspect Ratio</li>
                <li className={videoAspect === 'contain' ? 'active' : ''} onClick={() => handleAspectAction('aspect', 'contain')}>Fit (Contain)</li>
                <li className={videoAspect === 'cover' ? 'active' : ''} onClick={() => handleAspectAction('aspect', 'cover')}>Fill Zoom (Cover)</li>
                <li className={videoAspect === 'fill' ? 'active' : ''} onClick={() => handleAspectAction('aspect', 'fill')}>Stretch (Fill)</li>
                <li className={videoAspect === '16-9' ? 'active' : ''} onClick={() => handleAspectAction('aspect', '16-9')}>16:9</li>
                <li className={videoAspect === '4-3' ? 'active' : ''} onClick={() => handleAspectAction('aspect', '4-3')}>4:3</li>
                <li className="menu-divider"></li>
                <li style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', cursor: 'default', padding: '4px 12px' }}>Mirror</li>
                <li className={videoMirror === 'none' ? 'active' : ''} onClick={() => handleAspectAction('mirror', 'none')}>None</li>
                <li className={videoMirror === 'horizontal' ? 'active' : ''} onClick={() => handleAspectAction('mirror', 'horizontal')}>Horizontal</li>
                <li className={videoMirror === 'vertical' ? 'active' : ''} onClick={() => handleAspectAction('mirror', 'vertical')}>Vertical</li>
              </ul>
            )}
          </div>

          {/* Theater Mode */}
          <button 
            id="theater-btn" 
            className={`control-btn ${isTheater ? 'active' : ''}`}
            title="Theater Mode" 
            onClick={toggleTheater}
            aria-label="Toggle Theater Mode"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: '20px', height: '20px' }}>
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <rect x="5" y="7" width="14" height="10" rx="1" />
            </svg>
          </button>

          {/* Fullscreen */}
          <button 
            id="fullscreen-btn" 
            className="control-btn" 
            title="Fullscreen" 
            onClick={toggleFullscreen}
            aria-label="Toggle Fullscreen"
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: '20px', height: '20px' }}>
                <path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: '20px', height: '20px' }}>
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
