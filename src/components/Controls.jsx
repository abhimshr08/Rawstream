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
  driveSeekBase,
  transcodeStartTime,
  seekGDriveStream,
  seekTranscodedStream,
  isDraggingProgressRef,
  addToast,
  formatTime
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

  // Timeline Progress Scrubber
  const handleProgressInput = (e) => {
    isDraggingProgressRef.current = true;
    const pct = parseFloat(e.target.value);
    setProgressPercent(pct);
  };

  const handleProgressChange = (e) => {
    isDraggingProgressRef.current = false;
    const pct = parseFloat(e.target.value);
    const duration = currentVideo?.service === 'google' 
      ? mediaDuration 
      : (needsTranscode ? mediaDuration : videoRef.current?.duration);
    
    if (isNaN(duration) || duration <= 0) return;
    const seekTime = (pct / 100) * duration;

    if (currentVideo?.service === 'google') {
      seekGDriveStream(seekTime);
    } else if (needsTranscode) {
      seekTranscodedStream(seekTime);
    } else {
      const video = videoRef.current;
      if (video) video.currentTime = seekTime;
    }
  };

  const handleProgressHover = (e) => {
    const duration = needsTranscode ? mediaDuration : videoRef.current?.duration;
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

      let displayTime = video.currentTime;
      if (currentVideo?.service === 'google') {
        displayTime = driveSeekBase + video.currentTime;
      } else if (needsTranscode) {
        displayTime = transcodeStartTime + video.currentTime;
      }

      const duration = currentVideo?.service === 'google' || needsTranscode
        ? mediaDuration
        : video.duration;

      setCurrentTime(displayTime);
      if (duration > 0) {
        setProgressPercent((displayTime / duration) * 100);
      } else {
        setProgressPercent(0);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [currentVideo, mediaDuration, needsTranscode, driveSeekBase, transcodeStartTime]);

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

    let currentPos = videoRef.current?.currentTime || 0;
    if (currentVideo?.service === 'google') {
      currentPos = driveSeekBase + (videoRef.current?.currentTime || 0);
    } else if (needsTranscode) {
      currentPos = transcodeStartTime + (videoRef.current?.currentTime || 0);
    }

    addToast(`Changing resolution to: ${quality}`, 'info');

    // Reload src with quality
    let newSrc = '';
    const rawUrl = currentVideo.rawStreamUrl || currentVideo.streamUrl;
    if (quality === 'original') {
      if (currentVideo.service === 'google') {
        newSrc = `/api/gdrive-stream?fileId=${encodeURIComponent(currentVideo.id)}`;
      } else if (needsTranscode) {
        newSrc = `/api/stream?url=${encodeURIComponent(rawUrl)}&transcode=true&vcodec=${encodeURIComponent(vcodec)}&acodec=${encodeURIComponent(acodec)}`;
      } else {
        newSrc = `/api/stream?url=${encodeURIComponent(rawUrl)}`;
      }
    } else {
      newSrc = `/api/stream?url=${encodeURIComponent(rawUrl)}&quality=${quality}&transcode=true&vcodec=${encodeURIComponent(vcodec)}&acodec=${encodeURIComponent(acodec)}`;
    }

    const video = videoRef.current;
    if (video) {
      video.src = newSrc;
      video.load();
      if (currentVideo.service === 'google' && quality === 'original') {
        seekGDriveStream(currentPos);
      } else {
        seekTranscodedStream(currentPos);
      }
    }
  };

  // Subtitles Upload Handlers
  const convertSrtToVtt = (srtText) => {
    let vtt = 'WEBVTT\n\n' + srtText;
    vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return vtt;
  };

  const addSubtitleTrack = (src, label) => {
    const video = videoRef.current;
    if (!video) return;

    // Check if label already exists
    const existing = video.querySelectorAll('track');
    existing.forEach(t => {
      if (t.label === label) t.remove();
    });

    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = label;
    track.srclang = 'en';
    track.src = src;
    track.default = true;

    video.appendChild(track);

    // Turn off all other tracks, turn on this one
    setTimeout(() => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].label === label) {
          tracks[i].mode = 'showing';
        } else {
          tracks[i].mode = 'disabled';
        }
      }
      
      // Update local state list
      const loaded = [];
      for (let i = 0; i < tracks.length; i++) {
        loaded.push({ label: tracks[i].label, mode: tracks[i].mode });
      }
      setSubtitleTracks(loaded);
      setActiveSubtitle(label);
    }, 100);
  };

  const handleSubtitlesUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      let content = evt.target.result;
      if (file.name.endsWith('.srt')) {
        content = convertSrtToVtt(content);
      }
      const blob = new Blob([content], { type: 'text/vtt' });
      const blobUrl = URL.createObjectURL(blob);
      addSubtitleTrack(blobUrl, file.name);
      addToast(`Subtitles uploaded: ${file.name}`, 'success');
    };
    reader.readAsText(file);
    setShowSubtitlesMenu(false);
  };

  const handleSubtitlesUrlLoad = () => {
    if (!subtitlesUrl.trim()) return;
    try {
      const parsed = new URL(subtitlesUrl);
      const label = `Remote VTT (${parsed.hostname})`;
      addSubtitleTrack(subtitlesUrl, label);
      setSubtitlesUrl('');
      setShowSubtitlesMenu(false);
      addToast('Remote subtitle loaded.', 'success');
    } catch (e) {
      addToast('Invalid URL format.', 'error');
    }
  };

  const toggleSubtitleTrack = (label) => {
    const video = videoRef.current;
    if (!video) return;

    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      if (label === 'off') {
        tracks[i].mode = 'disabled';
      } else {
        tracks[i].mode = tracks[i].label === label ? 'showing' : 'disabled';
      }
    }

    // Refresh state list
    const loaded = [];
    for (let i = 0; i < tracks.length; i++) {
      loaded.push({ label: tracks[i].label, mode: tracks[i].mode });
    }
    setSubtitleTracks(loaded);
    setActiveSubtitle(label);
    setShowSubtitlesMenu(false);
    addToast(label === 'off' ? 'Subtitles turned off' : `Subtitles: ${label}`, 'info');
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

  const totalDuration = currentVideo?.service === 'google' || needsTranscode
    ? mediaDuration
    : (videoRef.current?.duration || 0);

  // Gradient fill inline styling
  const progressBgStyle = {
    background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${progressPercent}%, rgba(255, 255, 255, 0.2) ${progressPercent}%, rgba(255, 255, 255, 0.2) 100%)`
  };

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
            {showSubtitlesMenu && (
              <ul className="custom-dropdown-menu" id="subtitles-menu" style={{ width: '220px', bottom: '40px' }}>
                <li className={activeSubtitle === 'off' ? 'active' : ''} onClick={() => toggleSubtitleTrack('off')}>
                  Off
                </li>
                {subtitleTracks.map(t => (
                  <li key={t.label} className={activeSubtitle === t.label ? 'active' : ''} onClick={() => toggleSubtitleTrack(t.label)}>
                    {t.label}
                  </li>
                ))}
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
            )}
          </div>

          {/* Quality preset selection */}
          <div style={{ position: 'relative' }}>
            <button className="control-btn" title="Quality resolution presets" onClick={(e) => { e.stopPropagation(); openDropdown(setShowQualityMenu); }}>
              <Settings />
            </button>
            {showQualityMenu && (
              <ul className="custom-dropdown-menu" id="quality-menu">
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
              <ul className="custom-dropdown-menu" id="speed-menu">
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
              <ul className="custom-dropdown-menu" id="aspect-orient-menu" style={{ width: '180px', bottom: '40px' }}>
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
        </div>
      </div>
    </div>
  );
}
