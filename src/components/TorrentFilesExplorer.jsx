import React from 'react';
import { Play, Download, Video, FileText, Check } from 'lucide-react';

export default function TorrentFilesExplorer({ torrentInfo, onPlayFile, currentVideo }) {
  if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length <= 1) return null;

  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0 || isNaN(bytes)) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const isPlayableVideo = (filename) => {
    const name = filename.toLowerCase();
    return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') ||
           name.endsWith('.avi') || name.endsWith('.mov') || name.endsWith('.ogv') ||
           name.endsWith('.m4v') || name.endsWith('.ts');
  };

  const getDownloadUrl = (fileIndex) => {
    return `/api/torrent/stream?infoHash=${encodeURIComponent(torrentInfo.infoHash)}&fileIndex=${fileIndex}`;
  };

  return (
    <div className="torrent-files-card glass-panel" style={{ marginTop: '1.25rem' }}>
      <div className="stats-header" style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.75rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '600', color: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Video size={16} style={{ color: 'var(--accent-primary)' }} />
          Files in Torrent ({torrentInfo.files.length})
        </h4>
      </div>
      <div className="files-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.25rem' }}>
        {torrentInfo.files.map((file) => {
          const playable = isPlayableVideo(file.name);
          const isCurrentlyPlaying = currentVideo && currentVideo.title === file.name;
          
          return (
            <div 
              key={file.index} 
              className={`file-row ${isCurrentlyPlaying ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                background: isCurrentlyPlaying ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255,255,255,0.02)',
                border: isCurrentlyPlaying ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(255,255,255,0.05)',
                transition: 'all 0.2s',
                gap: '1rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
                {playable ? (
                  <Video size={14} style={{ color: isCurrentlyPlaying ? 'var(--accent-primary)' : 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
                ) : (
                  <FileText size={14} style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
                )}
                <span 
                  className="file-name text-xs" 
                  style={{
                    color: isCurrentlyPlaying ? 'white' : 'rgba(255,255,255,0.85)',
                    fontWeight: isCurrentlyPlaying ? '600' : '400',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={file.name}
                >
                  {file.name}
                </span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexShrink: 0 }}>
                <span className="file-size text-xs" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
                  {formatBytes(file.length)}
                </span>
                
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {playable && (
                    <button
                      type="button"
                      disabled={isCurrentlyPlaying}
                      onClick={() => onPlayFile(torrentInfo, file)}
                      className={`btn-action stream ${isCurrentlyPlaying ? 'active' : ''}`}
                      title={isCurrentlyPlaying ? 'Currently playing' : 'Stream this video'}
                      style={{
                        padding: '0.3rem 0.6rem',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        borderRadius: '6px',
                        background: isCurrentlyPlaying ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.06)',
                        color: isCurrentlyPlaying ? 'var(--accent-primary)' : 'white',
                        border: 'none',
                        cursor: isCurrentlyPlaying ? 'default' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        transition: 'all 0.2s'
                      }}
                    >
                      {isCurrentlyPlaying ? <Check size={10} /> : <Play size={10} fill="currentColor" />}
                      <span>Stream</span>
                    </button>
                  )}
                  
                  <a
                    href={getDownloadUrl(file.index)}
                    download={file.name}
                    className="btn-action download"
                    title="Download file directly"
                    style={{
                      padding: '0.3rem 0.6rem',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      borderRadius: '6px',
                      background: 'rgba(255,255,255,0.06)',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      textDecoration: 'none',
                      transition: 'all 0.2s'
                    }}
                  >
                    <Download size={10} />
                    <span>DDL</span>
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
