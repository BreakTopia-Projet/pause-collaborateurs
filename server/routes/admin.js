import { Router } from 'express';
import db from '../db.js';
import { authMiddleware, getUserById, updateUserProfile, setUserRole, getUserByEmail, isSuperAdminEmail } from '../auth.js';
import { getBreakStatsForUsers, resetBreakLogs } from '../breakStats.js';
import { getAllStatuses } from '../status.js';
import { logAudit } from '../auditLog.js';
import { notifyTeamUpdate } from '../socketEmitter.js';
import PDFDocument from 'pdfkit';

const router = Router();
router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
  return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
}

router.use(requireAdmin);

/** Liste des équipes actives (superadmin: toutes actives; admin: la sienne) */
router.get('/teams', (req, res) => {
  if (req.user.role === 'superadmin') {
    const teams = db.prepare('SELECT id, name, code, is_active FROM teams WHERE is_active = 1 ORDER BY name').all();
    return res.json(teams);
  }
  const teamId = req.user.team_id;
  if (!teamId) return res.json([]);
  const team = db.prepare('SELECT id, name, code, is_active FROM teams WHERE id = ?').get(teamId);
  return res.json(team ? [team] : []);
});

/** Membres avec stats de pause. ?teamId= pour superadmin (optionnel). */
router.get('/team-members', (req, res) => {
  let teamId = req.query.teamId != null ? parseInt(req.query.teamId, 10) : null;
  if (req.user.role === 'admin') {
    teamId = req.user.team_id;
  }
  const sql = teamId == null
    ? `
      SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.team_id, t.name AS team_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.approval_status = 'approved'
      ORDER BY t.name, u.last_name, u.first_name
    `
    : `
      SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.team_id, t.name AS team_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.team_id = ? AND u.approval_status = 'approved'
      ORDER BY u.last_name, u.first_name
    `;
  const rows = teamId == null ? db.prepare(sql).all() : db.prepare(sql).all(teamId);
  const userIds = rows.map((r) => r.id);
  const stats = getBreakStatsForUsers(userIds);

  // Fetch live status for all relevant users
  const liveStatuses = getAllStatuses(teamId);
  const statusMap = {};
  liveStatuses.forEach((s) => { statusMap[s.id] = s; });

  const members = rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    role: r.role,
    teamId: r.team_id,
    teamName: r.team_name,
    liveStatus: statusMap[r.id]?.status ?? 'offline',
    statusChangedAt: statusMap[r.id]?.statusChangedAt ?? null,
    lastSeenAt: statusMap[r.id]?.lastSeenAt ?? null,
    elapsedSeconds: statusMap[r.id]?.elapsedSeconds ?? 0,
    breakStats: {
      byDay: stats[r.id]?.byDay ?? {},
      weeklyTotalSeconds: stats[r.id]?.weeklyTotal ?? 0,
    },
  }));
  res.json(members);
});

/** Modifier un membre (nom, email, reset compteur). Admin: même équipe; Superadmin: tous. */
router.patch('/users/:id', (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (Number.isNaN(targetId)) return res.status(400).json({ error: 'ID invalide' });

  const target = getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (req.user.role === 'admin' && target.team_id !== req.user.team_id) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que les membres de votre équipe' });
  }

  const { firstName, lastName, email, resetCounter } = req.body;

  // Prevent changing the super-admin's email (it is the identity anchor)
  if (target.role === 'superadmin' && email != null && email.trim() !== '' && email.trim().toLowerCase() !== target.email.toLowerCase()) {
    return res.status(403).json({ error: 'L\'email du super-administrateur ne peut pas être modifié' });
  }
  // Prevent setting any user's email to the super-admin email (hijack protection)
  if (email != null && isSuperAdminEmail(email.trim()) && !isSuperAdminEmail(target.email)) {
    return res.status(403).json({ error: 'Cet email est réservé' });
  }

  if (email != null && email.trim() !== '' && email !== target.email) {
    const existing = getUserByEmail(email.trim());
    if (existing && existing.id !== targetId) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }
  }
  if (firstName != null || lastName != null || email != null) {
    const updated = updateUserProfile(targetId, { firstName, lastName, email });
    if (!updated) return res.status(500).json({ error: 'Erreur mise à jour' });
  }
  if (resetCounter === true) {
    resetBreakLogs(targetId);
    const teamName = db.prepare('SELECT name FROM teams WHERE id = ?').get(target.team_id)?.name ?? null;
    logAudit({
      actor: req.user,
      actionType: 'COUNTER_RESET',
      target,
      targetTeam: teamName,
    });
  }
  const user = getUserById(targetId);
  res.json({
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: user.role,
    teamId: user.team_id,
  });
});

/** Attribuer ou retirer le rôle admin. Admin: uniquement membres de son équipe; Superadmin: tous. Retirer admin: superadmin uniquement. */
router.post('/users/:id/role', (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { role } = req.body;
  if (Number.isNaN(targetId) || (role !== 'user' && role !== 'admin')) {
    return res.status(400).json({ error: 'role doit être "user" ou "admin"' });
  }

  const target = getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  // The superadmin role is determined exclusively by email -- cannot be changed via API
  if (target.role === 'superadmin') {
    return res.status(403).json({ error: 'Le rôle du super-administrateur ne peut pas être modifié' });
  }

  if (role === 'user') {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Seul le super-administrateur peut retirer le rôle administrateur' });
    }
  } else {
    if (req.user.role === 'admin' && target.team_id !== req.user.team_id) {
      return res.status(403).json({ error: 'Vous ne pouvez promouvoir que les membres de votre équipe' });
    }
  }

  const oldRole = target.role;
  setUserRole(targetId, role);
  const user = getUserById(targetId);

  const teamName = db.prepare('SELECT name FROM teams WHERE id = ?').get(target.team_id)?.name ?? null;
  logAudit({
    actor: req.user,
    actionType: 'ROLE_CHANGE',
    target,
    targetTeam: teamName,
    metadata: { oldRole, newRole: role },
  });

  res.json({
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: user.role,
    teamId: user.team_id,
  });
});

/** Changer l'équipe d'un utilisateur. Superadmin uniquement. */
router.patch('/users/:id/team', (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (Number.isNaN(targetId)) return res.status(400).json({ error: 'ID invalide' });

  // Only super-admin can move users between teams (safe default)
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Seul le super-administrateur peut changer l\'équipe d\'un utilisateur' });
  }

  const { teamId } = req.body;
  if (teamId == null) {
    return res.status(400).json({ error: 'teamId requis' });
  }
  const newTeamId = parseInt(teamId, 10);
  if (Number.isNaN(newTeamId)) {
    return res.status(400).json({ error: 'teamId invalide' });
  }

  // Validate that the target team exists
  const newTeam = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(newTeamId);
  if (!newTeam) {
    return res.status(400).json({ error: 'Équipe inconnue' });
  }

  const target = getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  // Protect super-admin from accidental team change (only super-admin themselves can change their own team)
  if (isSuperAdminEmail(target.email) && req.user.id !== target.id) {
    return res.status(403).json({ error: 'L\'équipe du super-administrateur ne peut pas être modifiée par un tiers' });
  }

  // No-op if same team
  if (target.team_id === newTeamId) {
    return res.json({
      id: target.id,
      firstName: target.first_name,
      lastName: target.last_name,
      email: target.email,
      role: target.role,
      teamId: target.team_id,
      teamName: newTeam.name,
    });
  }

  // Snapshot old team name
  const oldTeamName = db.prepare('SELECT name FROM teams WHERE id = ?').get(target.team_id)?.name ?? null;

  // Apply change
  db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(newTeamId, targetId);

  // Audit
  logAudit({
    actor: req.user,
    actionType: 'TEAM_CHANGE',
    target,
    targetTeam: oldTeamName,
    metadata: { oldTeam: oldTeamName, newTeam: newTeam.name, oldTeamId: target.team_id, newTeamId },
  });

  // Notify all connected clients so team dashboards update in real time
  notifyTeamUpdate();

  const updated = getUserById(targetId);
  res.json({
    id: updated.id,
    firstName: updated.first_name,
    lastName: updated.last_name,
    email: updated.email,
    role: updated.role,
    teamId: updated.team_id,
    teamName: newTeam.name,
  });
});

/** Supprimer un utilisateur. Superadmin: tous (sauf lui-même); Admin: même équipe seulement. Impossible de supprimer un superadmin. */
router.delete('/users/:id', (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (Number.isNaN(targetId)) return res.status(400).json({ error: 'ID invalide' });

  const target = getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  // Hard rule: forbid deleting the super-administrator
  if (target.role === 'superadmin' || isSuperAdminEmail(target.email)) {
    return res.status(403).json({ error: 'Le super-administrateur ne peut pas être supprimé' });
  }

  // Admin can only delete within own team
  if (req.user.role === 'admin' && target.team_id !== req.user.team_id) {
    return res.status(403).json({ error: 'Vous ne pouvez supprimer que les membres de votre équipe' });
  }

  // Snapshot target info before deletion
  const teamName = db.prepare('SELECT name FROM teams WHERE id = ?').get(target.team_id)?.name ?? null;

  // Cascade-delete related records then the user
  db.prepare('DELETE FROM break_logs WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM status WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  // Audit log (after successful deletion, snapshot was captured before)
  logAudit({
    actor: req.user,
    actionType: 'USER_DELETE',
    target,
    targetTeam: teamName,
    metadata: { targetRole: target.role },
  });

  res.json({ ok: true, deletedId: targetId });
});

/** Journal d'audit. Superadmin: tous les logs; Admin: logs dont la cible appartient à son équipe. */
router.get('/audit-logs', (req, res) => {
  const { range, actionType, search } = req.query;

  // Date filtering
  let dateFilter = '';
  if (range === 'today') {
    dateFilter = "AND a.created_at >= date('now')";
  } else if (range === '7days') {
    dateFilter = "AND a.created_at >= date('now', '-7 days')";
  } else if (range === '30days') {
    dateFilter = "AND a.created_at >= date('now', '-30 days')";
  }

  // Action type filtering
  let actionFilter = '';
  const params = [];
  if (actionType && actionType !== 'all') {
    actionFilter = 'AND a.action_type = ?';
    params.push(actionType);
  }

  // Email search (actor or target)
  let searchFilter = '';
  if (search && search.trim() !== '') {
    searchFilter = 'AND (a.actor_email LIKE ? OR a.target_email LIKE ?)';
    const like = `%${search.trim()}%`;
    params.push(like, like);
  }

  // Team scoping for admins
  let teamFilter = '';
  if (req.user.role === 'admin') {
    const teamName = db.prepare('SELECT name FROM teams WHERE id = ?').get(req.user.team_id)?.name;
    if (!teamName) return res.json([]);
    teamFilter = 'AND a.target_team = ?';
    params.push(teamName);
  }

  const sql = `
    SELECT a.id, a.actor_user_id, a.actor_email, a.actor_role,
           a.action_type, a.target_user_id, a.target_email, a.target_team,
           a.metadata_json, a.created_at
    FROM audit_logs a
    WHERE 1=1 ${dateFilter} ${actionFilter} ${searchFilter} ${teamFilter}
    ORDER BY a.created_at DESC
    LIMIT 500
  `;

  const rows = db.prepare(sql).all(...params);

  const logs = rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    actionType: r.action_type,
    targetUserId: r.target_user_id,
    targetEmail: r.target_email,
    targetTeam: r.target_team,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : null,
    createdAt: r.created_at,
  }));

  res.json(logs);
});

/**
 * GET /api/admin/break-sessions
 * Detailed break session history with filters.
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), teamId, userId
 * Admin: restricted to own team. SuperAdmin: all teams.
 */
router.get('/break-sessions', (req, res) => {
  let { from, to, teamId, userId } = req.query;

  // Default: today
  if (!from) from = new Date().toISOString().slice(0, 10);
  if (!to) to = from;

  // Admin: force own team
  if (req.user.role === 'admin') {
    teamId = req.user.team_id;
  } else if (teamId) {
    teamId = parseInt(teamId, 10);
    if (Number.isNaN(teamId)) teamId = null;
  } else {
    teamId = null;
  }

  if (userId) {
    userId = parseInt(userId, 10);
    if (Number.isNaN(userId)) userId = null;
    // Admin: verify target user belongs to their team
    if (userId && req.user.role === 'admin') {
      const targetUser = db.prepare('SELECT team_id FROM users WHERE id = ?').get(userId);
      if (!targetUser || targetUser.team_id !== req.user.team_id) {
        return res.status(403).json({ error: 'Utilisateur hors de votre équipe' });
      }
    }
  }

  // Build date boundaries (inclusive: from 00:00:00 to to+1 00:00:00)
  const fromISO = `${from}T00:00:00.000Z`;
  const toDate = new Date(to + 'T00:00:00.000Z');
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  const toISO = toDate.toISOString();

  let sql = `
    SELECT bl.id, bl.user_id, bl.started_at, bl.ended_at,
           u.first_name, u.last_name, u.team_id,
           t.name AS team_name
    FROM break_logs bl
    JOIN users u ON u.id = bl.user_id
    LEFT JOIN teams t ON t.id = u.team_id
    WHERE bl.started_at >= ? AND bl.started_at < ?
      AND u.approval_status = 'approved'
  `;
  const params = [fromISO, toISO];

  if (teamId) {
    sql += ' AND u.team_id = ?';
    params.push(teamId);
  }
  if (userId) {
    sql += ' AND bl.user_id = ?';
    params.push(userId);
  }

  sql += ' ORDER BY bl.started_at DESC LIMIT 2000';

  const rows = db.prepare(sql).all(...params);

  const sessions = rows.map((r) => {
    const startMs = new Date(r.started_at).getTime();
    const endMs = r.ended_at ? new Date(r.ended_at).getTime() : null;
    const durationSeconds = endMs ? Math.floor((endMs - startMs) / 1000) : null;
    return {
      id: r.id,
      userId: r.user_id,
      firstName: r.first_name,
      lastName: r.last_name,
      teamId: r.team_id,
      teamName: r.team_name,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationSeconds,
    };
  });

  res.json(sessions);
});

/**
 * GET /api/admin/break-summary
 * Weekly/period summary per user.
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), teamId
 * Returns per-user totals: totalSeconds, sessionCount, avgSeconds.
 */
router.get('/break-summary', (req, res) => {
  let { from, to, teamId } = req.query;

  // Default: current week (Mon–Sun)
  if (!from || !to) {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + mondayOffset);
    from = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    to = sunday.toISOString().slice(0, 10);
  }

  // Admin: force own team
  if (req.user.role === 'admin') {
    teamId = req.user.team_id;
  } else if (teamId) {
    teamId = parseInt(teamId, 10);
    if (Number.isNaN(teamId)) teamId = null;
  } else {
    teamId = null;
  }

  const fromISO = `${from}T00:00:00.000Z`;
  const toDate = new Date(to + 'T00:00:00.000Z');
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  const toISO = toDate.toISOString();

  let sql = `
    SELECT bl.user_id,
           u.first_name, u.last_name, u.team_id,
           t.name AS team_name,
           COUNT(bl.id) AS session_count,
           SUM(CASE WHEN bl.ended_at IS NOT NULL
                 THEN CAST((julianday(bl.ended_at) - julianday(bl.started_at)) * 86400 AS INTEGER)
                 ELSE 0 END) AS total_seconds
    FROM break_logs bl
    JOIN users u ON u.id = bl.user_id
    LEFT JOIN teams t ON t.id = u.team_id
    WHERE bl.started_at >= ? AND bl.started_at < ?
      AND u.approval_status = 'approved'
  `;
  const params = [fromISO, toISO];

  if (teamId) {
    sql += ' AND u.team_id = ?';
    params.push(teamId);
  }

  sql += ' GROUP BY bl.user_id ORDER BY total_seconds DESC LIMIT 500';

  const rows = db.prepare(sql).all(...params);

  const summary = rows.map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    teamId: r.team_id,
    teamName: r.team_name,
    totalSeconds: r.total_seconds ?? 0,
    sessionCount: r.session_count ?? 0,
    avgSeconds: r.session_count > 0 ? Math.round((r.total_seconds ?? 0) / r.session_count) : 0,
  }));

  res.json(summary);
});

/* ═══════════════════════════════════════════════════════════════════
 *  PRESENCE EXPORT — CSV & PDF
 *  Admin: own team only. SuperAdmin: all or filtered by teamId.
 * ═══════════════════════════════════════════════════════════════════ */

/** Build the presence data array used by both CSV and PDF exports */
function getPresenceData(reqUser, teamIdParam) {
  let teamId = teamIdParam != null ? parseInt(teamIdParam, 10) : null;
  if (reqUser.role === 'admin') teamId = reqUser.team_id;

  const statuses = getAllStatuses(teamId);

  // Enrich with teamName
  const teamNames = {};
  db.prepare('SELECT id, name FROM teams').all().forEach((t) => { teamNames[t.id] = t.name; });

  const now = Date.now();
  return statuses.map((s) => {
    // Retrieve last_seen_at from users table
    const userRow = db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(s.id);
    const lastSeenAt = userRow?.last_seen_at ?? null;
    const lastSeenDate = lastSeenAt ? new Date(lastSeenAt) : null;
    const offlineSinceSeconds = (s.status === 'offline' && lastSeenDate)
      ? Math.max(0, Math.floor((now - lastSeenDate.getTime()) / 1000))
      : null;

    // Get team name from status (uses user's team_id via join) — we need it
    const uRow = db.prepare('SELECT team_id FROM users WHERE id = ?').get(s.id);
    const teamName = teamNames[uRow?.team_id] ?? '–';

    return {
      firstName: s.firstName,
      lastName: s.lastName,
      teamName,
      status: s.status, // working | break | extended_break | offline
      lastSeenAt,
      lastSeenLocal: lastSeenDate ? lastSeenDate.toLocaleString('fr-CH') : '–',
      offlineSinceSeconds,
      elapsedSeconds: s.elapsedSeconds ?? 0,
      dailyCompletedPauseSeconds: s.dailyCompletedPauseSeconds ?? 0,
    };
  });
}

function formatOfflineDuration(seconds) {
  if (seconds == null || seconds < 0) return '–';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')}`;
}

function formatBreakDuration(seconds) {
  if (!seconds || seconds <= 0) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function statusLabel(st) {
  const map = { working: 'Au travail', break: 'En pause', extended_break: 'Pause prolongée', offline: 'Déconnecté' };
  return map[st] || st;
}

/** GET /api/admin/presence/export.csv */
router.get('/presence/export.csv', (req, res) => {
  const data = getPresenceData(req.user, req.query.teamId);

  const header = ['Employé', 'Équipe', 'Statut', 'Dernière activité', 'Déconnecté depuis', 'En pause depuis', 'Total jour'].join(';');
  const rows = data.map((d) => {
    const name = `${d.firstName} ${d.lastName}`;
    const status = statusLabel(d.status);
    const offlineSince = d.offlineSinceSeconds != null ? formatOfflineDuration(d.offlineSinceSeconds) : '–';
    const breakSince = (d.status === 'break' || d.status === 'extended_break') ? formatBreakDuration(d.elapsedSeconds) : '–';
    const dailyTotal = formatBreakDuration(d.dailyCompletedPauseSeconds + ((d.status === 'break' || d.status === 'extended_break') ? d.elapsedSeconds : 0));
    return [name, d.teamName, status, d.lastSeenLocal, offlineSince, breakSince, dailyTotal].join(';');
  });

  // BOM for Excel UTF-8 compatibility
  const csv = '\uFEFF' + header + '\n' + rows.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="presence.csv"');
  res.send(csv);
});

/** GET /api/admin/presence/export.pdf */
router.get('/presence/export.pdf', (req, res) => {
  const data = getPresenceData(req.user, req.query.teamId);

  // KPI summary
  const connected = data.filter((d) => d.status !== 'offline');
  const working = connected.filter((d) => d.status === 'working').length;
  const onBreak = connected.length - working;
  const offlineCount = data.length - connected.length;

  const teamLabel = req.user.role === 'admin'
    ? (db.prepare('SELECT name FROM teams WHERE id = ?').get(req.user.team_id)?.name ?? 'Mon équipe')
    : (req.query.teamId ? (db.prepare('SELECT name FROM teams WHERE id = ?').get(parseInt(req.query.teamId, 10))?.name ?? 'Toutes') : 'Toutes les équipes');

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="presence.pdf"');
  doc.pipe(res);

  // Title
  doc.fontSize(16).text(`Présence réelle – ${teamLabel} – ${new Date().toLocaleString('fr-CH')}`, { align: 'center' });
  doc.moveDown(0.5);

  // Summary
  doc.fontSize(10);
  doc.text(`Connectés : ${connected.length}  |  Au travail : ${working}  |  En pause : ${onBreak}  |  Déconnectés : ${offlineCount}`, { align: 'center' });
  doc.moveDown(0.8);

  // Table header
  const cols = [
    { label: 'Employé', width: 140 },
    { label: 'Équipe', width: 100 },
    { label: 'Statut', width: 100 },
    { label: 'Dernière activité', width: 130 },
    { label: 'Déco. depuis', width: 80 },
    { label: 'Pause depuis', width: 80 },
    { label: 'Total jour', width: 80 },
  ];
  const startX = doc.x;
  let y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8);
  let x = startX;
  cols.forEach((c) => { doc.text(c.label, x, y, { width: c.width }); x += c.width; });
  y += 14;
  doc.moveTo(startX, y).lineTo(startX + cols.reduce((s, c) => s + c.width, 0), y).stroke();
  y += 4;

  // Rows
  doc.font('Helvetica').fontSize(8);
  for (const d of data) {
    if (y > 540) { doc.addPage(); y = 40; }
    x = startX;
    const rowData = [
      `${d.firstName} ${d.lastName}`,
      d.teamName,
      statusLabel(d.status),
      d.lastSeenLocal,
      d.offlineSinceSeconds != null ? formatOfflineDuration(d.offlineSinceSeconds) : '–',
      (d.status === 'break' || d.status === 'extended_break') ? formatBreakDuration(d.elapsedSeconds) : '–',
      formatBreakDuration(d.dailyCompletedPauseSeconds + ((d.status === 'break' || d.status === 'extended_break') ? d.elapsedSeconds : 0)),
    ];
    cols.forEach((c, i) => { doc.text(rowData[i], x, y, { width: c.width }); x += c.width; });
    y += 13;
  }

  doc.end();
});

/** Export PDF des membres et stats. ?teamId= pour superadmin (optionnel = toutes équipes). */
router.get('/export/pdf', (req, res) => {
  let teamId = req.query.teamId != null ? parseInt(req.query.teamId, 10) : null;
  if (req.user.role === 'admin') teamId = req.user.team_id;

  const sql = teamId == null
    ? `
      SELECT u.id, u.first_name, u.last_name, u.email, u.role, t.name AS team_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.approval_status = 'approved'
      ORDER BY t.name, u.last_name, u.first_name
    `
    : `
      SELECT u.id, u.first_name, u.last_name, u.email, u.role, t.name AS team_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.team_id = ? AND u.approval_status = 'approved'
      ORDER BY u.last_name, u.first_name
    `;
  const rows = teamId == null ? db.prepare(sql).all() : db.prepare(sql).all(teamId);
  const userIds = rows.map((r) => r.id);
  const stats = getBreakStatsForUsers(userIds);

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="pauses-equipe.pdf"');
  doc.pipe(res);

  doc.fontSize(18).text('Rapport des pauses', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10);

  const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}min`;
  };

  for (const r of rows) {
    const s = stats[r.id];
    const weekly = s?.weeklyTotal ?? 0;
    doc.text(`${r.first_name} ${r.last_name} (${r.email}) - Équipe: ${r.team_name || '-'}`);
    doc.text(`  Total semaine: ${formatDuration(weekly)}`);
    const byDay = s?.byDay ?? {};
    const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
    days.forEach(([date, sec]) => {
      doc.text(`  ${date}: ${formatDuration(sec)}`);
    });
    doc.moveDown(0.5);
  }

  doc.end();
});

export default router;
