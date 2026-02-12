import db from './db.js';
import { setUserStatus } from './status.js';
import { logAudit } from './auditLog.js';
import { notifyTeamUpdate } from './socketEmitter.js';

const GRACE_PERIOD_MS = 30_000; // 30 seconds before real logout
const CHECK_INTERVAL_MS = 10_000; // background check every 10s
export const PRESENCE_ONLINE_TTL_MS = 45_000; // 45s — user considered "online" if seen within this window

/**
 * In-memory presence store.
 * Map<userId, { lastSeenAt: number, pendingLogout: boolean }>
 *
 * – `ping()` refreshes lastSeenAt and cancels any pending logout.
 * – `leave()` marks the user as potentially leaving.
 * – The background checker performs the real logout only if the user
 *   has NOT pinged again within the grace period.
 */
const presenceMap = new Map();

/** Reference to Socket.IO server (set once via startPresenceChecker). */
let ioRef = null;

/* ─── Internal helpers for instant presence events ──── */

/**
 * Count active Socket.IO connections for a given user.
 * Used to decide whether to emit presence:offline (multi-tab safe).
 */
function countUserSockets(userId) {
  if (!ioRef) return 0;
  let count = 0;
  for (const [, socket] of ioRef.sockets.sockets) {
    if (socket.userId === userId) count++;
  }
  return count;
}

/** Look up the user's team_id (needed to emit to the right room). */
function getUserTeamId(userId) {
  const row = db.prepare('SELECT team_id FROM users WHERE id = ?').get(userId);
  return row?.team_id ?? null;
}

/**
 * Emit presence:offline to all relevant rooms.
 * @param {number} userId
 * @param {string} reason – "leave" | "auto_logout"
 */
function emitPresenceOffline(userId, reason) {
  if (!ioRef) return;
  const teamId = getUserTeamId(userId);
  const payload = { userId, teamId, reason };
  if (teamId) ioRef.to(`team:${teamId}`).emit('presence:offline', payload);
  ioRef.to('superadmin').emit('presence:offline', payload);
}

/**
 * Emit presence:online to all relevant rooms.
 * @param {number} userId
 */
function emitPresenceOnline(userId) {
  if (!ioRef) return;
  const teamId = getUserTeamId(userId);
  const payload = { userId, teamId };
  if (teamId) ioRef.to(`team:${teamId}`).emit('presence:online', payload);
  ioRef.to('superadmin').emit('presence:online', payload);
}

/* ─── Public helpers ────────────────────────────────── */

/**
 * Called periodically by the client (heartbeat).
 * Keeps the session alive and cancels any pending logout.
 * If the user was previously pendingLogout, emit presence:online so
 * dashboards restore the user instantly (e.g. after a fast refresh).
 */
export function ping(userId) {
  const existing = presenceMap.get(userId);
  const wasPending = existing?.pendingLogout === true;
  const wasAbsent = !existing;

  const now = Date.now();
  presenceMap.set(userId, {
    lastSeenAt: now,
    pendingLogout: false,
  });

  // Persist last_seen_at in DB (for offline-since display)
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date(now).toISOString(), userId);

  // User is (back) online — restore status if they were offline in DB
  if (wasPending || wasAbsent) {
    const statusRow = db.prepare('SELECT status FROM status WHERE user_id = ?').get(userId);
    if (!statusRow || statusRow.status === 'offline') {
      setUserStatus(userId, 'working');
      notifyTeamUpdate();
    }
    emitPresenceOnline(userId);
  }
}

/**
 * Called when the client *might* be leaving (pagehide / visibilitychange hidden).
 * Sets a pending logout flag; actual logout only happens after the grace period
 * if no further ping is received.
 *
 * NOTE: We do NOT emit presence:offline here because the socket from the
 * departing tab is still alive. The socket 'disconnect' handler
 * (handleSocketDisconnect) checks socket count and emits if appropriate.
 */
export function leave(userId) {
  const existing = presenceMap.get(userId);
  if (existing) {
    existing.pendingLogout = true;
    // Don't update lastSeenAt — we want the grace period to start from the
    // last actual ping, not from the leave signal.
  } else {
    presenceMap.set(userId, {
      lastSeenAt: Date.now(),
      pendingLogout: true,
    });
  }
}

/**
 * Called from the Socket.IO disconnect handler in index.js.
 * When a socket disconnects, check if the user has zero remaining sockets
 * AND a pendingLogout flag → emit presence:offline immediately.
 *
 * This is the key mechanism for instant disappearance on tab close:
 *  1. pagehide fires → POST /leave → pendingLogout = true
 *  2. Page unloads → socket disconnects → this function runs
 *  3. 0 remaining sockets + pendingLogout → emit presence:offline
 *
 * Multi-tab safe: if another tab still has a socket, count > 0 → no emit.
 */
export function handleSocketDisconnect(userId) {
  const presence = presenceMap.get(userId);
  if (!presence || !presence.pendingLogout) return;

  const remaining = countUserSockets(userId);
  if (remaining === 0) {
    emitPresenceOffline(userId, 'leave');
  }
}

/**
 * Remove a user from the presence map (e.g. on manual logout).
 */
export function removePresence(userId) {
  presenceMap.delete(userId);
}

/**
 * Return the list of user IDs considered "online" (lastSeenAt within TTL).
 * @param {number} ttlMs – time-to-live in milliseconds (default PRESENCE_ONLINE_TTL_MS)
 * @returns {number[]}
 */
export function getOnlineUserIds(ttlMs = PRESENCE_ONLINE_TTL_MS) {
  const cutoff = Date.now() - ttlMs;
  const ids = [];
  for (const [userId, presence] of presenceMap.entries()) {
    if (presence.lastSeenAt >= cutoff) {
      ids.push(userId);
    }
  }
  return ids;
}

/* ─── Auto-logout logic ──────────────────────────────── */

/**
 * Close any active (open) break_logs entry for a user.
 * This is the authoritative, idempotent function that guarantees
 * no pause session remains open after AUTO_LOGOUT.
 *
 * @param {number} userId
 * @returns {{ closed: boolean, durationSeconds: number|null }}
 */
function closeActiveBreakSession(userId) {
  const nowISO = new Date().toISOString();

  // Find open break_logs entry (ended_at IS NULL)
  const openSession = db.prepare(
    'SELECT id, started_at FROM break_logs WHERE user_id = ? AND ended_at IS NULL'
  ).get(userId);

  if (!openSession) {
    return { closed: false, durationSeconds: null };
  }

  // Close it
  db.prepare('UPDATE break_logs SET ended_at = ? WHERE id = ?').run(nowISO, openSession.id);

  const startMs = new Date(openSession.started_at).getTime();
  const durationSeconds = Math.floor((new Date(nowISO).getTime() - startMs) / 1000);

  return { closed: true, durationSeconds };
}

/**
 * Perform the actual auto-logout for a user:
 *  1. Close any active break session in break_logs  (data integrity first)
 *  2. Set user status to "working"
 *  3. Invalidate their JWT tokens (set tokens_invalid_before)
 *  4. Write an audit log entry (after pause is closed)
 *  5. Notify all team members
 *  6. Emit forceLogout to any remaining sockets for that user
 */
function performAutoLogout(userId) {
  // 1. FIRST: close any open break_logs entry — safety net that works
  //    regardless of the current value in the `status` table.
  const { closed: pauseClosed, durationSeconds: pauseDuration } =
    closeActiveBreakSession(userId);

  // 2. Set status to "offline" in the status table.
  //    We use a direct UPDATE instead of setUserStatus() because
  //    the break_logs entry is already closed above (avoids double-close).
  const nowISO = new Date().toISOString();
  const statusRow = db.prepare('SELECT status FROM status WHERE user_id = ?').get(userId);
  if (statusRow) {
    db.prepare(
      "UPDATE status SET status = 'offline', status_changed_at = ?, updated_at = ? WHERE user_id = ?"
    ).run(nowISO, nowISO, userId);
  } else {
    db.prepare(
      "INSERT INTO status (user_id, status, status_changed_at) VALUES (?, 'offline', ?)"
    ).run(userId, nowISO);
  }

  // 3. Invalidate all tokens issued before now + persist last_seen_at
  db.prepare('UPDATE users SET tokens_invalid_before = ?, last_seen_at = ? WHERE id = ?').run(nowISO, nowISO, userId);

  // 4. Audit log — written AFTER pause is guaranteed closed
  const user = db.prepare('SELECT id, email, role, team_id FROM users WHERE id = ?').get(userId);
  if (user) {
    logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      actionType: 'AUTO_LOGOUT',
      target: { id: user.id, email: user.email },
      targetTeam: null,
      metadata: {
        reason: 'user left application',
        pauseAutoClosed: pauseClosed,
        pauseDurationSeconds: pauseDuration,
      },
    });
  }

  // 5. Emit presence:offline before removing from map (need teamId lookup)
  emitPresenceOffline(userId, 'auto_logout');

  // 6. Remove from presence map
  presenceMap.delete(userId);

  // 7. Notify team update (status changed → offline)
  notifyTeamUpdate();

  // 8. Emit forceLogout to the user's remaining socket connections
  if (ioRef) {
    for (const [, socket] of ioRef.sockets.sockets) {
      if (socket.userId === userId) {
        socket.emit('forceLogout');
      }
    }
  }
}

/* ─── Background checker ─────────────────────────────── */

/**
 * Start the periodic presence checker.
 * Must be called once after the Socket.IO server is created.
 *
 * @param {import('socket.io').Server} io
 */
export function startPresenceChecker(io) {
  ioRef = io;

  setInterval(() => {
    const now = Date.now();

    for (const [userId, presence] of presenceMap.entries()) {
      if (presence.pendingLogout && (now - presence.lastSeenAt) > GRACE_PERIOD_MS) {
        const ageSec = Math.floor((now - presence.lastSeenAt) / 1000);
        console.log(`[Presence] Auto-logout user ${userId} (last seen ${ageSec}s ago)`);
        performAutoLogout(userId);
      }
    }

    // Broadcast online user IDs to all connected clients every cycle.
    // This allows dashboards to hide users who silently went offline.
    emitOnlinePresence();
  }, CHECK_INTERVAL_MS);
}

/** Emit the current set of online user IDs to every connected socket. */
function emitOnlinePresence() {
  if (!ioRef) return;
  ioRef.emit('onlinePresence', { onlineUserIds: getOnlineUserIds() });
}
