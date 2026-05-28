import React, { useEffect, useRef } from 'react';
import { Terminal, Trash2 } from 'lucide-react';

export default function DebugPanel({ show, logs, onClear }) {
  const containerRef = useRef(null);

  // Auto scroll debug logs to bottom when new logs arrive
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logs, show]);

  if (!show) return null;

  return (
    <section id="debug-card" className="instructions-card glass-panel" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', marginTop: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem', color: 'white' }}>
          <Terminal size={18} style={{ color: 'var(--accent-secondary)' }} />
          System Debug Logs
        </span>
        <button 
          id="clear-debug-btn" 
          className="clear-all-btn" 
          style={{ 
            fontSize: '0.75rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '4px',
            background: 'none',
            border: 'none',
            cursor: 'pointer'
          }} 
          onClick={onClear}
        >
          <Trash2 size={12} />
          Clear Logs
        </button>
      </h3>
      <div 
        ref={containerRef}
        id="debug-logs" 
        style={{ 
          fontFamily: 'var(--font-mono, monospace)', 
          fontSize: '0.75rem', 
          color: '#10b981', 
          maxHeight: '180px', 
          overflowY: 'auto', 
          background: 'rgba(0, 0, 0, 0.45)', 
          padding: '0.75rem 1rem', 
          borderRadius: '8px', 
          border: '1px solid rgba(255,255,255,0.05)', 
          lineHeight: '1.45', 
          wordBreak: 'break-all',
          whiteSpace: 'pre-wrap'
        }}
      >
        {logs}
      </div>
    </section>
  );
}
