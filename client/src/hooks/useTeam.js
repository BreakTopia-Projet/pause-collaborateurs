import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';

const API = '/api';

export function useTeam(getToken, onForceLogout) {
  const [rawTeam, setRawTeam] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState(null); // null = not yet loaded → show all
  const [connected, setConnected] = useState(false);
  const [pauseProlongeeMinutes, setPauseProlongeeMinutes] = useState(15);
  const [capacity, setCapacity] = useState({ breakCapacity: 2, onBreakNow: 0 });
  const [lastSyncAt, setLastSyncAt] = useState(null);

  // Keep a stable ref so the socket listener doesn't cause reconnects
  const forceLogoutRef = useRef(onForceLogout);
  forceLogoutRef.current = onForceLogout;

  /** Mark data as freshly received */
  const markSync = useCallback(() => setLastSyncAt(Date.now()), []);

  const fetchConfig = useCallback(() => {
    fetch(`${API}/config`)
      .then((r) => r.ok ? r.json() : {})
      .then((c) => {
        if (c.pauseProlongeeMinutes != null) setPauseProlongeeMinutes(c.pauseProlongeeMinutes);
        markSync();
      })
      .catch(() => {});
  }, [markSync]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const fetchTeam = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const res = await fetch(`${API}/status/team`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setRawTeam(data);
      markSync();
    }
  }, [getToken, markSync]);

  /** Fetch online user IDs from the presence endpoint */
  const fetchOnlineIds = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API}/presence/online`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOnlineUserIds(new Set(data.onlineUserIds));
      }
    } catch { /* ignore – will retry via socket */ }
  }, [getToken]);

  const fetchCapacity = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const res = await fetch(`${API}/config/team-capacity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.teams) {
        setCapacity(data);
      } else {
        setCapacity({
          breakCapacity: data.breakCapacity ?? 2,
          onBreakNow: data.onBreakNow ?? 0,
        });
      }
      markSync();
    }
  }, [getToken, markSync]);

  useEffect(() => {
    fetchTeam();
    fetchOnlineIds();
    fetchCapacity();
  }, [fetchTeam, fetchOnlineIds, fetchCapacity]);

  // Safety-net: periodic refresh every 30s even with sockets (covers missed events)
  useEffect(() => {
    const id = setInterval(() => {
      fetchTeam();
      fetchOnlineIds();
      fetchCapacity();
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchTeam, fetchOnlineIds, fetchCapacity]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token },
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('team', (data) => {
      setRawTeam(data);
      markSync();
    });
    // Live online presence updates (emitted every ~10s + on team changes)
    socket.on('onlinePresence', (data) => {
      if (data?.onlineUserIds) {
        setOnlineUserIds(new Set(data.onlineUserIds));
      }
    });
    // ── Instant presence events (complement TTL fallback) ──
    socket.on('presence:offline', (data) => {
      if (data?.userId != null) {
        setOnlineUserIds((prev) => {
          if (!prev) return prev;
          const next = new Set(prev);
          next.delete(data.userId);
          return next;
        });
      }
    });
    socket.on('presence:online', (data) => {
      if (data?.userId != null) {
        setOnlineUserIds((prev) => {
          if (!prev) return new Set([data.userId]);
          const next = new Set(prev);
          next.add(data.userId);
          return next;
        });
      }
    });
    socket.on('teamCapacity', (data) => {
      if (data.teams) {
        setCapacity(data);
      } else {
        setCapacity({
          breakCapacity: data.breakCapacity ?? 2,
          onBreakNow: data.onBreakNow ?? 0,
        });
      }
      markSync();
    });
    socket.on('configUpdated', (data) => {
      if (data.pauseProlongeeMinutes != null) {
        setPauseProlongeeMinutes(data.pauseProlongeeMinutes);
      }
      markSync();
    });
    // Server-side auto-logout detected — force client logout
    socket.on('forceLogout', () => {
      if (forceLogoutRef.current) forceLogoutRef.current();
    });
    return () => socket.disconnect();
  }, [getToken, markSync]);

  // ── Derived: all users with offline status merged from presence ──
  // If the DB already says 'offline', keep it.
  // If the DB says working/break but the user is NOT in onlineUserIds → override to 'offline'
  // (this handles the grace period window before performAutoLogout sets DB to offline)
  const team = useMemo(() => {
    return rawTeam.map((m) => {
      if (m.status === 'offline') return m; // DB already says offline
      if (onlineUserIds && !onlineUserIds.has(m.id)) {
        // User is not in online set — display as offline
        return { ...m, status: 'offline', elapsedSeconds: 0 };
      }
      return m;
    });
  }, [rawTeam, onlineUserIds]);

  const setStatus = useCallback(
    async (status) => {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API}/status/me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        const err = new Error(data.message || data.error || 'Erreur');
        err.code = data.error; // e.g. 'PAUSE_CAPACITY_FULL'
        throw err;
      }
      await fetchTeam();
      await fetchCapacity();
    },
    [getToken, fetchTeam, fetchCapacity]
  );

  return { team, setStatus, connected, pauseProlongeeMinutes, capacity, fetchCapacity, lastSyncAt };
}
