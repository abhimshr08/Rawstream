import React, { useState, useEffect } from 'react';
import { User, Lock, Key, CheckCircle, AlertTriangle } from 'lucide-react';
import { mockLogin, mockRegister } from '../utils/mockBackend';

export default function AuthOverlay({
  show,
  onSuccess,
  apiBaseUrl = '',
  isOfflineMode = false,
  backendReachable = null,
  onToggleOfflineMode
}) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!show) return null;

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);

    if (isOfflineMode) {
      try {
        const data = await mockLogin(username, password);
        if (data.success) {
          onSuccess(data.username, data.token, !!data.isAdmin);
        } else {
          setError(data.error || 'Login failed');
        }
      } catch (err) {
        setError('Login processing failed');
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onSuccess(data.username, data.token, !!data.isAdmin);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login fetch failed:', err);
      setError(`Failed to connect to the backend server at ${apiBaseUrl || 'relative host'}. Please verify your server is running, or enable Offline Demo Mode.`);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    if (isOfflineMode) {
      try {
        const data = await mockRegister(username, password);
        if (data.success) {
          onSuccess(data.username, data.token, !!data.isAdmin);
        } else {
          setError(data.error || 'Registration failed');
        }
      } catch (err) {
        setError('Registration processing failed');
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onSuccess(data.username, data.token, !!data.isAdmin);
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch (err) {
      console.error('Register fetch failed:', err);
      setError(`Failed to connect to the backend server at ${apiBaseUrl || 'relative host'}. Please verify your server is running, or enable Offline Demo Mode.`);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchMode = () => {
    setIsRegister(!isRegister);
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setError('');
  };

  return (
    <div className={`auth-overlay ${show ? '' : 'hidden'}`}>
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            <polygon points="10 11 16 14 10 17 10 11"></polygon>
          </svg>
          <h2>Raw<span>Stream</span></h2>
          <p id="auth-subtitle">{isRegister ? 'Create a secure streaming profile' : 'Sign in to access your media library'}</p>
        </div>

        {backendReachable === false && !isOfflineMode && (
          <div style={{
            marginBottom: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444',
            padding: '0.75rem',
            borderRadius: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600', fontSize: '0.85rem' }}>
              <AlertTriangle size={16} />
              <span>Backend Server Offline</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', lineHeight: '1.4' }}>
              We could not establish a connection to the Express backend.
            </p>
            {onToggleOfflineMode && (
              <button
                type="button"
                onClick={() => onToggleOfflineMode(true)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  fontWeight: '500',
                  alignSelf: 'flex-start',
                  marginTop: '4px'
                }}
              >
                Use Offline Demo Mode
              </button>
            )}
          </div>
        )}

        {isOfflineMode && (
          <div style={{
            marginBottom: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            color: '#f59e0b',
            padding: '0.75rem',
            borderRadius: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600', fontSize: '0.85rem' }}>
              <AlertTriangle size={16} />
              <span>Offline Demo Mode Active</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', lineHeight: '1.4' }}>
              Using mock local storage database. To connect to your server, disable offline mode.
            </p>
            {onToggleOfflineMode && (
              <button
                type="button"
                onClick={() => onToggleOfflineMode(false)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  fontWeight: '500',
                  alignSelf: 'flex-start',
                  marginTop: '4px'
                }}
              >
                Try Reconnecting
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="auth-error-message" style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {!isRegister ? (
          <form id="login-form" className="auth-form" onSubmit={handleLoginSubmit}>
            <div className="auth-input-group">
              <label htmlFor="login-username">Username</label>
              <div className="auth-input-wrapper">
                <span className="auth-input-icon">
                  <User size={16} />
                </span>
                <input 
                  type="text" 
                  id="login-username" 
                  placeholder="Enter username" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required 
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="auth-input-group">
              <label htmlFor="login-password">Password</label>
              <div className="auth-input-wrapper">
                <span className="auth-input-icon">
                  <Lock size={16} />
                </span>
                <input 
                  type="password" 
                  id="login-password" 
                  placeholder="Enter password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading && <span className="auth-spinner" style={{ marginRight: '6px' }} />}
              <span>{loading ? 'Signing in...' : 'Sign In'}</span>
            </button>
          </form>
        ) : (
          <form id="register-form" className="auth-form" onSubmit={handleRegisterSubmit}>
            <div className="auth-input-group">
              <label htmlFor="register-username">Username</label>
              <div className="auth-input-wrapper">
                <span className="auth-input-icon">
                  <User size={16} />
                </span>
                <input 
                  type="text" 
                  id="register-username" 
                  placeholder="Create username" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required 
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="auth-input-group">
              <label htmlFor="register-password">Password</label>
              <div className="auth-input-wrapper">
                <span className="auth-input-icon">
                  <Lock size={16} />
                </span>
                <input 
                  type="password" 
                  id="register-password" 
                  placeholder="Create password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="auth-input-group">
              <label htmlFor="register-confirm-password">Confirm Password</label>
              <div className="auth-input-wrapper">
                <span className="auth-input-icon">
                  <Key size={16} />
                </span>
                <input 
                  type="password" 
                  id="register-confirm-password" 
                  placeholder="Confirm password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required 
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading && <span className="auth-spinner" style={{ marginRight: '6px' }} />}
              <span>{loading ? 'Creating Account...' : 'Register & Start'}</span>
            </button>
          </form>
        )}

        <div className="auth-switch-prompt">
          <span>{isRegister ? 'Already have an account?' : "Don't have an account yet?"}</span>
          <button 
            type="button" 
            className="auth-switch-btn" 
            onClick={handleSwitchMode}
          >
            {isRegister ? 'Sign In' : 'Register'}
          </button>
        </div>

      </div>
    </div>
  );
}
