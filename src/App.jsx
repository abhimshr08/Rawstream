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

const isTvBrowser = typeof navigator !== 'undefined' && (
  /SmartTV|Tizen|WebOS|LG\sBrowser|LG\sTV|JioSphere|Jio\sSphere|JioPages|Jio\sPages|SamsungTV|SonyTV|AppleTV|Panasonic|Philips|Viera|Roku|Opera\sTV|NetCast|DuneHD|Vizio/i.test(navigator.userAgent)
);

const isStaticHost = typeof window !== 'undefined' && (
  window.location.hostname.endsWith('.github.io') ||
  window.location.hostname.endsWith('.netlify.app') ||
  window.location.hostname.endsWith('.vercel.app') ||
  window.location.hostname.endsWith('.pages.dev')
);

export default function App() {
  // Authentication State
  const [session, setSession] = useState({
    username: localStorage.getItem('rawstream_session_username') || null,
    token: localStorage.getItem('rawstream_session_token') || null,
    isAdmin: localStorage.getItem('rawstream_session_is_admin') === 'true'
  });
  const sessionRef = useRef(session);
  const [showAuth, setShowAuth] = useState(!session.token);

  // Backend URL Config State
  const [backendUrl, setBackendUrlState] = useState(() => {
    const stored = localStorage.getItem('rawstream_backend_url');
    if (stored !== null) return stored;
    
    // Default dynamic resolution
    const hostname = window.location.hostname;
    
    if (isStaticHost) {
      return 'https://maverick9876-rawstream.hf.space';
    }
    
    // For local dev server running on a different port than Express backend (which defaults to 3000)
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && window.location.port !== '3000') {
      return 'http://localhost:3000';
    }
    
    return '';
  });

  const apiBaseUrl = backendUrl.trim().replace(/\/$/, '');

  const [isOfflineMode, setIsOfflineMode] = useState(() => {
    const stored = localStorage.getItem('rawstream_offline_mode');
    if (stored !== null) return stored === 'true';
    return isStaticHost;
  });
  const [backendReachable, setBackendReachable] = useState(null);

  // Auto-discover local backend server on port 3000 when running on static hosts
  useEffect(() => {
    if (isStaticHost && backendUrl !== 'http://localhost:3000' && !localStorage.getItem('rawstream_backend_url')) {
      fetch('http://localhost:3000/api/config', { signal: AbortSignal.timeout(1500) })
        .then(res => res.json())
        .then(data => {
          if (data && data.success) {
            console.log('[App] Auto-connected to active local backend on http://localhost:3000');
            setBackendUrlState('http://localhost:3000');
          }
        })
        .catch(() => {/* local server not active */});
    }
  }, [isStaticHost, backendUrl]);

  useEffect(() => {
    if (isOfflineMode) {
      setBackendReachable(null);
      return;
    }
    const pingBackend = async () => {
      setBackendReachable(null);
      try {
        const res = await fetch(`${apiBaseUrl}/api/config`);
        const contentType = res.headers.get('content-type');
        if (res.ok && contentType && contentType.includes('application/json')) {
          setBackendReachable(true);
        } else {
          setBackendReachable(false);
        }
      } catch (e) {
        setBackendReachable(false);
      }
    };
    pingBackend();
  }, [apiBaseUrl, isOfflineMode]);

  // Google OAuth (for quota-exceeded Drive files)
  const googleAuth = useGoogleAuth(apiBaseUrl);

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
  const [showHistory, setShowHistory] = useState(() => {
    // Hide sidebar on TV browsers by default to maximize player space
    if (isTvBrowser) return false;
    return true;
  });
  const [disableFx, setDisableFx] = useState(() => {
    const stored = localStorage.getItem('rawstream_disable_fx');
    if (stored !== null) return stored === 'true';
    return isTvBrowser; // Default to true on TV browsers, false on desktop
  });
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

  // Keepalive: ping the backend every 30 s while a video is active so that
  // free-tier HF Spaces (which sleep after ~2 min of inactivity) do not go
  // dormant mid-stream and return transient errors that break the session.
  useEffect(() => {
    if (!currentVideo || isOfflineMode || !apiBaseUrl) return;
    const keepAlive = () => {
      fetch(`${apiBaseUrl}/api/config`, { method: 'GET' }).catch(() => {/* silent */});
    };
    const id = setInterval(keepAlive, 30000); // 30 seconds
    return () => clearInterval(id);
  }, [currentVideo, isOfflineMode, apiBaseUrl]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

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

  const loadLocalHistory = (username) => {
    try {
      const key = `rawstream_local_history_${username || 'guest'}`;
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  };

  const saveLocalHistory = (username, list) => {
    try {
      const key = `rawstream_local_history_${username || 'guest'}`;
      localStorage.setItem(key, JSON.stringify(list || []));
    } catch (e) {}
  };

  const mergeHistories = (primary, fallback) => {
    const map = new Map();
    (fallback || []).forEach(item => {
      if (item && item.id) map.set(item.id, item);
    });
    (primary || []).forEach(item => {
      if (item && item.id) {
        const existing = map.get(item.id);
        if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
          map.set(item.id, item);
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  };

  const clearUserScopedState = (clearVideo = true) => {
    clearTorrentPolling();
    if (clearVideo) {
      setCurrentVideo(null);
    }
    setTorrentStats(null);
    setActiveTorrentInfo(null);
    setStreamUrlInput('');
    setDetectedService('unknown');
    setSelectedQuality('original');
    setShowAdmin(false);
    setShowDebug(false);
    setPlayerLoading(false);
    setPlayerLoaderMessage('');
  };

  useEffect(() => {
    if (debugLogsEndRef.current) {
      debugLogsEndRef.current.scrollTop = debugLogsEndRef.current.scrollHeight;
    }
  }, [debugLogs]);

  // Auth Functions
  const handleSetSession = (username, token, isAdmin) => {
    const nextSession = { username, token, isAdmin };
    sessionRef.current = nextSession;
    clearUserScopedState(true);
    setSession(nextSession);
    localStorage.setItem('rawstream_session_username', username);
    localStorage.setItem('rawstream_session_token', token);
    localStorage.setItem('rawstream_session_is_admin', isAdmin ? 'true' : 'false');
    setShowAuth(false);
    addToast('Welcome back!', 'success');
  };

  const handleClearSession = (skipBackendLogout = false, clearVideo = true) => {
    if (session.token && !skipBackendLogout && !session.token.startsWith('mock-token-')) {
      const headers = { 'Authorization': `Bearer ${session.token}` };
      fetch(`${apiBaseUrl}/api/auth/logout`, { method: 'POST', headers }).catch(err => console.error('Logout error:', err));
    }
    sessionRef.current = { username: null, token: null, isAdmin: false };
    clearUserScopedState(clearVideo);
    setSession({ username: null, token: null, isAdmin: false });
    localStorage.removeItem('rawstream_session_username');
    localStorage.removeItem('rawstream_session_token');
    localStorage.removeItem('rawstream_session_is_admin');
    setShowAuth(true);
    addToast('Logged out successfully', 'info');
  };

  const handleUnauthorized = () => {
    const current = sessionRef.current;
    if (current?.token && !current.token.startsWith('mock-token-')) {
      handleClearSession(true, false); // Keep current video stream active during background 401
      addToast('Session expired. Please sign in again.', 'warning');
    }
  };

  const authenticatedFetch = async (url, options = {}) => {
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${session.token}`
    };
    try {
      const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `${apiBaseUrl}${url}`;
      const res = await fetch(fullUrl, { ...options, headers });
      if (res.status === 401) {
        handleUnauthorized();
      }
      return res;
    } catch (err) {
      console.error(`authenticatedFetch error for ${url}:`, err);
      throw err;
    }
  };

  const isActiveSession = (targetSession) => {
    const active = sessionRef.current;
    return !!(
      targetSession?.username &&
      targetSession?.token &&
      active?.username === targetSession.username &&
      active?.token === targetSession.token
    );
  };

  const sessionFetch = async (targetSession, url, options = {}) => {
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${targetSession.token}`
    };
    try {
      const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `${apiBaseUrl}${url}`;
      const res = await fetch(fullUrl, { ...options, headers });
      if (res.status === 401) {
        handleUnauthorized();
      }
      return res;
    } catch (err) {
      console.error(`sessionFetch error for ${url}:`, err);
      throw err;
    }
  };

  const syncHistoryFromBackend = async (targetSession = sessionRef.current) => {
    const uname = targetSession?.username || 'guest';
    const local = loadLocalHistory(uname);

    if (!targetSession?.token || !targetSession?.username) {
      setHistoryList(local);
      return;
    }

    if (isOfflineMode || targetSession.token.startsWith('mock-token-')) {
      const mockData = mockGetHistory(targetSession.username);
      const merged = mergeHistories(mockData, local);
      saveLocalHistory(targetSession.username, merged);
      setHistoryList(merged);
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/history`, {
        headers: { Authorization: `Bearer ${targetSession.token}` }
      });
      if (!isActiveSession(targetSession)) return;

      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const backendData = await res.json();
          if (!isActiveSession(targetSession)) return;
          const merged = mergeHistories(backendData, local);
          saveLocalHistory(targetSession.username, merged);
          setHistoryList(merged);
        } else {
          setHistoryList(local);
        }
      } else {
        const merged = mergeHistories(mockGetHistory(targetSession.username), local);
        saveLocalHistory(targetSession.username, merged);
        setHistoryList(merged);
      }
    } catch (e) {
      console.error('Failed to sync history:', e);
      if (!isActiveSession(targetSession)) return;
      setHistoryList(local);
    }
  };

  useEffect(() => {
    const checkSession = async () => {
      const current = sessionRef.current;
      if (current?.token && !current.token.startsWith('mock-token-')) {
        try {
          const res = await fetch(`${apiBaseUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${current.token}` }
          });
          if (res.status === 401) {
            handleUnauthorized();
          } else if (res.ok) {
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const data = await res.json();
              if (data.username && (data.isAdmin !== current.isAdmin)) {
                handleSetSession(data.username, current.token, data.isAdmin);
              }
            }
          }
        } catch (e) {
          console.error('Failed to verify session on load:', e);
        }
      }
    };
    checkSession();
  }, [apiBaseUrl]);

  useEffect(() => {
    const uname = session.username || 'guest';
    const local = loadLocalHistory(uname);
    setHistoryList(local);
    if (session.username && session.token) {
      syncHistoryFromBackend(session);
    }
  }, [session.username, session.token]);

  useEffect(() => {
    const uname = session.username || 'guest';
    if (historyList && historyList.length > 0) {
      saveLocalHistory(uname, historyList);
    }
  }, [historyList, session.username]);

  // History Actions
  const addToHistory = async (videoObj) => {
    const targetSession = session;
    if (!targetSession?.token) return;

    if (isOfflineMode || targetSession.token.startsWith('mock-token-')) {
      const data = mockAddHistory(targetSession.username, videoObj);
      setHistoryList(data);
      return;
    }

    try {
      const res = await sessionFetch(targetSession, '/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(videoObj)
      });
      if (!isActiveSession(targetSession)) return;
      if (res.ok) {
        const data = await res.json();
        if (!isActiveSession(targetSession)) return;
        setHistoryList(data);
      } else {
        if (res.status !== 401) {
          addToast('Failed to add to history', 'error');
        }
      }
    } catch (e) {
      console.error('Failed to add to history:', e);
      addToast('Connection error: Failed to save history', 'error');
    }
  };

  const deleteHistoryItem = async (id, e) => {
    if (e) e.stopPropagation();
    const targetSession = session;
    if (!targetSession?.token) return;

    if (isOfflineMode || targetSession.token.startsWith('mock-token-')) {
      const data = mockDeleteHistoryItem(targetSession.username, id);
      setHistoryList(data);
      addToast('Stream removed from history', 'info');
      return;
    }

    try {
      const res = await sessionFetch(targetSession, `/api/history/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!isActiveSession(targetSession)) return;
      if (res.ok) {
        const data = await res.json();
        if (!isActiveSession(targetSession)) return;
        setHistoryList(data);
        addToast('Stream removed from history', 'info');
      } else {
        if (res.status !== 401) {
          addToast('Failed to delete history item', 'error');
        }
      }
    } catch (e) {
      console.error('Failed to delete history item:', e);
      addToast('Connection error: Failed to delete item', 'error');
    }
  };

  const clearAllHistory = async () => {
    if (window.confirm('Are you sure you want to clear your entire streaming history?')) {
      const uname = session.username || 'guest';
      try {
        localStorage.removeItem(`rawstream_local_history_${uname}`);
      } catch (e) {}

      const targetSession = session;
      if (!targetSession?.token) {
        setHistoryList([]);
        return;
      }

      if (isOfflineMode || targetSession.token.startsWith('mock-token-')) {
        const data = mockClearHistory(targetSession.username);
        setHistoryList(data);
        addToast('History cleared', 'info');
        return;
      }

      try {
        const res = await sessionFetch(targetSession, '/api/history', {
          method: 'DELETE'
        });
        if (!isActiveSession(targetSession)) return;
        if (res.ok) {
          const data = await res.json();
          if (!isActiveSession(targetSession)) return;
          setHistoryList(data);
          addToast('History cleared', 'info');
        } else {
          setHistoryList([]);
          if (res.status !== 401) {
            addToast('Failed to clear server history', 'error');
          }
        }
      } catch (e) {
        console.error('Failed to clear history:', e);
        setHistoryList([]);
        addToast('History cleared locally', 'info');
      }
    }
  };

  const editHistoryItemTitle = async (id, newTitle) => {
    const targetSession = session;
    if (!targetSession?.token) return;

    if (isOfflineMode || targetSession.token.startsWith('mock-token-')) {
      const data = mockEditHistoryTitle(targetSession.username, id, newTitle);
      setHistoryList(data);
      if (currentVideo && currentVideo.id === id) {
        setCurrentVideo(prev => ({ ...prev, title: newTitle }));
      }
      addToast('Title updated', 'success');
      return;
    }

    try {
      const res = await sessionFetch(targetSession, `/api/history/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
      if (!isActiveSession(targetSession)) return;
      if (res.ok) {
        const data = await res.json();
        if (!isActiveSession(targetSession)) return;
        setHistoryList(data);
        if (currentVideo && currentVideo.id === id) {
          setCurrentVideo(prev => ({ ...prev, title: newTitle }));
        }
        addToast('Title updated', 'success');
      } else {
        if (res.status !== 401) {
          addToast('Failed to update title', 'error');
        }
      }
    } catch (e) {
      console.error('Failed to edit history item title:', e);
      addToast('Connection error: Failed to update title', 'error');
    }
  };

  const updateHistoryProgress = async (id, currentTime, duration) => {
    const targetSession = session;
    if (!targetSession?.token) return;

    if (isOfflineMode || targetSession.token.startsWith('mock-token-')) {
      const data = mockUpdateHistoryProgress(targetSession.username, id, currentTime, duration);
      setHistoryList(data);
      return;
    }

    try {
      // Use a plain fetch (not sessionFetch) so that transient 401s from a
      // sleeping/rebooting backend (e.g. HF Space waking up) do NOT trigger
      // handleUnauthorized() and wipe the current video / log the user out.
      const fullUrl = `${apiBaseUrl}/api/history/${encodeURIComponent(id)}`;
      const res = await fetch(fullUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${targetSession.token}`
        },
        body: JSON.stringify({ currentTime, duration })
      });
      if (!isActiveSession(targetSession)) return;
      if (res.ok) {
        const data = await res.json();
        if (!isActiveSession(targetSession)) return;
        setHistoryList(data);
      }
    } catch (e) {
      // Silently ignore – progress sync is non-critical
      console.debug('Progress sync skipped (backend unreachable):', e.message);
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

  const attachResumeProgress = (videoObj, resumeSource) => {
    const currentTime = Number(resumeSource?.currentTime || 0);
    const duration = Number(resumeSource?.duration || 0);
    if (currentTime > 0 && duration > 0) {
      return { ...videoObj, currentTime, duration };
    }
    return videoObj;
  };

  // Loading Streams
  const loadVideoFromUrl = async (url, customTitle = null, resumeSource = null) => {
    clearTorrentPolling();
    setTorrentStats(null);
    setSelectedQuality('original');
    setActiveTorrentInfo(null);

    const service = detectService(url);
    if (service === 'torrent') {
      loadTorrent(url, resumeSource);
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

      const videoObj = attachResumeProgress({
        id: fileId,
        title: customTitle || `Stream - Google Drive (${new Date().toLocaleDateString()})`,
        originalUrl: url,
        streamUrl,
        rawStreamUrl: streamUrl,
        service,
        timestamp: Date.now()
      }, resumeSource);
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
        const probeRes = await fetch(`${apiBaseUrl}/api/probe?url=${encodeURIComponent(streamUrl)}`);
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

      const videoObj = attachResumeProgress({
        id: fileId,
        title: customTitle || `${service === 'local' ? url.split('/').pop() : filename} (${new Date().toLocaleDateString()})`,
        originalUrl: url,
        streamUrl: streamUrl,
        rawStreamUrl: streamUrl,
        service,
        timestamp: Date.now()
      }, resumeSource);
      setCurrentVideo(videoObj);
      setPlayerLoading(false);
      setPlayerLoaderMessage('');
      addToHistory(videoObj);
    }
  };

  const DEFAULT_TRACKERS = [
    // UDP trackers (widely used, actively maintained)
    'udp://tracker.openbittorrent.com:80/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.tiny-vps.com:6969/announce',
    'udp://tracker.pirateparty.gr:6969/announce',
    // HTTP trackers (work in environments where UDP is blocked)
    'http://tracker.opentrackr.org:1337/announce',
    'http://tracker.openbittorrent.com:80/announce',
    'https://tracker.gbitt.info/announce',
    'https://tracker.lilithraws.org/announce',
    // WebSocket trackers (required for browser WebTorrent P2P)
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.fastcast.nz',
    'wss://tracker.files.fm'
  ];

  const augmentMagnetWithTrackers = (magnetUri) => {
    if (!magnetUri || !magnetUri.startsWith('magnet:?')) return magnetUri;

    // Always add missing working trackers, even if the magnet already contains some
    const existingTrackers = new Set();
    const trMatches = magnetUri.match(/tr=[^&]*/g) || [];
    for (const match of trMatches) {
      try {
        const decoded = decodeURIComponent(match.slice(3)).toLowerCase();
        existingTrackers.add(decoded);
      } catch (e) {}
    }

    const addedTrackers = [];
    for (const tracker of DEFAULT_TRACKERS) {
      if (!existingTrackers.has(tracker.toLowerCase())) {
        addedTrackers.push(tracker);
      }
    }

    if (addedTrackers.length > 0) {
      const separator = magnetUri.includes('&') || magnetUri.includes('?') ? '&' : '?';
      const trackerParams = addedTrackers.map(t => `tr=${encodeURIComponent(t)}`).join('&');
      return `${magnetUri}${separator}${trackerParams}`;
    }

    return magnetUri;
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
      const response = await fetch(`${apiBaseUrl}/api/torrent/info?torrentUrl=${encodeURIComponent(magnetUri)}`, {
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

  const loadTorrent = async (torrentSource, resumeSource = null) => {
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

        const videoObj = attachResumeProgress({
          id: initialInfo.infoHash,
          title,
          originalUrl: magnetUri,
          streamUrl,
          rawStreamUrl: `/api/torrent/stream?infoHash=${encodeURIComponent(initialInfo.infoHash)}&fileIndex=${encodeURIComponent(initialFileIndex)}`,
          service: 'torrent',
          torrentFileIndex: initialFileIndex,
          timestamp: Date.now()
        }, resumeSource);

        setCurrentVideo(videoObj);
        setPlayerLoading(false);
        setPlayerLoaderMessage('');
        addToHistory(videoObj);
        setTorrentStats(null);

        // Run probe in the background
        logDebug(`[Torrent Probe] Initiating background probe for index ${initialFileIndex}...`);
        const probeUrl = buildTorrentProbeUrl(initialInfo.infoHash, initialFileIndex);
        fetch(`${apiBaseUrl}/api/probe?url=${encodeURIComponent(probeUrl)}`)
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

              const fileName = preferredFile ? preferredFile.name.toLowerCase() : '';
              const containsHevcOrHighCodec = fileName.includes('hevc') || fileName.includes('h265') || fileName.includes('x265') || fileName.includes('10bit') || fileName.includes('hdr') || fileName.includes('ddp') || fileName.includes('dts') || fileName.includes('ac3') || fileName.includes('web-dl') || fileName.includes('1080p') || fileName.includes('2160p') || fileName.includes('4k');
              
              // Torrent releases overwhelmingly use HEVC/H.265 or non-native audio/video codecs.
              // Always default server torrent streams to needsTranscode = true unless explicitly verified as standard H.264 MP4.
              const isStrictNativeMp4 = fileName.endsWith('.mp4') && !containsHevcOrHighCodec;
              setNeedsTranscode(!isStrictNativeMp4);
              setMediaDuration(mergedInfo.duration || 0);
              setVcodec('h264');
              setAcodec('aac');

              const videoObj = attachResumeProgress({
                id: mergedInfo.infoHash,
                title: preferredFile ? preferredFile.name : mergedInfo.name,
                originalUrl: magnetUri,
                streamUrl: newStreamUrl,
                rawStreamUrl: `/api/torrent/stream?infoHash=${encodeURIComponent(mergedInfo.infoHash)}&fileIndex=${encodeURIComponent(targetIndex)}`,
                service: 'torrent',
                torrentFileIndex: targetIndex,
                timestamp: Date.now()
              }, resumeSource);

              setCurrentVideo(videoObj);
              setPlayerLoading(false);
              setPlayerLoaderMessage('');
              addToHistory(videoObj);

              // For torrent streams, needsTranscode is already determined by filename/container.
              // Skipping background ffprobe prevents bandwidth contention on torrent piece downloads.
              logDebug(`[Torrent Background] Server torrent stream ready: ${newStreamUrl}`);
            } else {
              addToast('No files found in torrent.', 'error');
              setPlayerLoading(false);
            }
          } else if (isStaticHost && backendReachable === false) {
            // Only force browser P2P if backend is genuinely offline/unreachable on static hosts
            logDebug('[Torrent] Backend unreachable on static host. Falling back to browser P2P mode.');
            const videoObj = attachResumeProgress({
              id: initialInfo.infoHash,
              title: initialInfo.name || 'Torrent Stream',
              originalUrl: magnetUri,
              streamUrl: magnetUri,
              rawStreamUrl: magnetUri,
              service: 'torrent',
              torrentFileIndex: 0,
              forceBrowserP2P: true,
              timestamp: Date.now()
            }, resumeSource);
            setCurrentVideo(videoObj);
            setPlayerLoading(false);
            setPlayerLoaderMessage('');
            addToHistory(videoObj);
            addToast('Streaming via browser P2P', 'info');
          } else {
            // Backend server is available: use server torrent stream route so FFmpeg transcodes MKV/H.265 files for full video display
            logDebug('[Torrent] Using server stream route for torrent playback.');
            const newStreamUrl = buildTorrentServerStreamUrl(initialInfo.infoHash, 0);
            const isPrefNative = initialInfo.name && (
              initialInfo.name.toLowerCase().endsWith('.mp4') ||
              initialInfo.name.toLowerCase().endsWith('.webm')
            );
            setNeedsTranscode(!isPrefNative);
            const videoObj = attachResumeProgress({
              id: initialInfo.infoHash,
              title: initialInfo.name || 'Torrent Stream',
              originalUrl: magnetUri,
              streamUrl: newStreamUrl,
              rawStreamUrl: `/api/torrent/stream?infoHash=${encodeURIComponent(initialInfo.infoHash)}&fileIndex=0`,
              service: 'torrent',
              torrentFileIndex: 0,
              timestamp: Date.now()
            }, resumeSource);
            setCurrentVideo(videoObj);
            setPlayerLoading(false);
            setPlayerLoaderMessage('');
            addToHistory(videoObj);
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
    fetch(`${apiBaseUrl}/api/probe?url=${encodeURIComponent(probeUrl)}`)
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
      <header className="app-header">
        <div className="header-inner">
          <div className="header-logo">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <polygon points="10 11 16 14 10 17 10 11"></polygon>
            </svg>
            <h1>Raw<span>Stream</span></h1>
            {isOfflineMode && (
              <span className="demo-mode-badge" style={{
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#f59e0b',
                padding: '0.15rem 0.5rem',
                borderRadius: '12px',
                fontSize: '0.7rem',
                fontWeight: '600',
                marginLeft: '0.75rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap'
              }}>
                ⚠️ Demo Mode
              </span>
            )}
            {!isOfflineMode && backendReachable === false && (
              <span className="demo-mode-badge" style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                padding: '0.15rem 0.5rem',
                borderRadius: '12px',
                fontSize: '0.7rem',
                fontWeight: '600',
                marginLeft: '0.75rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap'
              }}>
                ❌ Server Offline
              </span>
            )}
          </div>
          <div className="header-actions">
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
      <div className={`main-layout ${showHistory ? '' : 'sidebar-collapsed'}`}>
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
            apiBaseUrl={apiBaseUrl}
            disableFx={disableFx}
          />

          {/* Torrent Files Explorer Drawer */}
          <TorrentFilesExplorer
            torrentInfo={activeTorrentInfo}
            onPlayFile={selectTorrentFile}
            currentVideo={currentVideo}
            apiBaseUrl={apiBaseUrl}
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
            loadVideoFromUrl(item.originalUrl, item.title, item);
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

          <div className="auth-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label htmlFor="settings-backend-url" style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', fontWeight: '500' }}>Backend API URL</label>
            <input
              type="text"
              id="settings-backend-url"
              placeholder="e.g. http://localhost:3000"
              defaultValue={backendUrl}
              onChange={(e) => {
                const val = e.target.value.trim();
                setBackendUrlState(val);
                if (val) {
                  localStorage.setItem('rawstream_backend_url', val);
                } else {
                  localStorage.removeItem('rawstream_backend_url');
                }
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
              Connect to a custom Express backend. Leave blank to default to relative paths (when running on localhost) or http://localhost:3000 (when deployed on static hosts like GitHub Pages).
            </p>
          </div>

          <div className="auth-input-group" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <input
              type="checkbox"
              id="settings-offline-mode"
              checked={isOfflineMode}
              onChange={(e) => {
                const checked = e.target.checked;
                setIsOfflineMode(checked);
                if (checked) {
                  localStorage.setItem('rawstream_offline_mode', 'true');
                  addToast('Switched to Offline Demo Mode (local storage)', 'info');
                } else {
                  localStorage.removeItem('rawstream_offline_mode');
                  addToast('Switched to Real Backend Mode', 'info');
                }
              }}
              style={{
                cursor: 'pointer',
                width: '16px',
                height: '16px',
                accentColor: 'var(--accent-primary)'
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label htmlFor="settings-offline-mode" style={{ fontSize: '0.85rem', color: 'white', fontWeight: '500', cursor: 'pointer', margin: 0 }}>Offline Demo Mode</label>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', lineHeight: '1.3' }}>
                Use mock browser storage instead of the Express backend database. Helpful for static previews.
              </span>
            </div>
          </div>

          <div className="auth-input-group" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <input
              type="checkbox"
              id="settings-disable-fx"
              checked={disableFx}
              onChange={(e) => {
                const checked = e.target.checked;
                setDisableFx(checked);
                if (checked) {
                  localStorage.setItem('rawstream_disable_fx', 'true');
                  addToast('Visual effects disabled (TV mode active)', 'info');
                } else {
                  localStorage.setItem('rawstream_disable_fx', 'false');
                  addToast('Visual effects enabled', 'info');
                }
              }}
              style={{
                cursor: 'pointer',
                width: '16px',
                height: '16px',
                accentColor: 'var(--accent-primary)'
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label htmlFor="settings-disable-fx" style={{ fontSize: '0.85rem', color: 'white', fontWeight: '500', cursor: 'pointer', margin: 0 }}>Disable Visual Effects (TV Mode)</label>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', lineHeight: '1.3' }}>
                Disables the ambient cinema glow and canvas waveform animations. Highly recommended for low-RAM devices and TV browsers.
              </span>
            </div>
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
        apiBaseUrl={apiBaseUrl}
        onBackendUrlChange={(val) => {
          setBackendUrlState(val);
          if (val) {
            localStorage.setItem('rawstream_backend_url', val);
          } else {
            localStorage.removeItem('rawstream_backend_url');
          }
        }}
        isOfflineMode={isOfflineMode}
        backendReachable={backendReachable}
        onToggleOfflineMode={(val) => {
          setIsOfflineMode(val);
          if (val) {
            localStorage.setItem('rawstream_offline_mode', 'true');
          } else {
            localStorage.removeItem('rawstream_offline_mode');
          }
        }}
      />
    </div>
  );
}
