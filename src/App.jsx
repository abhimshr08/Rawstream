import React, { useState, useEffect, useRef } from 'react';
import { 
  Folder, User, LogOut, HelpCircle, HardDrive, 
  Trash2, X, Plus, Clipboard, FileText, AlertCircle, 
  CheckCircle2, Info, Play
} from 'lucide-react';

import Player from './components/Player';
import HistorySidebar from './components/HistorySidebar';
import AdminDashboard from './components/AdminDashboard';
import AuthOverlay from './components/AuthOverlay';
import DebugPanel from './components/DebugPanel';
import TorrentStats from './components/TorrentStats';

export default function App() {
  // Authentication State
  const [session, setSession] = useState({
    username: localStorage.getItem('rawstream_session_username') || null,
    token: localStorage.getItem('rawstream_session_token') || null,
    isAdmin: localStorage.getItem('rawstream_session_is_admin') === 'true'
  });
  const [showAuth, setShowAuth] = useState(!session.token);

  // Layout State
  const [showHistory, setShowHistory] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugLogs, setDebugLogs] = useState('[App started. Awaiting video stream...]');
  const [dragOver, setDragOver] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerLoaderMessage, setPlayerLoaderMessage] = useState('');

  // Toast Stack Notifications
  const [toasts, setToasts] = useState([]);
  
  // Torrent and Media State
  const [historyList, setHistoryList] = useState([]);
  const [streamUrlInput, setStreamUrlInput] = useState('');
  const [detectedService, setDetectedService] = useState('unknown'); // 'google', 'onedrive', 'torrent', 'local', 'unknown'
  const [currentVideo, setCurrentVideo] = useState(null);
  
  // Transco  // Loading Streams
  const [mediaDuration, setMediaDuration] = useState(0);
  const [needsTranscode, setNeedsTranscode] = useState(false);
  const [vcodec, setVcodec] = useState('');
  const [acodec, setAcodec] = useState('');
  const [selectedQuality, setSelectedQuality] = useState('original');
  
  // Torrent Stats
  const [torrentStats, setTorrentStats] = useState(null); // { name, speed, peers, progress }
  const torrentPollInterval = useRef(null);

  // References
  const debugLogsEndRef = useRef(null);

  // Helpers
  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exit: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300);
    }, 3000);
  };

  const logDebug = (msg) => {
    const time = new Date().toLocaleTimeString();
    setDebugLogs(prev => prev + `\n[${time}] ${msg}`);
    console.log(`[Debug] ${msg}`);
  };

  useEffect(() => {
    if (debugLogsEndRef.current) {
      debugLogsEndRef.current.scrollTop = debugLogsEndRef.current.scrollHeight;
    }
  }, [debugLogs]);

  // Auth Functions
  const handleSetSession = (username, token, isAdmin) => {
    setSession({ username, token, isAdmin });
    localStorage.setItem('rawstream_session_username', username);
    localStorage.setItem('rawstream_session_token', token);
    localStorage.setItem('rawstream_session_is_admin', isAdmin ? 'true' : 'false');
    setShowAuth(false);
    addToast('Welcome back!', 'success');
  };

  const handleClearSession = () => {
    setSession({ username: null, token: null, isAdmin: false });
    localStorage.removeItem('rawstream_session_username');
    localStorage.removeItem('rawstream_session_token');
    localStorage.removeItem('rawstream_session_is_admin');
    setHistoryList([]);
    setCurrentVideo(null);
    setTorrentStats(null);
    setShowAuth(true);
    setShowAdmin(false);
    setShowDebug(false);
    addToast('Logged out successfully', 'info');
  };

  const authenticatedFetch = async (url, options = {}) => {
    options.headers = options.headers || {};
    if (session.token) {
      options.headers['Authorization'] = `Bearer ${session.token}`;
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
      handleClearSession();
    }
    return res;
  };

  const syncHistoryFromBackend = async () => {
    if (!session.token) return;
    try {
      const res = await authenticatedFetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      }
    } catch (e) {
      console.error('Failed to sync history from backend:', e);
    }
  };

  useEffect(() => {
    if (session.token) {
      syncHistoryFromBackend();
    }
  }, [session.token]);

  // History Actions
  const addToHistory = async (videoObj) => {
    if (!session.token) return;
    try {
      const res = await authenticatedFetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoObj })
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      }
    } catch (e) {
      console.error('Failed to add to history:', e);
    }
  };

  const deleteHistoryItem = async (id, e) => {
    if (e) e.stopPropagation();
    if (!session.token) return;
    try {
      const res = await authenticatedFetch(`/api/history/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
        addToast('Stream removed from history', 'info');
      }
    } catch (e) {
      console.error('Failed to delete history item:', e);
    }
  };

  const clearAllHistory = async () => {
    if (window.confirm('Are you sure you want to clear your entire streaming history?')) {
      if (!session.token) return;
      try {
        const res = await authenticatedFetch('/api/history', {
          method: 'DELETE'
        });
        if (res.ok) {
          setHistoryList([]);
          addToast('History cleared', 'info');
        }
      } catch (e) {
        console.error('Failed to clear history:', e);
      }
    }
  };

  const editHistoryItemTitle = async (id, newTitle) => {
    if (!session.token) return;
    try {
      const res = await authenticatedFetch(`/api/history/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
        if (currentVideo && currentVideo.id === id) {
          setCurrentVideo(prev => ({ ...prev, title: newTitle }));
        }
        addToast('Title updated', 'success');
      }
    } catch (e) {
      console.error('Failed to edit history item title:', e);
    }
  };

  // URL Parser Helper
  const detectService = (url) => {
    const lowerUrl = url.toLowerCase();
    if (url.startsWith('/') || /^[a-zA-Z]:\\/.test(url)) {
      return 'local';
    }
    if (lowerUrl.startsWith('magnet:') || lowerUrl.endsWith('.torrent')) {
      return 'torrent';
    }
    if (lowerUrl.includes('drive.google.com') || lowerUrl.includes('docs.google.com')) {
      return 'google';
    }
    if (
      lowerUrl.includes('onedrive.live.com') || 
      lowerUrl.includes('1drv.ms') || 
      lowerUrl.includes('sharepoint.com') || 
      lowerUrl.includes('api.onedrive.com')
    ) {
      return 'onedrive';
    }
    return 'unknown';
  };

  const handleUrlInputChange = (val) => {
    setStreamUrlInput(val);
    const service = detectService(val.trim());
    setDetectedService(service);
  };

  const parseGoogleDriveLink = (url) => {
    const reg1 = /\/file\/d\/([a-zA-Z0-9_-]+)/;
    const reg2 = /[?&]id=([a-zA-Z0-9_-]+)/;
    const match = url.match(reg1) || url.match(reg2);
    return match && match[1] ? { id: match[1] } : null;
  };

  const parseOneDriveLink = (url) => {
    try {
      if (url.includes('api.onedrive.com/v1.0/shares/')) {
        return {
          id: url.split('u!')[1].split('/')[0],
          streamUrl: url
        };
      }
      const base64Value = btoa(url);
      const safeBase64 = base64Value.replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/, '');
      return {
        id: safeBase64,
        streamUrl: `https://api.onedrive.com/v1.0/shares/u!${safeBase64}/root/content`
      };
    } catch (e) {
      console.error('OneDrive parse error', e);
      return null;
    }
  };

  // Clean up torrent cache stats polling
  const clearTorrentPolling = () => {
    if (torrentPollInterval.current) {
      clearInterval(torrentPollInterval.current);
      torrentPollInterval.current = null;
    }
  };

  // Stats polling
  const startTorrentStats = (infoHash) => {
    clearTorrentPolling();
    torrentPollInterval.current = setInterval(async () => {
      try {
        const res = await authenticatedFetch(`/api/torrent/status?infoHash=${encodeURIComponent(infoHash)}`);
        if (res.ok) {
          const stats = await res.json();
          setTorrentStats({
            name: stats.name,
            speed: stats.downloadSpeed,
            peers: stats.numPeers,
            progress: stats.progress
          });
        }
      } catch (err) {
        logDebug(`Stats poll error: ${err.message}`);
      }
    }, 1500);
  };

  // Loading Streams
  const loadVideoFromUrl = async (url, customTitle = null) => {
    clearTorrentPolling();
    setTorrentStats(null);
    setSelectedQuality('original');
    
    const service = detectService(url);
    if (service === 'torrent') {
      loadTorrent(url);
      return;
    }

    setPlayerLoading(true);
    setPlayerLoaderMessage('Analyzing media stream...');
    logDebug(`Analyzing media stream for service: ${service}...`);
    let fileId = '';
    let streamUrl = '';

    if (service === 'google') {
      const parsed = parseGoogleDriveLink(url);
      if (!parsed) {
        addToast('Error: Could not extract Google Drive file ID.', 'error');
        setPlayerLoading(false);
        setPlayerLoaderMessage('');
        return;
      }
      fileId = parsed.id;
      setPlayerLoaderMessage('Resolving Google Drive stream...');
      logDebug(`Resolving Google Drive stream: ${fileId}`);
      try {
        const resolveRes = await authenticatedFetch(`/api/resolve?fileId=${encodeURIComponent(fileId)}`);
        const resolveData = await resolveRes.json();
        if (!resolveRes.ok || resolveData.error) throw new Error(resolveData.error || 'Resolve failed');
        
        streamUrl = resolveData.streamUrl;
        logDebug(`Drive stream resolved: ${streamUrl}`);
        
        // Duration probe
        let resolvedDur = 0;
        try {
          const metaRes = await authenticatedFetch(`/api/gdrive-meta?fileId=${encodeURIComponent(fileId)}`);
          if (metaRes.ok) {
            const meta = await metaRes.json();
            if (meta.duration) {
              resolvedDur = meta.duration;
              setMediaDuration(meta.duration);
              logDebug(`Drive metadata duration: ${meta.duration}s`);
            }
          }
        } catch (e) {
          logDebug(`Drive metadata skipped: ${e.message}`);
        }

        setNeedsTranscode(false);
        setVcodec('h264');
        setAcodec('aac');
        
        const videoObj = {
          id: fileId,
          title: customTitle || `Stream - Google Drive (${new Date().toLocaleDateString()})`,
          originalUrl: url,
          streamUrl,
          rawStreamUrl: streamUrl,
          service,
          timestamp: Date.now()
        };
        setCurrentVideo(videoObj);
        setPlayerLoading(false);
        setPlayerLoaderMessage('');
        addToHistory(videoObj);
      } catch (err) {
        logDebug(`Google Drive stream resolution failed: ${err.message}`);
        addToast('Google Drive stream failed to resolve.', 'error');
        
        const videoObj = {
          id: fileId,
          title: `Google Drive Stream`,
          originalUrl: url,
          service,
          error: err.message || 'RESOLVE_FAILED',
          timestamp: Date.now()
        };
        setCurrentVideo(videoObj);
        setPlayerLoading(false);
        setPlayerLoaderMessage('');
      }
    } else {
      if (service === 'local') {
        fileId = 'local_' + url.replace(/[^a-zA-Z0-9]/g, '_');
        streamUrl = url;
      } else if (service === 'onedrive') {
        const parsed = parseOneDriveLink(url);
        if (!parsed) {
          addToast('Error: Could not parse OneDrive link.', 'error');
          setPlayerLoading(false);
          setPlayerLoaderMessage('');
          return;
        }
        fileId = parsed.id;
        streamUrl = parsed.streamUrl;
      } else {
        addToast('Error: Unsupported media link.', 'error');
        setPlayerLoading(false);
        setPlayerLoaderMessage('');
        return;
      }

      setPlayerLoaderMessage('Probing format details...');
      logDebug(`Probing format: ${streamUrl}`);
      let resolvedDur = 0;
      let resolvedTranscode = false;
      let resolvedVcodec = '';
      let resolvedAcodec = '';
      try {
        const probeRes = await authenticatedFetch(`/api/probe?url=${encodeURIComponent(streamUrl)}`);
        const probeData = await probeRes.json();
        if (probeData.error) throw new Error(probeData.error);
        
        resolvedDur = probeData.duration || 0;
        resolvedTranscode = probeData.needsTranscode;
        resolvedVcodec = probeData.videoCodec || '';
        resolvedAcodec = probeData.audioCodec || '';

        setMediaDuration(resolvedDur);
        setNeedsTranscode(resolvedTranscode);
        setVcodec(resolvedVcodec);
        setAcodec(resolvedAcodec);
        logDebug(`Probe metadata: duration=${resolvedDur}s, transcode=${resolvedTranscode}, vcodec=${resolvedVcodec}, acodec=${resolvedAcodec}`);
      } catch (err) {
        logDebug(`Probe failed (${err.message}). Defaulting to direct stream.`);
        setNeedsTranscode(false);
        setMediaDuration(0);
      }

      const finalStreamUrl = resolvedTranscode
        ? `/api/stream?url=${encodeURIComponent(streamUrl)}&transcode=true&vcodec=${encodeURIComponent(resolvedVcodec)}&acodec=${encodeURIComponent(resolvedAcodec)}`
        : `/api/stream?url=${encodeURIComponent(streamUrl)}`;

      const videoObj = {
        id: fileId,
        title: customTitle || `${service === 'local' ? url.split('/').pop() : 'OneDrive Stream'} (${new Date().toLocaleDateString()})`,
        originalUrl: url,
        streamUrl: finalStreamUrl,
        rawStreamUrl: streamUrl,
        service,
        timestamp: Date.now()
      };
      setCurrentVideo(videoObj);
      setPlayerLoading(false);
      setPlayerLoaderMessage('');
      addToHistory(videoObj);
    }
  };

  const loadTorrent = async (torrentSource) => {
    setPlayerLoading(true);
    setPlayerLoaderMessage('Connecting to WebTorrent cache...');
    logDebug('Connecting to WebTorrent cache...');
    try {
      let res;
      if (torrentSource instanceof Uint8Array || ArrayBuffer.isView(torrentSource)) {
        res = await authenticatedFetch('/api/torrent/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: torrentSource
        });
      } else {
        res = await authenticatedFetch(`/api/torrent/info?torrentUrl=${encodeURIComponent(torrentSource)}`);
      }

      const info = await res.json();
      if (!res.ok || info.error) throw new Error(info.error || 'Torrent failed');

      logDebug(`Torrent loaded: "${info.name}" (${info.files.length} files)`);
      setPlayerLoaderMessage('Selecting playable video file...');

      const videoFile = info.files.find(f => {
        const name = f.name.toLowerCase();
        return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') ||
               name.endsWith('.avi') || name.endsWith('.mov') || name.endsWith('.ogv') ||
               name.endsWith('.m4v') || name.endsWith('.ts');
      });

      if (!videoFile) {
        addToast('No playable video file found in torrent.', 'error');
        setPlayerLoading(false);
        setPlayerLoaderMessage('');
        return;
      }

      logDebug(`Selected file: "${videoFile.name}" (${(videoFile.length / 1024 / 1024).toFixed(1)} MB)`);
      
      const streamUrl = `/api/torrent/stream?infoHash=${encodeURIComponent(info.infoHash)}&fileIndex=${videoFile.index}`;
      
      // Smart extension-based transcoding decision (no probe - torrent has no data yet)
      // MP4/WebM/M4V/MOV -> browser-native, stream direct
      // MKV/AVI/TS/OGV -> need FFmpeg transcode for browser compatibility
      const fname = videoFile.name.toLowerCase();
      const nativeExts = ['.mp4', '.webm', '.m4v', '.mov'];
      const transcodeExts = ['.mkv', '.avi', '.ts', '.ogv'];
      const isNative = nativeExts.some(e => fname.endsWith(e));
      const needsTc = !isNative; // transcode non-native formats
      
      // For MKV/AVI: transcode with copy-video + transcode-audio (most MKV have h264 video, ac3/dts audio)
      // Use aac audio transcode always for browser compat, video copy where possible
      const resolvedVcodec = 'h264';
      const resolvedAcodec = needsTc ? 'ac3' : 'aac';

      setMediaDuration(0); // Duration unknown until video plays
      setNeedsTranscode(needsTc);
      setVcodec(resolvedVcodec);
      setAcodec(resolvedAcodec);
      logDebug(`Torrent format: ${fname} → ${needsTc ? 'transcode (aac audio)' : 'direct stream'}`);

      const finalStreamUrl = needsTc
        ? `/api/stream?url=${encodeURIComponent(streamUrl)}&transcode=true&vcodec=${encodeURIComponent(resolvedVcodec)}&acodec=${encodeURIComponent(resolvedAcodec)}`
        : streamUrl;

      const videoObj = {
        id: info.infoHash,
        title: videoFile.name,
        originalUrl: typeof torrentSource === 'string' ? torrentSource : `magnet:?xt=urn:btih:${info.infoHash}`,
        streamUrl: finalStreamUrl,
        rawStreamUrl: streamUrl,
        service: 'torrent',
        timestamp: Date.now()
      };
      setCurrentVideo(videoObj);
      setPlayerLoading(false);
      setPlayerLoaderMessage('');
      addToHistory(videoObj);
      startTorrentStats(info.infoHash);
    } catch (err) {
      logDebug(`Torrent load failed: ${err.message}`);
      addToast('WebTorrent connection error.', 'error');
      setPlayerLoading(false);
      setPlayerLoaderMessage('');
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    const url = streamUrlInput.trim();
    if (!url) return;
    loadVideoFromUrl(url);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      handleUrlInputChange(text);
      addToast('URL pasted from clipboard', 'info');
    } catch (err) {
      addToast('Clipboard blocked. Paste manually using Cmd+V/Ctrl+V.', 'error');
    }
  };

  const clearInput = () => {
    setStreamUrlInput('');
    setDetectedService('unknown');
    clearTorrentPolling();
    setTorrentStats(null);
  };

  // Keyboard Shortcuts handler query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug') || params.get('debug') === 'true') {
      setShowDebug(true);
    }
  }, []);

  return (
    <div className="app-container" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={async (e) => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.torrent')) {
          logDebug(`Torrent dropped: ${file.name}`);
          addToast(`Reading file: ${file.name}`, 'info');
          const reader = new FileReader();
          reader.onload = (evt) => {
            const buffer = new Uint8Array(evt.target.result);
            loadTorrent(buffer);
          };
          reader.readAsArrayBuffer(file);
        } else if (file.type.startsWith('video/') || ['.mp4', '.mkv', '.mov', '.webm', '.avi'].some(ext => file.name.toLowerCase().endsWith(ext))) {
          logDebug(`Local video dropped: ${file.name}`);
          addToast(`Loading local file: ${file.name}`, 'info');
          const localUrl = URL.createObjectURL(file);
          const videoObj = {
            id: 'local_' + Date.now(),
            title: file.name,
            originalUrl: localUrl,
            streamUrl: localUrl,
            service: 'local',
            timestamp: Date.now()
          };
          setCurrentVideo(videoObj);
        } else {
          addToast('Please drop a valid .torrent or video file.', 'error');
        }
      }
    }}>
      {/* Dynamic Toast Container */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast-item ${t.exit ? 'exit' : ''}`}>
            {t.type === 'success' && <CheckCircle2 size={16} style={{ color: 'var(--accent-secondary)' }} />}
            {t.type === 'error' && <AlertCircle size={16} style={{ color: '#ef4444' }} />}
            {t.type === 'info' && <Info size={16} style={{ color: 'var(--accent-primary)' }} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="app-header" style={{ padding: '1.25rem 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: '1800px', margin: '0 auto' }}>
          <div className="header-logo">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <polygon points="10 11 16 14 10 17 10 11"></polygon>
            </svg>
            <h1>Raw<span>Stream</span></h1>
          </div>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {session.token && (
              <div className="user-profile-badge">
                <User size={14} style={{ color: 'var(--accent-secondary)', filter: 'drop-shadow(0 0 4px var(--accent-secondary))' }} />
                <span>{session.username}</span>
                <button className="logout-btn" title="Log Out" onClick={handleClearSession}>
                  <LogOut size={14} />
                  <span>Log Out</span>
                </button>
              </div>
            )}
            {session.isAdmin && (
              <button className="header-btn" title="Admin Dashboard" onClick={() => setShowAdmin(true)}>
                <HardDrive size={16} />
                <span>Admin</span>
              </button>
            )}
            {session.isAdmin && (
              <button className={`header-btn ${showDebug ? 'active' : ''}`} title="Toggle Debug Logs" onClick={() => setShowDebug(!showDebug)}>
                <FileText size={16} />
                <span>Debug</span>
              </button>
            )}
            <button className="header-btn" title="Toggle Stream History" onClick={() => setShowHistory(!showHistory)}>
              <Info size={16} />
              <span>History</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="main-layout">
        <main className="player-panel">
          {/* Form parser card */}
          <section className={`input-card glass-panel ${dragOver ? 'drag-over' : ''}`}>
            <h2>Stream anything, from anywhere</h2>
            <p className="subtitle">Paste a public Google Drive, OneDrive link, or Torrent Magnet below to play instantly.</p>
            
            <form onSubmit={handleFormSubmit} className="media-parser-form-container">
              <div className="url-box-wrapper">
                <span className="input-icon">
                  <Folder size={16} />
                </span>
                <input 
                  type="text" 
                  value={streamUrlInput}
                  onChange={(e) => handleUrlInputChange(e.target.value)}
                  placeholder="Paste cloud link, magnet, or drop video/.torrent file..." 
                  required 
                  autoComplete="off"
                  aria-label="Video or Torrent Link"
                />
                <button type="button" className="clip-paste-action" title="Paste from Clipboard" onClick={pasteFromClipboard}>
                  <Clipboard size={14} />
                  <span className="btn-text">Paste</span>
                </button>
              </div>
              <div className="controls-box-row">
                <button type="submit" className="load-media-action">
                  <Play size={16} fill="currentColor" />
                  Load Stream
                </button>
                <button type="button" className="reset-fields-action" onClick={clearInput}>Clear</button>
              </div>
            </form>
            
            <div className="form-metadata-row">
              {detectedService !== 'unknown' && (
                <div className="detection-badge">
                  <span className="badge-dot"></span>
                  <span>{
                    detectedService === 'google' ? 'Google Drive' :
                    detectedService === 'onedrive' ? 'OneDrive' :
                    detectedService === 'torrent' ? 'BitTorrent Magnet' : 'Local File'
                  } detected</span>
                </div>
              )}
              <div className="drag-drop-hint">
                <span>Or drag & drop a <strong>.torrent</strong> or <strong>video file</strong> here</span>
              </div>
            </div>
          </section>

          {/* Core Player container */}
          <Player 
            currentVideo={currentVideo} 
            session={session}
            mediaDuration={mediaDuration}
            setMediaDuration={setMediaDuration}
            needsTranscode={needsTranscode}
            vcodec={vcodec}
            acodec={acodec}
            selectedQuality={selectedQuality}
            setSelectedQuality={setSelectedQuality}
            historyList={historyList}
            authenticatedFetch={authenticatedFetch}
            addToast={addToast}
            logDebug={logDebug}
            playerLoading={playerLoading}
            playerLoaderMessage={playerLoaderMessage}
            onRecoverTorrent={loadTorrent}
          />

          {/* Torrent downloading status details card */}
          <TorrentStats stats={torrentStats} />
        </main>

        {/* Stream History logs sidebar */}
        <HistorySidebar 
          show={showHistory} 
          list={historyList} 
          currentVideo={currentVideo}
          onLoadStream={(item) => {
            handleUrlInputChange(item.originalUrl);
            loadVideoFromUrl(item.originalUrl, item.title);
          }}
          onRename={editHistoryItemTitle}
          onDelete={deleteHistoryItem}
          onClearAll={clearAllHistory}
        />
      </div>

      {/* Admin Panel dialog drawer */}
      <AdminDashboard 
        open={showAdmin} 
        onClose={() => setShowAdmin(false)} 
        authenticatedFetch={authenticatedFetch}
        addToast={addToast}
      />

      {/* Admin Live debugger panel */}
      <DebugPanel 
        show={showDebug && session.isAdmin}
        logs={debugLogs}
        onClear={() => setDebugLogs('[Logs cleared]')}
      />

      {/* Help Modal trigger */}
      <button className="help-btn" onClick={() => setShowShortcuts(true)} title="Shortcuts guide">
        <HelpCircle size={20} />
      </button>

      {/* Shortcuts modal dialog popup */}
      {showShortcuts && (
        <dialog open className="shortcuts-dialog-modal glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'white' }}>Keyboard Shortcuts</h3>
            <button className="dialog-close-action" onClick={() => setShowShortcuts(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dimmed)', cursor: 'pointer' }}>
              <X size={20} />
            </button>
          </div>
          <div className="shortcuts-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Play / Pause</span>
              <kbd className="kbd-key">Space</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Rewind 10 Seconds</span>
              <kbd className="kbd-key">←</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Forward 10 Seconds</span>
              <kbd className="kbd-key">→</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Volume Up</span>
              <kbd className="kbd-key">↑</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Volume Down</span>
              <kbd className="kbd-key">↓</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Mute / Unmute</span>
              <kbd className="kbd-key">M</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Toggle Fullscreen</span>
              <kbd className="kbd-key">F</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Toggle Theater Mode</span>
              <kbd className="kbd-key">T</kbd>
            </div>
          </div>
        </dialog>
      )}

      {/* Auth Screen Overlay overlay */}
      <AuthOverlay 
        show={showAuth}
        onSuccess={handleSetSession}
      />
    </div>
  );
}
