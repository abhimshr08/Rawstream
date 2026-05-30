/**
 * useGoogleAuth — Google Identity Services OAuth2 token hook
 *
 * Requests a Google Drive read-only access_token using the implicit grant flow.
 * The token is stored in memory only (never persisted) and expires after 1 hour.
 * 
 * Usage:
 *   const { token, loading, error, requestToken, clearToken } = useGoogleAuth();
 */

import { useState, useRef, useCallback } from 'react';

// Read client ID from env (set VITE_GOOGLE_CLIENT_ID in .env / Render env vars)
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Drive read-only scope — enough to download files the user has access to
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export function useGoogleAuth() {
  const [token, setToken] = useState(null);       // active access_token string
  const [expiry, setExpiry] = useState(0);         // token expiry timestamp (ms)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const tokenClientRef = useRef(null);

  // Returns true if we have a valid non-expired token
  const isValid = token && Date.now() < expiry;

  const requestToken = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (isValid) {
        resolve(token);
        return;
      }

      if (!CLIENT_ID) {
        const msg = 'Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID env variable.';
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

      // Initialize or reuse the token client
      if (!tokenClientRef.current) {
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
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
            // expires_in is typically 3600 seconds; subtract 60s buffer
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

      // Prompt user to select account / grant permission
      tokenClientRef.current.requestAccessToken({ prompt: '' });
    });
  }, [token, isValid]);

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
    requestToken,
    clearToken
  };
}
