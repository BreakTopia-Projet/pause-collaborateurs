import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../auth.js';
import { getTeamCapacity, getOnBreakCount, setBreakCapacity, getAllTeamCapacities } from '../teamCapacity.js';
import { notifyCapacityUpdate } from '../socketEmitter.js';

const router = Router();
router.use(authMiddleware);

/**
 * GET /config/team-capacity
 * - user/admin: returns own team's capacity + current onBreak count
 * - superadmin: returns all teams' capacities + counts
 */
router.get('/config/team-capacity', (req, res) => {
  if (req.user.role === 'superadmin') {
    return res.json({ teams: getAllTeamCapacities() });
  }

  const teamId = req.user.team_id;
  if (!teamId) {
    return res.json({ teamId: null, teamName: null, breakCapacity: 2, onBreakNow: 0 });
  }

  const teamRow = db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId);
  const cap = getTeamCapacity(teamId);
  const onBreak = getOnBreakCount(teamId);

  res.json({
    teamId,
    teamName: teamRow?.name ?? null,
    breakCapacity: cap,
    onBreakNow: onBreak,
  });
});

/**
 * PATCH /teams/:teamId/capacity
 * Body: { breakCapacity: number }
 * - superadmin: any team
 * - admin: only their own team
 * - user: forbidden
 */
router.patch('/teams/:teamId/capacity', (req, res) => {
  const teamId = parseInt(req.params.teamId, 10);
  if (Number.isNaN(teamId)) return res.status(400).json({ error: 'teamId invalide' });

  // Permission check
  if (req.user.role === 'user') {
    return res.status(403).json({ error: 'Accès interdit' });
  }
  if (req.user.role === 'admin' && req.user.team_id !== teamId) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que les paramètres de votre équipe' });
  }

  // Validate team exists
  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Équipe introuvable' });

  // Validate breakCapacity
  const { breakCapacity } = req.body;
  if (breakCapacity == null || !Number.isInteger(breakCapacity) || breakCapacity < 0 || breakCapacity > 50) {
    return res.status(400).json({ error: 'breakCapacity doit être un entier entre 0 et 50' });
  }

  setBreakCapacity(teamId, breakCapacity);

  const onBreak = getOnBreakCount(teamId);

  // Notify all clients in this team + superadmin
  notifyCapacityUpdate(teamId);

  res.json({
    teamId,
    teamName: team.name,
    breakCapacity,
    onBreakNow: onBreak,
  });
});

export default router;
