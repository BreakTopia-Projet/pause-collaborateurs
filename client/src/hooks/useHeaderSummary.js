import { useState, useEffect, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';

const API = '/api';

/**
 * Lightweight hook for the global Header summary pill.
 *
 * Returns:
 *  - onBreak / working / total   — live team summary counts (online users only)
 *  - capacityWarning             — true if any team is at/over capacity
 *
 * A single socket is created; no extra network calls beyond the initial fetch.
 * Counts are computed only from **online** users (filtered by onlinePresence).
 */
export function useHeaderSummary(getToken, userRole) {
  const [rawMembers, setRawMembers] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState(null); // null = not yet loaded
  const [capacity, setCapacity] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Initial fetch
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    fetch(`${API}/status/team`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (Array.isArray(data)) setRawMembers(data); })
      .catch(() => {});

    fetch(`${API}/presence/online`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.onlineUserIds) setOnlineUserIds(new Set(d.onlineUserIds)); })
      .catch(() => {});

    fetch(`${API}/config/team-capacity`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCapacity(d))
      .catch(() => {});

    // Fetch initial pending approvals count (superadmin only)
    if (userRole === 'superadmin') {
      fetch(`${API}/admin/approvals/count`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.count != null) setPendingCount(d.count); })
        .catch(() => {});
    }
  }, [getToken, userRole]);

  // Socket subscription
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token },
    });

    socket.on('team', (data) => {
      if (Array.isArray(data)) setRawMembers(data);
    });
    socket.on('onlinePresence', (data) => {
      if (data?.onlineUserIds) setOnlineUserIds(new Set(data.onlineUserIds));
    });
    // Instant presence events (complement TTL fallback)
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
    socket.on('teamCapacity', (data) => setCapacity(data));

    // Pending approvals count (superadmin only)
    socket.on('pendingApprovals', (data) => {
      if (data?.count != null) setPendingCount(data.count);
    });

    return () => socket.disconnect();
  }, [getToken]);

  // Merge presence info: users not in onlineUserIds are treated as offline
  const merged = useMemo(() => {
    return rawMembers.map((m) => {
      if (m.status === 'offline') return m;
      if (onlineUserIds && !onlineUserIds.has(m.id)) {
        return { ...m, status: 'offline' };
      }
      return m;
    });
  }, [rawMembers, onlineUserIds]);

  // Derive counts — exclude offline users
  const online = merged.filter((m) => m.status !== 'offline');
  const total = online.length;
  const working = online.filter((m) => !m.status || m.status === 'working').length;
  const onBreak = total - working;

  // Derive capacity warning
  let capacityWarning = false;
  if (capacity) {
    if (capacity.teams) {
      capacityWarning = capacity.teams.some(
        (ct) => ct.onBreakNow >= ct.breakCapacity
      );
    } else {
      capacityWarning =
        (capacity.onBreakNow ?? 0) >= (capacity.breakCapacity ?? 2);
    }
  }

  return { onBreak, working, total, capacityWarning, pendingCount };
}
