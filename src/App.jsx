import React, { useState, useEffect, useRef } from 'react';
import {
  Folder, User, LogOut, HelpCircle, HardDrive,
  Trash2, X, Plus, Clipboard, FileText, AlertCircle,
  CheckCircle2, Info, Play, Settings
} from 'lucide-react';

import Player from './components/Player';
import HistorySidebar from './components/HistorySidebar';
import AdminDashboard from './components/AdminDashboard';
import AuthOverlay from './components/AuthOverlay';
import DebugPanel from './components/DebugPanel';
import TorrentStats from './components/TorrentStats';
import TorrentFilesExplorer from './components/TorrentFilesExplorer';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import {
  mockGetHistory,
  mockAddHistory,
  mockDeleteHistoryItem,
  mockClearHistory,
  mockEditHistoryTitle,
  mockUpdateHistoryProgress
} from './utils/mockBackend';
import { getTorrentInfoFromBuffer, parseMagnetUri } from './utils/torrentParser';


export default function App() {
  // Authentication State
  const [session, setSession] = useState({
    username: localStorage.getItem('rawstream_session_username') || null,
    token: localStorage.getItem('rawstream_session_token') || null,
    isAdmin: localStorage.getItem('rawstream_session_is_admin') === 'true'
  });
  const [showAuth, setShowAuth] = useState(!session.token);

  // Google OAuth (for quota-exceeded Drive files)
  const googleAuth = useGoogleAuth();

  const [showSettings, setShowSettings] = useState(false);
  const settingsDialogRef = useRef(null);

  useEffect(() => {
    const dialog = settingsDialogRef.current;
    if (!dialog) return;
    if (showSettings) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [showSettings]);

  // Toast Stack Notifications
  const [toasts, setToasts] = useState([]);

  // Layout State
  const [showHistory, setShowHistory] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugLogs, setDebugLogs] = useState('[App started. Awaiting video stream...]');
  const [dragOver, setDragOver] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerLoaderMessage, setPlayerLoaderMessage] = useState('');

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
  const [activeTorrentInfo, setActiveTorrentInfo] = useState(null);
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
    if (session.token) {
      authenticatedFetch('/api/auth/logout', { method: 'POST' }).catch(err => console.error('Logout error:', err));
    }
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
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${session.token}`
    };
    try {
      const res = await fetch(url, { ...options, headers });
      return res;
    } catch (err) {
      console.error(`authenticatedFetch error for ${url}:`, err);
      throw err;
    }
  };

  const syncHistoryFromBackend = async () => {
    if (!session.token) return;
    try {
      const res = await authenticatedFetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      } else {
        const data = mockGetHistory(session.username);
        setHistoryList(data);
      }
    } catch (e) {
      console.error('Failed to sync history:', e);
      const data = mockGetHistory(session.username);
      setHistoryList(data);
    }
  };

  useEffect(() => {
    if (session.username) {
      syncHistoryFromBackend();
    }
  }, [session.username, session.token]);

  // History Actions
  const addToHistory = async (videoObj) => {
    if (!session.token) return;
    try {
      const res = await authenticatedFetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(videoObj)
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      } else {
        const data = mockAddHistory(session.username, videoObj);
        setHistoryList(data);
      }
    } catch (e) {
      console.error('Failed to add to history:', e);
      const data = mockAddHistory(session.username, videoObj);
      setHistoryList(data);
    }
  };

  const deleteHistoryItem = async (id, e) => {
    if (e) e.stopPropagation();
    if (!session.token) return;
    try {
      const res = await authenticatedFetch(`/api/history/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
        addToast('Stream removed from history', 'info');
      } else {
        const data = mockDeleteHistoryItem(session.username, id);
        setHistoryList(data);
        addToast('Stream removed from history', 'info');
      }
    } catch (e) {
      console.error('Failed to delete history item:', e);
      const data = mockDeleteHistoryItem(session.username, id);
      setHistoryList(data);
      addToast('Stream removed from history', 'info');
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
          const data = await res.json();
          setHistoryList(data);
          addToast('History cleared', 'info');
        } else {
          const data = mockClearHistory(session.username);
          setHistoryList(data);
          addToast('History cleared', 'info');
        }
      } catch (e) {
        console.error('Failed to clear history:', e);
        const data = mockClearHistory(session.username);
        setHistoryList(data);
        addToast('History cleared', 'info');
      }
    }
  };

  const editHistoryItemTitle = async (id, newTitle) => {
    if (!session.token) return;
    try {
      const res = await authenticatedFetch(`/api/history/${encodeURIComponent(id)}`, {
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
      } else {
        const data = mockEditHistoryTitle(session.username, id, newTitle);
        setHistoryList(data);
        if (currentVideo && currentVideo.id === id) {
          setCurrentVideo(prev => ({ ...prev, title: newTitle }));
        }
        addToast('Title updated', 'success');
      }
    } catch (e) {
      console.error('Failed to edit history item title:', e);
      const data = mockEditHistoryTitle(session.username, id, newTitle);
      setHistoryList(data);
      if (currentVideo && currentVideo.id === id) {
        setCurrentVideo(prev => ({ ...prev, title: newTitle }));
      }
      addToast('Title updated', 'success');
    }
  };

  const updateHistoryProgress = async (id, currentTime, duration) => {
    if (!session.token) return;
    try {
      const res = await authenticatedFetch(`/api/history/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime, duration })
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      } else {
        const data = mockUpdateHistoryProgress(session.username, id, currentTime, duration);
        setHistoryList(data);
      }
    } catch (e) {
      console.error('Failed to update progress in history:', e);
      const data = mockUpdateHistoryProgress(session.username, id, currentTime, duration);
      setHistoryList(data);
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
    if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
      return 'direct';
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

  // Stats polling (Simulated no-op for static deployment)
  const startTorrentStats = (infoHash) => {
    clearTorrentPolling();
  };

  // Loading Streams
  const loadVideoFromUrl = async (url, customTitle = null) => {
    clearTorrentPolling();
    setTorrentStats(null);
    setSelectedQuality('original');
    setActiveTorrentInfo(null);

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
      setPlayerLoaderMessage('Loading Google Drive stream...');
      logDebug(`Loading Google Drive stream: ${fileId}`);

      streamUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;

      setNeedsTranscode(false);
      setVcodec('h264');
      setAcodec('aac');
      setMediaDuration(0);

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
    } else {
      if (service === 'local' || service === 'direct') {
        fileId = service === 'local'
          ? 'local_' + url.replace(/[^a-zA-Z0-9]/g, '_')
          : 'direct_' + url.replace(/[^a-zA-Z0-9]/g, '_');
        streamUrl = service === 'local'
          ? `/api/stream?url=${encodeURIComponent(url)}`
          : url;
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
        addToast('Unsupported media format. Please paste a valid Google Drive link, OneDrive link, Torrent Magnet URI, or direct video URL.', 'error');
        setPlayerLoading(false);
        setPlayerLoaderMessage('');
        return;
      }

      setPlayerLoaderMessage('Probing media properties...');
      logDebug(`Probing media stream: ${streamUrl}`);

      let duration = 0;
      let transc = false;
      let vc = '';
      let ac = '';

      try {
        const probeRes = await fetch(`/api/probe?url=${encodeURIComponent(streamUrl)}`);
        if (probeRes.ok) {
          const meta = await probeRes.json();
          logDebug(`[Probe] Result: duration=${meta.duration}s, needsTranscode=${meta.needsTranscode}, vcodec=${meta.videoCodec}, acodec=${meta.audioCodec}`);
          duration = meta.duration || 0;
          transc = meta.needsTranscode || false;
          vc = meta.videoCodec || '';
          ac = meta.audioCodec || '';
        } else {
          logDebug('[Probe] Failed to probe media. Using direct fallback.');
        }
      } catch (err) {
        logDebug(`[Probe] Error: ${err.message}. Using direct fallback.`);
      }

      setNeedsTranscode(transc);
      setMediaDuration(duration);
      setVcodec(vc);
      setAcodec(ac);

      let filename = 'Direct HTTP Stream';
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart) filename = decodeURIComponent(lastPart);
      } catch (e) { }

      const videoObj = {
        id: fileId,
        title: customTitle || `${service === 'local' ? url.split('/').pop() : filename} (${new Date().toLocaleDateString()})`,
        originalUrl: url,
        streamUrl: streamUrl,
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

  const DEFAULT_TRACKERS = [
    'udp://tracker.openbittorrent.com:80/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://tracker.internetwarriors.net:1337/announce',
    'udp://tracker.leechers-paradise.org:6969/announce',
    'udp://tracker.coppersurfer.tk:6969/announce',
    'udp://tracker.exodus.desync.com:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://9.rarbg.to:2710/announce',
    'wss://tracker.fastcast.nz',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.webtorrent.io'
  ];

  const augmentMagnetWithTrackers = (magnetUri) => {
    if (!magnetUri || !magnetUri.startsWith('magnet:?')) return magnetUri;
    if (magnetUri.includes('wss://')) return magnetUri;
    const separator = magnetUri.includes('?') ? '&' : '?';
    const trackerParams = DEFAULT_TRACKERS.map(t => `tr=${encodeURIComponent(t)}`).join('&');
    return `${magnetUri}${separator}${trackerParams}`;
  };

  // Build torrent stream URL — direct by default, transcoded only when needed
  const buildTorrentServerStreamUrl = (infoHash, fileIndex = 0, forceTranscode = false, quality = 'original') => {
    const target = `/api/torrent/stream?infoHash=${encodeURIComponent(infoHash)}&fileIndex=${encodeURIComponent(fileIndex)}`;
    if (forceTranscode || (quality && quality !== 'original')) {
      const qualityParam = quality && quality !== 'original' ? `&quality=${encodeURIComponent(quality)}` : '';
      return `/api/stream?url=${encodeURIComponent(target)}&transcode=true${qualityParam}`;
    }
    // Direct stream — no FFmpeg overhead for native h264/AAC MP4 files
    return target;
  };

  const buildTorrentProbeUrl = (infoHash, fileIndex = 0) => {
    return `/api/torrent/stream?infoHash=${encodeURIComponent(infoHash)}&fileIndex=${encodeURIComponent(fileIndex)}`;
  };

  const fetchTorrentInfo = async (magnetUri, timeoutMs = 40000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`/api/torrent/info?torrentUrl=${encodeURIComponent(magnetUri)}`, {
        signal: controller.signal
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Torrent metadata request failed (${response.status})`);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        logDebug('[Torrent] Metadata fetch aborted after timeout. Continuing with partial torrent info.');
      } else {
        logDebug(`[Torrent] Metadata fetch failed: ${err.message}`);
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  const findPreferredTorrentFile = (files) => {
    if (!files || files.length === 0) return null;
    return files.find(f => {
      const name = f.name.toLowerCase();
      return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') ||
        name.endsWith('.avi') || name.endsWith('.mov') || name.endsWith('.ogv') ||
        name.endsWith('.m4v') || name.endsWith('.ts');
    }) || files[0];
  };

  const loadTorrent = async (torrentSource) => {
    setPlayerLoading(true);
    setPlayerLoaderMessage('Processing torrent data...');
    logDebug('Processing torrent data...');

    try {
      let info;
      let magnetUri = null;

      if (torrentSource instanceof Uint8Array || ArrayBuffer.isView(torrentSource)) {
        // Parse raw .torrent file buffer client-side
        info = await getTorrentInfoFromBuffer(torrentSource.buffer || torrentSource);
      } else if (typeof torrentSource === 'string' && torrentSource.startsWith('magnet:')) {
        // Parse magnet URI client-side
        info = parseMagnetUri(torrentSource);
        magnetUri = augmentMagnetWithTrackers(torrentSource);
      } else if (typeof torrentSource === 'string' && /^[a-fA-F0-9]{40}$/.test(torrentSource.trim())) {
        // Raw infohash
        info = {
          name: 'Torrent Stream',
          infoHash: torrentSource.trim().toLowerCase(),
          files: []
        };
        magnetUri = augmentMagnetWithTrackers(`magnet:?xt=urn:btih:${info.infoHash}&dn=${encodeURIComponent(info.name)}`);
      } else {
        throw new Error('Unsupported torrent source format. Please use magnet links or upload .torrent files.');
      }

      if (!magnetUri) {
        magnetUri = `magnet:?xt=urn:btih:${info.infoHash}&dn=${encodeURIComponent(info.name)}`;
      }

      const initialInfo = {
        ...info,
        files: info.files || []
      };
      setActiveTorrentInfo(initialInfo);

      const initialFile = findPreferredTorrentFile(initialInfo.files);
      const initialFileIndex = initialFile ? initialFile.index : 0;
      const streamUrl = buildTorrentServerStreamUrl(initialInfo.infoHash, initialFileIndex);
      const title = initialFile ? initialFile.name : initialInfo.name;

      if (initialInfo.files && initialInfo.files.length > 0) {
        // We already have files (e.g. uploaded .torrent file)
        const isNative = initialFile && (
          initialFile.name.toLowerCase().endsWith('.mp4') ||
          initialFile.name.toLowerCase().endsWith('.webm') ||
          initialFile.name.toLowerCase().endsWith('.mov')
        );
        setNeedsTranscode(!isNative);
        setMediaDuration(0);
        setVcodec('h264');
        setAcodec('aac');

        const videoObj = {
          id: initialInfo.infoHash,
          title,
          originalUrl: magnetUri,
          streamUrl,
          rawStreamUrl: `/api/torrent/stream?infoHash=${encodeURIComponent(initialInfo.infoHash)}&fileIndex=${encodeURIComponent(initialFileIndex)}`,
          service: 'torrent',
          torrentFileIndex: initialFileIndex,
          timestamp: Date.now()
        };

        setCurrentVideo(videoObj);
        setPlayerLoading(false);
        setPlayerLoaderMessage('');
        addToHistory(videoObj);
        setTorrentStats(null);

        // Run probe in the background
        logDebug(`[Torrent Probe] Initiating background probe for index ${initialFileIndex}...`);
        const probeUrl = buildTorrentProbeUrl(initialInfo.infoHash, initialFileIndex);
        fetch(`/api/probe?url=${encodeURIComponent(probeUrl)}`)
          .then(res => {
            if (res.ok) return res.json();
            throw new Error(`HTTP ${res.status}`);
          })
          .then(meta => {
            logDebug(`[Torrent Probe] Result: duration=${meta.duration}s, needsTranscode=${meta.needsTranscode}, vcodec=${meta.videoCodec}, acodec=${meta.audioCodec}`);
            setMediaDuration(meta.duration || 0);
            setNeedsTranscode(meta.needsTranscode !== undefined ? meta.needsTranscode : true);
            setVcodec(meta.videoCodec || 'h264');
            setAcodec(meta.audioCodec || 'aac');
          })
          .catch(err => {
            logDebug(`[Torrent Probe] Background probe failed: ${err.message}`);
          });
      } else {
        // No files yet (e.g. magnet link), keep loading spinner active
        setPlayerLoading(true);
        setPlayerLoaderMessage('Resolving torrent files list...');
        setTorrentStats(null);
      }

      if ((!initialInfo.files || initialInfo.files.length === 0) && magnetUri) {
        fetchTorrentInfo(magnetUri, 40000).then(async (backendInfo) => {
          if (backendInfo && backendInfo.infoHash === initialInfo.infoHash) {
            const mergedInfo = {
              ...initialInfo,
              name: backendInfo.name || initialInfo.name,
              files: backendInfo.files || initialInfo.files
            };
            setActiveTorrentInfo(mergedInfo);
            if (mergedInfo.files && mergedInfo.files.length > 0) {
              const preferredFile = findPreferredTorrentFile(mergedInfo.files);
              const targetIndex = preferredFile ? preferredFile.index : 0;
              const newStreamUrl = buildTorrentServerStreamUrl(mergedInfo.infoHash, targetIndex);

              const isPrefNative = preferredFile && (
                preferredFile.name.toLowerCase().endsWith('.mp4') ||
                preferredFile.name.toLowerCase().endsWith('.webm') ||
                preferredFile.name.toLowerCase().endsWith('.mov')
              );
              setNeedsTranscode(!isPrefNative);
              setMediaDuration(0);
              setVcodec('h264');
              setAcodec('aac');

              const videoObj = {
                id: mergedInfo.infoHash,
                title: preferredFile ? preferredFile.name : mergedInfo.name,
                originalUrl: magnetUri,
                streamUrl: newStreamUrl,
                rawStreamUrl: `/api/torrent/stream?infoHash=${encodeURIComponent(mergedInfo.infoHash)}&fileIndex=${encodeURIComponent(targetIndex)}`,
                service: 'torrent',
                torrentFileIndex: targetIndex,
                timestamp: Date.now()
              };

              setCurrentVideo(videoObj);
              setPlayerLoading(false);
              setPlayerLoaderMessage('');
              addToHistory(videoObj);

              // Probe in background once metadata loads
              logDebug(`[Torrent Background] Probing stream in background: ${newStreamUrl}`);
              const probeUrl = buildTorrentProbeUrl(mergedInfo.infoHash, targetIndex);
              fetch(`/api/probe?url=${encodeURIComponent(probeUrl)}`)
                .then(res => {
                  if (res.ok) return res.json();
                  throw new Error(`HTTP ${res.status}`);
                })
                .then(meta => {
                  logDebug(`[Torrent Background Probe] Result: duration=${meta.duration}s, needsTranscode=${meta.needsTranscode}`);
                  setMediaDuration(meta.duration || 0);
                  setNeedsTranscode(meta.needsTranscode !== undefined ? meta.needsTranscode : true);
                  setVcodec(meta.videoCodec || 'h264');
                  setAcodec(meta.audioCodec || 'aac');
                })
                .catch(e => {
                  logDebug(`[Torrent Background Probe] Error: ${e.message}`);
                });
            } else {
              addToast('No files found in torrent.', 'error');
              setPlayerLoading(false);
            }
          } else {
            // Backend unavailable — fall back to browser P2P mode regardless of host type.
            logDebug('[Torrent] Backend unavailable or no info returned. Falling back to browser P2P mode.');
            const videoObj = {
              id: initialInfo.infoHash,
              title: initialInfo.name || 'Torrent Stream',
              originalUrl: magnetUri,
              streamUrl: magnetUri,      // P2P mode reads originalUrl/streamUrl as the magnet
              rawStreamUrl: magnetUri,
              service: 'torrent',
              torrentFileIndex: 0,
              forceBrowserP2P: true,     // Signal Player.jsx to use browser WebTorrent even on non-static hosts
              timestamp: Date.now()
            };
            setCurrentVideo(videoObj);
            setPlayerLoading(false);
            setPlayerLoaderMessage('');
            addToHistory(videoObj);
            addToast('Streaming via browser P2P', 'info');
          }
        }).catch((err) => {
          logDebug(`[Torrent] Background metadata fetch failed: ${err.message}`);
          addToast('Failed to resolve torrent metadata.', 'error');
          setPlayerLoading(false);
        });
      }
    } catch (err) {
      logDebug(`Torrent load failed: ${err.message}`);
      addToast(err.message || 'Torrent stream initialization failed.', 'error');
      setPlayerLoading(false);
      setPlayerLoaderMessage('');
    }
  };

  const selectTorrentFile = (info, file) => {
    logDebug(`Switching to torrent file: "${file.name}"`);
    const magnetUri = `magnet:?xt=urn:btih:${info.infoHash}&dn=${encodeURIComponent(info.name)}`;
    const isFileNative = file.name.toLowerCase().endsWith('.mp4') ||
      file.name.toLowerCase().endsWith('.webm') ||
      file.name.toLowerCase().endsWith('.mov');
    const streamUrl = buildTorrentServerStreamUrl(info.infoHash, file.index, !isFileNative);

    setNeedsTranscode(!isFileNative);
    setMediaDuration(0);
    setVcodec('h264');
    setAcodec('aac');

    const directTorrentUrl = `/api/torrent/stream?infoHash=${encodeURIComponent(info.infoHash)}&fileIndex=${encodeURIComponent(file.index)}`;
    const videoObj = {
      id: info.infoHash,
      title: file.name,
      originalUrl: magnetUri,
      streamUrl,
      rawStreamUrl: directTorrentUrl,
      service: 'torrent',
      torrentFileIndex: file.index,
      timestamp: Date.now()
    };
    setCurrentVideo(videoObj);
    addToHistory(videoObj);

    // Perform probe asynchronously in the background
    logDebug(`[Torrent File Probe] Initiating background probe for index ${file.index}...`);
    const probeUrl = buildTorrentProbeUrl(info.infoHash, file.index);
    fetch(`/api/probe?url=${encodeURIComponent(probeUrl)}`)
      .then(res => {
        if (res.ok) return res.json();
        throw new Error(`HTTP ${res.status}`);
      })
      .then(meta => {
        logDebug(`[Torrent File Probe] Result: duration=${meta.duration}s, needsTranscode=${meta.needsTranscode}`);
        setMediaDuration(meta.duration || 0);
        setNeedsTranscode(meta.needsTranscode !== undefined ? meta.needsTranscode : true);
        setVcodec(meta.videoCodec || 'h264');
        setAcodec(meta.audioCodec || 'aac');
      })
      .catch(err => {
        logDebug(`[Torrent File Probe] Background probe failed: ${err.message}`);
      });
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
            <button className="header-btn" title="Open Settings" onClick={() => setShowSettings(true)}>
              <Settings size={16} />
              <span>Settings</span>
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
            googleAuth={googleAuth}
            onSyncProgress={updateHistoryProgress}
            onTorrentStats={setTorrentStats}
            torrentInfo={activeTorrentInfo}
          />

          {/* Torrent Files Explorer Drawer */}
          <TorrentFilesExplorer
            torrentInfo={activeTorrentInfo}
            onPlayFile={selectTorrentFile}
            currentVideo={currentVideo}
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

      {/* Settings Panel dialog drawer */}
      <dialog
        ref={settingsDialogRef}
        id="settings-dialog"
        className="glass-dialog admin-dialog"
        onClose={() => setShowSettings(false)}
      >
        <div className="dialog-header" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, color: 'white' }}>
            <Settings size={18} style={{ color: 'var(--accent-primary)' }} />
            Application Settings
          </h3>
          <button
            className="close-dialog-btn"
            aria-label="Close settings"
            onClick={() => setShowSettings(false)}
            style={{ background: 'none', border: 'none', color: 'var(--text-dimmed)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="dialog-body admin-dialog-body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="auth-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label htmlFor="settings-client-id" style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', fontWeight: '500' }}>Google OAuth Client ID</label>
            <input
              type="text"
              id="settings-client-id"
              placeholder="Paste Google OAuth Client ID here..."
              defaultValue={googleAuth.clientId || ''}
              onChange={(e) => {
                googleAuth.setClientId(e.target.value.trim());
              }}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '0.5rem 0.75rem',
                color: 'white',
                fontSize: '0.85rem',
                width: '100%',
                boxSizing: 'border-box'
              }}
            />
            <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', margin: '0.25rem 0 0 0', lineHeight: '1.4' }}>
              Configure a Google OAuth Client ID to bypass download quotas on private Google Drive files. The client ID is stored locally in your browser.
            </p>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#ef4444', fontSize: '0.85rem', fontWeight: '600' }}>Danger Zone</h4>
            <button
              onClick={() => {
                if (window.confirm('This will wipe all local users, stream history, and settings. Are you sure?')) {
                  localStorage.clear();
                  addToast('All local storage wiped. Reloading page...', 'success');
                  setTimeout(() => window.location.reload(), 1000);
                }
              }}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontWeight: '500',
                transition: 'all 0.2s'
              }}
            >
              Clear All Local Data & Reset
            </button>
          </div>
        </div>
      </dialog>

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
