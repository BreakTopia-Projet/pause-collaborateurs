import { Router } from 'express';
import db from '../db.js';
import { authMiddleware, verifyToken } from '../auth.js';
import { logAudit } from '../auditLog.js';
import { getTeamCapacity, getOnBreakCount, setBreakCapacity } from '../teamCapacity.js';

const router = Router();

/**
 * GET /api/teams
 * Public (no auth) — returns active teams (for registration selector).
 * With auth + ?all=1 (superadmin only) — returns all teams including archived with full details.
 */
router.get('/', (req, res) => {
  // Try to authenticate (optional)
  const token = req.headers.authorization?.split(' ')[1];
  const payload = token ? verifyToken(token) : null;
  let userRow = null;
  if (payload) {
    userRow = db.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.id);
  }

  const isSuperAdmin = userRow?.role === 'superadmin';
  const includeAll = req.query.all === '1' && isSuperAdmin;

  let teams;
  try {
    const sql = includeAll
      ? 'SELECT id, name, code, is_active, created_at, updated_at FROM teams ORDER BY name'
      : 'SELECT id, name, code, is_active, created_at, updated_at FROM teams WHERE is_active = 1 ORDER BY name';
    teams = db.prepare(sql).all();
  } catch {
    // Fallback: created_at/updated_at columns may not exist in older DBs
    const sql = includeAll
      ? 'SELECT id, name, code, is_active FROM teams ORDER BY name'
      : 'SELECT id, name, code, is_active FROM teams WHERE is_active = 1 ORDER BY name';
    teams = db.prepare(sql).all();
  }

  // For unauthenticated / non-superadmin: return minimal data
  if (!isSuperAdmin) {
    return res.json(teams.map((t) => ({ id: t.id, name: t.name, code: t.code ?? t.name })));
  }

  // For superadmin: return full details
  const result = teams.map((t) => {
    const cap = getTeamCapacity(t.id);
    const onBreak = getOnBreakCount(t.id);
    const memberCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE team_id = ? AND approval_status = 'approved'").get(t.id)?.cnt ?? 0;
    return {
      id: t.id,
      name: t.name,
      code: t.code ?? t.name,
      isActive: !!t.is_active,
      breakCapacity: cap,
      onBreakNow: onBreak,
      memberCount,
      createdAt: t.created_at ?? null,
      updatedAt: t.updated_at ?? null,
    };
  });

  res.json(result);
});

// All mutation endpoints require authentication
router.use(authMiddleware);

/* ─── superadmin-only guard for mutation endpoints ─── */
function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Réservé au super-administrateur' });
  }
  next();
}

/**
 * POST /api/teams — Create a new team
 * Body: { name, code, breakCapacity? }
 */
router.post('/', requireSuperAdmin, (req, res) => {
  const { name, code, breakCapacity } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom d\'équipe requis' });
  if (!code || !code.trim()) return res.status(400).json({ error: 'Code d\'équipe requis' });

  const trimmedCode = code.trim();
  const trimmedName = name.trim();

  // Check uniqueness of code
  const existingCode = db.prepare('SELECT id FROM teams WHERE LOWER(code) = LOWER(?)').get(trimmedCode);
  if (existingCode) return res.status(409).json({ error: 'Ce code d\'équipe existe déjà' });

  // Check uniqueness of name
  const existingName = db.prepare('SELECT id FROM teams WHERE LOWER(name) = LOWER(?)').get(trimmedName);
  if (existingName) return res.status(409).json({ error: 'Ce nom d\'équipe existe déjà' });

  const result = db.prepare(
    "INSERT INTO teams (name, code, is_active, created_at, updated_at) VALUES (?, ?, 1, datetime('now'), datetime('now'))"
  ).run(trimmedName, trimmedCode);

  const teamId = result.lastInsertRowid;

  // Seed break capacity
  const cap = (breakCapacity != null && Number.isInteger(breakCapacity) && breakCapacity >= 0 && breakCapacity <= 50)
    ? breakCapacity : 2;
  setBreakCapacity(teamId, cap);

  // Audit
  logAudit({
    actor: req.user,
    actionType: 'TEAM_CREATE',
    target: null,
    targetTeam: trimmedName,
    metadata: { code: trimmedCode, name: trimmedName, breakCapacity: cap },
  });

  const team = db.prepare('SELECT id, name, code, is_active FROM teams WHERE id = ?').get(teamId);
  res.status(201).json({
    id: team.id,
    name: team.name,
    code: team.code,
    isActive: !!team.is_active,
    breakCapacity: cap,
    onBreakNow: 0,
    memberCount: 0,
  });
});

/**
 * PATCH /api/teams/:id — Update a team (name, code, breakCapacity)
 */
router.patch('/:id', requireSuperAdmin, (req, res) => {
  const teamId = parseInt(req.params.id, 10);
  if (Number.isNaN(teamId)) return res.status(400).json({ error: 'ID invalide' });

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Équipe introuvable' });

  const { name, code, breakCapacity } = req.body;
  const changes = {};

  if (name != null && name.trim() !== '' && name.trim() !== team.name) {
    const trimmed = name.trim();
    const dup = db.prepare('SELECT id FROM teams WHERE LOWER(name) = LOWER(?) AND id != ?').get(trimmed, teamId);
    if (dup) return res.status(409).json({ error: 'Ce nom d\'équipe existe déjà' });
    changes.oldName = team.name;
    changes.newName = trimmed;
    db.prepare("UPDATE teams SET name = ?, updated_at = datetime('now') WHERE id = ?").run(trimmed, teamId);
  }

  if (code != null && code.trim() !== '' && code.trim() !== team.code) {
    const trimmed = code.trim();
    const dup = db.prepare('SELECT id FROM teams WHERE LOWER(code) = LOWER(?) AND id != ?').get(trimmed, teamId);
    if (dup) return res.status(409).json({ error: 'Ce code d\'équipe existe déjà' });

    // Block code change if team already has members (registration uses code to join)
    const userCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE team_id = ? AND approval_status = 'approved'").get(teamId)?.cnt ?? 0;
    if (userCount > 0) {
      return res.status(400).json({
        error: `Impossible de modifier le code : ${userCount} membre(s) utilisent ce code pour l'inscription. Créez une nouvelle équipe si nécessaire.`,
        errorCode: 'TEAM_CODE_HAS_MEMBERS',
        memberCount: userCount,
      });
    }
    changes.oldCode = team.code;
    changes.newCode = trimmed;
    db.prepare("UPDATE teams SET code = ?, updated_at = datetime('now') WHERE id = ?").run(trimmed, teamId);
  }

  if (breakCapacity != null) {
    const val = parseInt(breakCapacity, 10);
    if (!Number.isNaN(val) && val >= 0 && val <= 50) {
      changes.oldCapacity = getTeamCapacity(teamId);
      changes.newCapacity = val;
      setBreakCapacity(teamId, val);
    }
  }

  // Audit
  if (Object.keys(changes).length > 0) {
    logAudit({
      actor: req.user,
      actionType: 'TEAM_UPDATE',
      target: null,
      targetTeam: changes.newName || team.name,
      metadata: changes,
    });
  }

  const updated = db.prepare('SELECT id, name, code, is_active FROM teams WHERE id = ?').get(teamId);
  const cap = getTeamCapacity(teamId);
  const onBreak = getOnBreakCount(teamId);
  const memberCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE team_id = ? AND approval_status = 'approved'").get(teamId)?.cnt ?? 0;

  res.json({
    id: updated.id,
    name: updated.name,
    code: updated.code,
    isActive: !!updated.is_active,
    breakCapacity: cap,
    onBreakNow: onBreak,
    memberCount,
  });
});

/**
 * POST /api/teams/:id/archive — Archive (deactivate) a team
 */
router.post('/:id/archive', requireSuperAdmin, (req, res) => {
  const teamId = parseInt(req.params.id, 10);
  if (Number.isNaN(teamId)) return res.status(400).json({ error: 'ID invalide' });

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Équipe introuvable' });
  if (!team.is_active) return res.status(400).json({ error: 'Équipe déjà archivée' });

  const memberCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE team_id = ? AND approval_status = 'approved'").get(teamId)?.cnt ?? 0;

  db.prepare("UPDATE teams SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(teamId);

  logAudit({
    actor: req.user,
    actionType: 'TEAM_ARCHIVE',
    target: null,
    targetTeam: team.name,
    metadata: { teamCode: team.code, membersAtArchive: memberCount },
  });

  res.json({ ok: true, teamId, teamName: team.name, memberCount, warning: memberCount > 0 ? `${memberCount} utilisateur(s) encore assigné(s) à cette équipe` : null });
});

/**
 * POST /api/teams/:id/unarchive — Reactivate an archived team
 */
router.post('/:id/unarchive', requireSuperAdmin, (req, res) => {
  const teamId = parseInt(req.params.id, 10);
  if (Number.isNaN(teamId)) return res.status(400).json({ error: 'ID invalide' });

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Équipe introuvable' });
  if (team.is_active) return res.status(400).json({ error: 'Équipe déjà active' });

  db.prepare("UPDATE teams SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(teamId);

  logAudit({
    actor: req.user,
    actionType: 'TEAM_UNARCHIVE',
    target: null,
    targetTeam: team.name,
    metadata: { teamCode: team.code },
  });

  res.json({ ok: true, teamId, teamName: team.name });
});

export default router;
