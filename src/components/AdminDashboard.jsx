import React, { useState, useEffect, useRef } from 'react';
import { X, HardDrive, Users, Activity, Trash2, ShieldAlert } from 'lucide-react';

export default function AdminDashboard({
  open,
  onClose,
  authenticatedFetch,
  addToast
}) {
  const dialogRef = useRef(null);
  const [activeTab, setActiveTab] = useState('status'); // 'status' | 'users' | 'torrents'
  const [statusData, setStatusData] = useState(null);
  const [usersList, setUsersList] = useState([]);
  const [torrentsList, setTorrentsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollIntervalRef = useRef(null);

  // Sync HTML5 dialog element with open prop
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      loadTabData(activeTab);
      // If status tab is open, poll it
      if (activeTab === 'status') {
        startPolling();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
      stopPolling();
    }

    return () => stopPolling();
  }, [open, activeTab]);

  const startPolling = () => {
    stopPolling();
    pollIntervalRef.current = setInterval(() => {
      fetchStatus();
    }, 3000);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const loadTabData = async (tab) => {
    setLoading(true);
    if (tab === 'status') {
      await fetchStatus();
      startPolling();
    } else {
      stopPolling();
      if (tab === 'users') {
        await fetchUsers();
      } else if (tab === 'torrents') {
        await fetchTorrents();
      }
    }
    setLoading(false);
  };

  const fetchStatus = async () => {
    try {
      const res = await authenticatedFetch('/api/admin/status');
      if (res.ok) {
        const data = await res.json();
        setStatusData(data);
      }
    } catch (e) {
      console.error('Failed to load admin status:', e);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await authenticatedFetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsersList(data);
      }
    } catch (e) {
      console.error('Failed to load admin users:', e);
    }
  };

  const fetchTorrents = async () => {
    try {
      const res = await authenticatedFetch('/api/admin/torrents');
      if (res.ok) {
        const data = await res.json();
        setTorrentsList(data);
      }
    } catch (e) {
      console.error('Failed to load admin torrents:', e);
    }
  };

  const handleDeleteUser = async (username) => {
    if (window.confirm(`Are you sure you want to delete user "${username}" and all their history?`)) {
      try {
        const res = await authenticatedFetch(`/api/admin/users/${encodeURIComponent(username)}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          addToast(`User ${username} deleted`, 'success');
          fetchUsers();
        } else {
          const data = await res.json();
          addToast(data.error || 'Failed to delete user', 'error');
        }
      } catch (err) {
        addToast('Error communicating with server', 'error');
      }
    }
  };

  const handlePurgeTorrent = async (infoHash) => {
    if (window.confirm(`Are you sure you want to purge torrent stream cache for ${infoHash}?`)) {
      try {
        const res = await authenticatedFetch(`/api/admin/torrents/${infoHash}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          addToast('Torrent cache purged successfully', 'success');
          fetchTorrents();
        } else {
          const data = await res.json();
          addToast(data.error || 'Failed to purge torrent', 'error');
        }
      } catch (err) {
        addToast('Error communicating with server', 'error');
      }
    }
  };

  const formatUptime = (seconds) => {
    if (!seconds) return '0h 0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  // Helper values for status rendering
  const heapUsedMB = statusData ? (statusData.system.nodeMem.heapUsed / 1024 / 1024).toFixed(1) : '0';
  const rssMB = statusData ? (statusData.system.nodeMem.rss / 1024 / 1024).toFixed(1) : '0';
  const load = statusData && statusData.system.loadAvg && statusData.system.loadAvg[0]
    ? statusData.system.loadAvg[0].toFixed(2)
    : '0.00';
  const totalMemGB = statusData ? (statusData.system.totalMem / 1024 / 1024 / 1024).toFixed(1) : '0';
  const freeMemGB = statusData ? (statusData.system.freeMem / 1024 / 1024 / 1024).toFixed(1) : '0';
  const usedMemGB = statusData ? (parseFloat(totalMemGB) - parseFloat(freeMemGB)).toFixed(1) : '0';
  const ramPercent = statusData ? Math.min(100, Math.max(0, (usedMemGB / totalMemGB) * 100)) : 0;
  const loadPercent = statusData ? Math.min(100, Math.max(0, parseFloat(load) * 20)) : 0; // scale load up to 5 load average base

  return (
    <dialog 
      ref={dialogRef} 
      id="admin-dialog" 
      className="glass-dialog admin-dialog"
      onClose={() => {
        stopPolling();
        onClose();
      }}
    >
      <div className="dialog-header" style={{ padding: '1.25rem 1.5rem' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <HardDrive size={18} style={{ color: 'var(--accent-secondary)' }} />
          Admin Control Center
        </h3>
        <button 
          className="close-dialog-btn" 
          aria-label="Close dashboard"
          onClick={() => {
            if (dialogRef.current) dialogRef.current.close();
          }}
          style={{ background: 'none', border: 'none', color: 'var(--text-dimmed)', cursor: 'pointer' }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Tabs list */}
      <div className="admin-tabs">
        <button 
          className={`admin-tab-btn ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          <Activity size={14} className="tab-icon" />
          Status
        </button>
        <button 
          className={`admin-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <Users size={14} className="tab-icon" />
          Users
        </button>
        <button 
          className={`admin-tab-btn ${activeTab === 'torrents' ? 'active' : ''}`}
          onClick={() => setActiveTab('torrents')}
        >
          <HardDrive size={14} className="tab-icon" />
          Torrent Streams
        </button>
      </div>

      <div className="dialog-body admin-dialog-body">
        {/* Tab 1: Status Details */}
        {activeTab === 'status' && statusData && (
          <div className="admin-tab-content active">
            <div className="performance-grid">
              <div className="metric-card">
                <span className="metric-title">Active Users</span>
                <span className="metric-value">{statusData.activeUsers}</span>
                <span className="metric-sub">Connected sessions</span>
              </div>
              <div className="metric-card">
                <span className="metric-title">Active Torrents</span>
                <span className="metric-value">{statusData.activeTorrents}</span>
                <span className="metric-sub">Cached download tracks</span>
              </div>
              <div className="metric-card" style={{ minWidth: '170px' }}>
                <span className="metric-title">Memory Allocation</span>
                <span className="metric-value">{heapUsedMB} MB</span>
                <span className="metric-sub">RSS: {rssMB} MB</span>
              </div>
              <div className="metric-card">
                <span className="metric-title">System Load</span>
                <span className="metric-value">{load}</span>
                <div className="stats-meter-container">
                  <div className="stats-meter-fill" style={{ width: `${loadPercent}%` }} />
                </div>
                <span className="metric-sub" style={{ marginTop: '4px' }}>Load average</span>
              </div>
            </div>

            <div className="sys-info-section">
              <h4>Platform Diagnostics</h4>
              <div className="sys-info-grid">
                <div>Host OS: <span>{statusData.system.platform} {statusData.system.release}</span></div>
                <div>Server Ram: <span>{usedMemGB} GB / {totalMemGB} GB ({ramPercent.toFixed(0)}%)</span></div>
                <div>Node Process Uptime: <span>{formatUptime(statusData.system.nodeUptime)}</span></div>
                <div>Host Uptime: <span>{formatUptime(statusData.system.uptime)}</span></div>
              </div>
              <div className="stats-meter-container" style={{ marginTop: '12px' }}>
                <div className="stats-meter-fill" style={{ width: `${ramPercent}%`, background: 'linear-gradient(90deg, #10b981, #06b6d4)' }} />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Users List */}
        {activeTab === 'users' && (
          <div className="admin-tab-content active">
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Created At</th>
                    <th>History</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.length > 0 ? (
                    usersList.map((u) => {
                      const isSelf = u.username.toLowerCase() === localStorage.getItem('rawstream_session_username')?.toLowerCase();
                      const formattedDate = new Date(u.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      });

                      return (
                        <tr key={u.username}>
                          <td style={{ fontWeight: 500, color: 'white' }}>{u.username}</td>
                          <td>
                            {u.isAdmin ? (
                              <span style={{ color: 'var(--accent-secondary)', fontWeight: 600 }}>Admin</span>
                            ) : (
                              <span>User</span>
                            )}
                          </td>
                          <td>{formattedDate}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{u.historyCount}</td>
                          <td>
                            <button
                              className="admin-action-btn"
                              disabled={isSelf}
                              onClick={() => handleDeleteUser(u.username)}
                              style={{
                                cursor: isSelf ? 'not-allowed' : 'pointer',
                                opacity: isSelf ? 0.4 : 1,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <Trash2 size={12} />
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dimmed)' }}>
                        No users registered.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Torrents List */}
        {activeTab === 'torrents' && (
          <div className="admin-tab-content active">
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Torrent Title</th>
                    <th>Size</th>
                    <th>Progress</th>
                    <th>Speeds</th>
                    <th>Peers</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {torrentsList.length > 0 ? (
                    torrentsList.map((t) => {
                      const sizeGB = (t.length / 1024 / 1024 / 1024).toFixed(2);
                      const progressPct = (t.progress * 100).toFixed(1);
                      const downSpeedMB = (t.downloadSpeed / 1024 / 1024).toFixed(2);
                      const upSpeedMB = (t.uploadSpeed / 1024 / 1024).toFixed(2);

                      return (
                        <tr key={t.infoHash}>
                          <td 
                            style={{ 
                              fontWeight: 500, 
                              color: 'white', 
                              maxWidth: '220px', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              whiteSpace: 'nowrap' 
                            }} 
                            title={t.name || t.infoHash}
                          >
                            {t.name || 'Unnamed Torrent'}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{sizeGB} GB</td>
                          <td>
                            <div style={{ display: 'flex', alignPosition: 'center', gap: '0.5rem', alignItems: 'center' }}>
                              <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', minWidth: '60px', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ width: `${progressPct}%`, height: '100%', background: 'var(--accent-primary)' }} />
                              </div>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{progressPct}%</span>
                            </div>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                            ↓{downSpeedMB} MB/s | ↑{upSpeedMB} MB/s
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{t.numPeers}</td>
                          <td>
                            <button
                              className="admin-action-btn"
                              onClick={() => handlePurgeTorrent(t.infoHash)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <ShieldAlert size={12} />
                              Purge
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dimmed)' }}>
                        No active torrent streams in cache.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
