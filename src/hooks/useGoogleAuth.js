/**
 * useGoogleAuth — Google Identity Services OAuth2 token hook
 *
 * Fetches the Google Client ID from /api/config at runtime (not build-time),
 * which works correctly in Docker deployments where VITE_* env vars are
 * injected by Render after the build step has already completed.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// Drive read-only scope — enough to download files the user has access to
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export function useGoogleAuth(apiBaseUrl = '') {
  const [clientId, setClientId] = useState('');
  const [token, setToken] = useState(null);
  const [expiry, setExpiry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const tokenClientRef = useRef(null);

  // Load client ID from localStorage, environment, or backend config endpoint at runtime
  useEffect(() => {
    const localId = localStorage.getItem('rawstream_google_client_id');
    if (localId) {
      setClientId(localId);
      return;
    }

    const envId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (envId) {
      setClientId(envId);
      return;
    }

    // Fallback: Fetch from backend /api/config
    fetch(`${apiBaseUrl}/api/config`)
      .then(res => res.json())
      .then(data => {
        if (data.googleClientId) {
          setClientId(data.googleClientId);
        }
      })
      .catch(err => console.error('Failed to fetch runtime client ID:', err));
  }, []);

  // Returns true if we have a valid non-expired token
  const isValid = !!(token && Date.now() < expiry);

  const requestToken = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (isValid) {
        resolve(token);
        return;
      }

      if (!clientId) {
        const msg = 'Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID in Render environment.';
        setError(msg);
        reject(new Error(msg));
        return;
      }

      if (!window.google?.accounts?.oauth2) {
        const msg = 'Google Identity Services not loaded. Check network connection.';
        setError(msg);
        reject(new Error(msg));
        return;
      }

      setLoading(true);
      setError(null);

      // Re-create token client if clientId changed or first use
      if (!tokenClientRef.current) {
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (response) => {
            setLoading(false);
            if (response.error) {
              const msg = response.error_description || response.error || 'OAuth failed';
              setError(msg);
              reject(new Error(msg));
              return;
            }
            const accessToken = response.access_token;
            // expires_in is typically 3600s; subtract 60s buffer
            const expiresAt = Date.now() + ((response.expires_in || 3600) - 60) * 1000;
            setToken(accessToken);
            setExpiry(expiresAt);
            setError(null);
            resolve(accessToken);
          },
          error_callback: (err) => {
            setLoading(false);
            const msg = err?.message || 'Sign-in was cancelled or blocked';
            setError(msg);
            reject(new Error(msg));
          }
        });
      }

      tokenClientRef.current.requestAccessToken({ prompt: '' });
    });
  }, [token, isValid, clientId]);

  const clearToken = useCallback(() => {
    if (token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token, () => {});
    }
    setToken(null);
    setExpiry(0);
    setError(null);
    tokenClientRef.current = null;
  }, [token]);

  return {
    token: isValid ? token : null,
    loading,
    error,
    isValid,
    clientId,
    setClientId: (id) => {
      setClientId(id);
      if (id) {
        localStorage.setItem('rawstream_google_client_id', id);
      } else {
        localStorage.removeItem('rawstream_google_client_id');
      }
      tokenClientRef.current = null; // force recreation of token client
    },
    isConfigured: !!clientId,  // lets UI know if button should appear
    requestToken,
    clearToken
  };
}
