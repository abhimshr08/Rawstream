import React, { useState } from 'react';
import { Edit2, Trash2, Save, X, Calendar, Database } from 'lucide-react';

export default function HistorySidebar({
  show,
  list,
  currentVideo,
  onLoadStream,
  onRename,
  onDelete,
  onClearAll
}) {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  const handleEditClick = (e, item) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditTitle(item.title);
  };

  const handleCancelEdit = (e) => {
    e.stopPropagation();
    setEditingId(null);
    setEditTitle('');
  };

  const handleSaveEdit = async (e, id) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      await onRename(id, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle('');
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };

  return (
    <aside id="history-sidebar" className={`history-sidebar glass-panel ${show ? '' : 'collapsed'}`}>
      <div className="sidebar-header">
        <h2>Stream History</h2>
        {list.length > 0 && (
          <button id="clear-history-btn" className="clear-all-btn" title="Clear all history" onClick={onClearAll}>
            Clear All
          </button>
        )}
      </div>
      
      <div className="sidebar-content">
        {list.length > 0 ? (
          <ul id="history-list" className="history-list">
            {list.map((item) => {
              const isActive = currentVideo && currentVideo.id === item.id;
              const isEditing = editingId === item.id;

              return (
                <li 
                  key={item.id} 
                  className={`history-item ${isActive ? 'active' : ''}`}
                  tabIndex={0}
                  onClick={() => !isEditing && onLoadStream(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (!isEditing) onLoadStream(item);
                    }
                  }}
                >
                  <div className="item-meta">
                    <span className={`item-service ${item.service || 'unknown'}`}>
                      {item.service === 'google' ? 'Google Drive' : item.service === 'onedrive' ? 'OneDrive' : item.service === 'torrent' ? 'BitTorrent' : 'Local'}
                    </span>
                    <span className="item-date">
                      <Calendar size={10} style={{ marginRight: '3px', display: 'inline' }} />
                      {formatDate(item.timestamp || item.createdAt)}
                    </span>
                  </div>

                  {!isEditing ? (
                    <div className="item-title-wrapper">
                      <span className="item-title" id={`title-text-${item.id}`}>
                        {item.title}
                      </span>
                      <div className="item-actions">
                        <button 
                          className="item-action-btn edit" 
                          title="Rename stream"
                          onClick={(e) => handleEditClick(e, item)}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button 
                          className="item-action-btn delete" 
                          title="Remove"
                          onClick={(e) => onDelete(item.id, e)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="edit-title-form" onClick={(e) => e.stopPropagation()}>
                      <input 
                        type="text" 
                        className="edit-title-input" 
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(e, item.id);
                          if (e.key === 'Escape') handleCancelEdit(e);
                        }}
                      />
                      <button 
                        className="action-btn save" 
                        style={{
                          background: 'var(--accent-primary)',
                          border: 'none',
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px'
                        }}
                        onClick={(e) => handleSaveEdit(e, item.id)}
                      >
                        <Save size={10} />
                        Save
                      </button>
                      <button 
                        className="action-btn cancel" 
                        style={{
                          background: 'rgba(255,255,255,0.1)',
                          border: 'none',
                          color: 'var(--text-muted)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                        onClick={handleCancelEdit}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div id="history-empty" className="history-empty">
            <Database size={40} style={{ color: 'var(--text-dimmed)', marginBottom: '1rem' }} />
            <p>No recently streamed files.</p>
            <span>Your playback history will appear here.</span>
          </div>
        )}
      </div>
    </aside>
  );
}
