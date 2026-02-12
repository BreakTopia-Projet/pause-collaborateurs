import db from './db.js';
import { PAUSE_PROLONGEE_MINUTES } from './config.js';

const STATUS_WORKING = 'working';
const STATUS_BREAK = 'break';
const STATUS_OFFLINE = 'offline';

/** Retourne le statut "affiché" : working | break | extended_break | offline selon le seuil */
export function getDisplayStatus(row) {
  if (!row || row.status === STATUS_WORKING) return 'working';
  if (row.status === STATUS_OFFLINE) return 'offline';
  const changedAt = new Date(row.status_changed_at);
  const minutes = (Date.now() - changedAt.getTime()) / 60000;
  return minutes >= PAUSE_PROLONGEE_MINUTES ? 'extended_break' : 'break';
}

/** Durée écoulée en secondes depuis status_changed_at */
export function getElapsedSeconds(row) {
  if (!row) return 0;
  return Math.floor((Date.now() - new Date(row.status_changed_at).getTime()) / 1000);
}

/**
 * Compute the total completed break seconds for today per user.
 * Only includes ENDED sessions (ongoing breaks are handled client-side).
 * Handles sessions crossing midnight by only counting the portion within today.
 * @param {number|null} teamId - filter by team, or null for all users
 * @returns {Object} map of userId -> totalCompletedSeconds
 */
function getDailyCompletedPauseSeconds(teamId = null) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
  const tomorrowISO = tomorrowStart.toISOString();

  // Select all completed break sessions that overlap today
  // effectiveStart = MAX(started_at, todayStart)
  // effectiveEnd   = MIN(ended_at, tomorrowStart)
  // contribution   = effectiveEnd - effectiveStart (in seconds)
  let sql = `
    SELECT bl.user_id,
           SUM(
             MAX(0,
               CAST(
                 (julianday(MIN(bl.ended_at, ?)) - julianday(MAX(bl.started_at, ?))) * 86400
               AS INTEGER)
             )
           ) AS total_seconds
    FROM break_logs bl
    JOIN users u ON u.id = bl.user_id
    WHERE bl.ended_at IS NOT NULL
      AND bl.started_at < ?
      AND bl.ended_at > ?
      AND u.approval_status = 'approved'
  `;
  const params = [tomorrowISO, todayISO, tomorrowISO, todayISO];

  if (teamId != null) {
    sql += ' AND u.team_id = ?';
    params.push(teamId);
  }

  sql += ' GROUP BY bl.user_id';

  const rows = db.prepare(sql).all(...params);
  const map = {};
  for (const row of rows) {
    map[row.user_id] = row.total_seconds ?? 0;
  }
  return map;
}

/** Liste les collaborateurs avec statut calculé et durée. teamId = null => tous (superadmin) */
export function getAllStatuses(teamId = null) {
  const sql = teamId == null
    ? `
      SELECT u.id, u.first_name, u.last_name, u.email, u.team_id, u.role,
             u.last_seen_at, s.status, s.status_changed_at,
             t.name AS team_name
      FROM users u
      LEFT JOIN status s ON s.user_id = u.id
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.approval_status = 'approved'
      ORDER BY u.last_name, u.first_name
    `
    : `
      SELECT u.id, u.first_name, u.last_name, u.email, u.team_id, u.role,
             u.last_seen_at, s.status, s.status_changed_at,
             t.name AS team_name
      FROM users u
      LEFT JOIN status s ON s.user_id = u.id
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.team_id = ? AND u.approval_status = 'approved'
      ORDER BY u.last_name, u.first_name
    `;
  const users = teamId == null
    ? db.prepare(sql).all()
    : db.prepare(sql).all(teamId);

  // Compute daily completed pause totals for all relevant users
  const dailyTotals = getDailyCompletedPauseSeconds(teamId);

  const now = Date.now();
  return users.map((u) => {
    const status = u.status ?? STATUS_OFFLINE;
    const changedAt = u.status_changed_at ? new Date(u.status_changed_at).getTime() : now;
    const elapsedSeconds = Math.floor((now - changedAt) / 1000);
    const minutes = elapsedSeconds / 60;

    let displayStatus;
    if (status === STATUS_OFFLINE) {
      displayStatus = 'offline';
    } else if (status === STATUS_WORKING) {
      displayStatus = 'working';
    } else {
      displayStatus = minutes >= PAUSE_PROLONGEE_MINUTES ? 'extended_break' : 'break';
    }

    return {
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      role: u.role ?? 'user',
      teamId: u.team_id,
      teamName: u.team_name ?? null,
      status: displayStatus,
      statusChangedAt: u.status_changed_at,
      lastSeenAt: u.last_seen_at ?? null,
      elapsedSeconds: displayStatus === 'offline' ? 0 : elapsedSeconds,
      dailyCompletedPauseSeconds: dailyTotals[u.id] ?? 0,
    };
  });
}

/** Met à jour le statut d'un utilisateur et enregistre les pauses dans break_logs */
export function setUserStatus(userId, newStatus) {
  const now = new Date().toISOString();
  const prev = db.prepare('SELECT status FROM status WHERE user_id = ?').get(userId);
  const prevStatus = prev?.status ?? STATUS_OFFLINE;

  db.prepare(`
    INSERT INTO status (user_id, status, status_changed_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = ?, status_changed_at = ?, updated_at = ?
  `).run(userId, newStatus, now, newStatus, now, now);

  // Break start: working/offline → break
  if ((prevStatus === STATUS_WORKING || prevStatus === STATUS_OFFLINE) && newStatus === STATUS_BREAK) {
    db.prepare('INSERT INTO break_logs (user_id, started_at) VALUES (?, ?)').run(userId, now);
  }
  // Break end: break → working/offline
  if (prevStatus === STATUS_BREAK && (newStatus === STATUS_WORKING || newStatus === STATUS_OFFLINE)) {
    db.prepare('UPDATE break_logs SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(now, userId);
  }

  return { status: newStatus, statusChangedAt: now };
}

/** Récupère la ligne status pour un user (pour calcul côté client si besoin) */
export function getStatusRow(userId) {
  return db.prepare('SELECT * FROM status WHERE user_id = ?').get(userId);
}
