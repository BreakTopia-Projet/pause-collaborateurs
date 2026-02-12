import { useEffect, useCallback, useRef } from 'react';

const API = '/api';
const HEARTBEAT_INTERVAL_MS = 5_000; // ping every 5 seconds

/**
 * usePresence – Presence heartbeat & leave signaling.
 *
 * - On mount: sends an immediate ping (cancels any pending leave from a refresh).
 * - Every 5 s: sends a heartbeat ping to keep the session alive.
 * - On `pagehide` (tab close / browser close / navigation away):
 *     sends a leave signal via `fetch` with `keepalive`.
 * - On `visibilitychange` → visible: sends an immediate ping
 *     (safety net in case the heartbeat was delayed in a background tab).
 *
 * The backend uses a 30 s grace period: if no ping arrives after a leave signal,
 * it performs a real auto-logout (closes break, invalidates token, audit log).
 *
 * @param {() => string|null} getToken - Returns the current JWT token
 * @param {() => void} onForceLogout - Called when a 401 is detected during ping
 */
export function usePresence(getToken, onForceLogout) {
  const intervalRef = useRef(null);
  const onForceLogoutRef = useRef(onForceLogout);
  onForceLogoutRef.current = onForceLogout;

  const sendPing = useCallback(() => {
    const token = getToken();
    if (!token) return;
    fetch(`${API}/presence/ping`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        // If the server rejects the token (auto-logout happened) or account is not approved, force client logout
        if ((res.status === 401 || res.status === 403) && onForceLogoutRef.current) {
          onForceLogoutRef.current();
        }
      })
      .catch(() => {});
  }, [getToken]);

  const sendLeave = useCallback(() => {
    const token = getToken();
    if (!token) return;

    // Primary: fetch with keepalive (works during pagehide, supports headers)
    try {
      fetch(`${API}/presence/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: '{}',
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Fallback: navigator.sendBeacon with token in body
      try {
        const blob = new Blob(
          [JSON.stringify({ token })],
          { type: 'application/json' },
        );
        navigator.sendBeacon(`${API}/presence/leave`, blob);
      } catch { /* best effort */ }
    }
  }, [getToken]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    // Immediate ping on mount — cancels any pending leave from a refresh
    sendPing();

    // Start periodic heartbeat
    intervalRef.current = setInterval(sendPing, HEARTBEAT_INTERVAL_MS);

    // ── Page lifecycle events ──

    const handlePageHide = () => {
      sendLeave();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible again — send an immediate ping to cancel any pending leave
        sendPing();
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalRef.current);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [getToken, sendPing, sendLeave]);
}
