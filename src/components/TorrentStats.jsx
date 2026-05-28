import React from 'react';

export default function TorrentStats({ stats }) {
  if (!stats) return null;

  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0 || isNaN(bytes)) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const progressPercent = stats.progress !== undefined 
    ? (stats.progress * 100).toFixed(1) 
    : '0.0';

  return (
    <div id="torrent-stats-card" className="torrent-stats-card glass-panel" style={{ marginTop: '1.25rem' }}>
      <div className="stats-header">
        <span className="status-indicator live"></span>
        <h4>Torrent Streaming Active</h4>
      </div>
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-label">File Name</span>
          <span id="torrent-name" className="stat-value truncate" title={stats.name || 'Torrent file'}>
            {stats.name || 'Awaiting file metadata...'}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Download Speed</span>
          <span id="torrent-speed" className="stat-value">
            {formatBytes(stats.speed || 0)}/s
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Active Peers</span>
          <span id="torrent-peers" className="stat-value">
            {stats.peers !== undefined ? `${stats.peers} peers` : '0 peers'}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Progress</span>
          <span id="torrent-progress" className="stat-value">
            {progressPercent}%
          </span>
        </div>
      </div>
    </div>
  );
}
