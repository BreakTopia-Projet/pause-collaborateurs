import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { getAllStatuses, setUserStatus } from '../status.js';
import { notifyTeamUpdate } from '../socketEmitter.js';
import { getTeamCapacity, getOnBreakCount } from '../teamCapacity.js';

const router = Router();
router.use(authMiddleware);

/** Liste de l'équipe avec statuts et durées (filtrée par team_id du user, ou tous si superadmin) */
router.get('/team', (req, res) => {
  const teamId = req.user.role === 'superadmin' ? null : req.user.team_id ?? null;
  const team = getAllStatuses(teamId);
  res.json(team);
});

/** Changer son propre statut : pause ou travail */
router.post('/me', (req, res) => {
  const userId = req.user.id;
  const { status } = req.body;
  if (status !== 'working' && status !== 'break') {
    return res.status(400).json({ error: 'Statut invalide. Utiliser "working" ou "break".' });
  }

  // Enforce break capacity when starting a break
  if (status === 'break' && req.user.team_id) {
    const capacity = getTeamCapacity(req.user.team_id);
    const onBreakNow = getOnBreakCount(req.user.team_id);
    if (onBreakNow >= capacity) {
      return res.status(409).json({
        error: 'PAUSE_CAPACITY_FULL',
        message: 'Le contingent maximal de personnes en pause est atteint.',
        onBreakNow,
        breakCapacity: capacity,
      });
    }
  }

  const result = setUserStatus(userId, status);
  notifyTeamUpdate();
  res.json(result);
});

export default router;
