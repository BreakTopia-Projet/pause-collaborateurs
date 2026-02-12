import { Router } from 'express';
import { authMiddleware, verifyToken } from '../auth.js';
import { ping, leave, getOnlineUserIds, PRESENCE_ONLINE_TTL_MS } from '../presence.js';

const router = Router();

/**
 * POST /api/presence/ping
 * Heartbeat — called every 5s by the client while the app is active.
 * Requires standard Bearer token authentication.
 */
router.post('/ping', authMiddleware, (req, res) => {
  ping(req.user.id);
  res.json({ ok: true });
});

/**
 * POST /api/presence/leave
 * Called when the client might be leaving (pagehide event).
 *
 * Supports two authentication modes:
 *  1. Standard `Authorization: Bearer <token>` header (fetch with keepalive)
 *  2. Token in the JSON body `{ token }` (navigator.sendBeacon fallback)
 */
router.post('/leave', (req, res) => {
  // Try header first, then body (for sendBeacon fallback)
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const bodyToken = req.body?.token ?? null;
  const token = headerToken || bodyToken;

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  leave(payload.id);
  res.json({ ok: true });
});

/**
 * GET /api/presence/online
 * Returns the list of user IDs considered online (last seen within TTL).
 * Used by the Dashboard to filter the team list.
 */
router.get('/online', authMiddleware, (req, res) => {
  const onlineUserIds = getOnlineUserIds();
  res.json({ onlineUserIds, ttlSeconds: PRESENCE_ONLINE_TTL_MS / 1000 });
});

export default router;
