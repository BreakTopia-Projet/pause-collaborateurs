import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../auth.js';
import { logAudit } from '../auditLog.js';
import { APPROVAL_STATUS, isTransitionAllowed } from '../../shared/approvalStatus.js';
import { sendMail } from '../services/mailService.js';
import { accountApprovedEmail, accountRejectedEmail } from '../services/emailTemplates.js';
import { notifyPendingCount } from '../socketEmitter.js';

const router = Router();
router.use(authMiddleware);

// All approval routes are super-admin only
function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Réservé au super-administrateur' });
  }
  next();
}
router.use(requireSuperAdmin);

/**
 * GET /api/admin/approvals/count
 * Returns the count of pending approvals (for badge display).
 */
router.get('/count', (req, res) => {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE approval_status = 'pending'").get();
  res.json({ count: row?.cnt ?? 0 });
});

/**
 * GET /api/admin/approvals?status=pending|rejected|all
 * Returns users filtered by approval_status, with team info.
 */
router.get('/', (req, res) => {
  const statusFilter = req.query.status || 'pending';

  let whereClause;
  const params = [];
  if (statusFilter === 'all') {
    whereClause = "WHERE u.approval_status IN ('pending', 'rejected')";
  } else if (statusFilter === 'rejected') {
    whereClause = "WHERE u.approval_status = 'rejected'";
  } else {
    whereClause = "WHERE u.approval_status = 'pending'";
  }

  const sql = `
    SELECT u.id, u.first_name, u.last_name, u.email, u.team_id,
           u.approval_status, u.created_at, u.rejected_reason,
           t.name AS team_name, t.code AS team_code
    FROM users u
    LEFT JOIN teams t ON t.id = u.team_id
    ${whereClause}
    ORDER BY u.created_at DESC
  `;

  const rows = db.prepare(sql).all(...params);

  res.json(rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    teamId: r.team_id,
    teamName: r.team_name,
    teamCode: r.team_code,
    approvalStatus: r.approval_status,
    rejectedReason: r.rejected_reason,
    createdAt: r.created_at,
  })));
});

/**
 * POST /api/admin/approvals/approve
 * Body: { userIds: [1, 2, 3] }
 * Bulk approve users.
 */
router.post('/approve', (req, res) => {
  const { userIds } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds requis (tableau non vide)' });
  }

  const placeholders = userIds.map(() => '?').join(',');
  const now = new Date().toISOString();

  // Only approve users that are currently pending (strict transition: pending → approved)
  const stmt = db.prepare(`
    UPDATE users
    SET approval_status = '${APPROVAL_STATUS.APPROVED}',
        approved_at = ?,
        approved_by = ?,
        rejected_at = NULL,
        rejected_by = NULL,
        rejected_reason = NULL
    WHERE id IN (${placeholders})
      AND approval_status = '${APPROVAL_STATUS.PENDING}'
  `);

  const result = stmt.run(now, req.user.id, ...userIds);

  // Audit log
  logAudit({
    actor: req.user,
    actionType: 'USER_APPROVED',
    target: null,
    targetTeam: null,
    metadata: { userIds, approvedCount: result.changes },
  });

  // Send approval emails to each approved user (async, non-blocking)
  if (result.changes > 0) {
    const approvedUsers = db.prepare(
      `SELECT id, first_name, last_name, email FROM users WHERE id IN (${placeholders}) AND approval_status = 'approved'`
    ).all(...userIds);

    for (const u of approvedUsers) {
      const { subject, html } = accountApprovedEmail({ firstName: u.first_name, lastName: u.last_name });
      sendMail({ to: u.email, subject, html }).catch((err) =>
        console.error(`[Approvals] Failed to send approval email to ${u.email}:`, err.message)
      );
    }

    // Update pending count badge for super-admin
    notifyPendingCount();
  }

  res.json({ ok: true, approvedCount: result.changes });
});

/**
 * POST /api/admin/approvals/reject
 * Body: { userIds: [1, 2, 3], reason?: string }
 * Bulk reject users.
 */
router.post('/reject', (req, res) => {
  const { userIds, reason } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds requis (tableau non vide)' });
  }

  const placeholders = userIds.map(() => '?').join(',');
  const now = new Date().toISOString();
  const rejectedReason = reason?.trim() || null;

  // Only reject users that are currently pending (strict transition: pending → rejected)
  const stmt = db.prepare(`
    UPDATE users
    SET approval_status = '${APPROVAL_STATUS.REJECTED}',
        rejected_at = ?,
        rejected_by = ?,
        rejected_reason = ?,
        approved_at = NULL,
        approved_by = NULL
    WHERE id IN (${placeholders})
      AND approval_status = '${APPROVAL_STATUS.PENDING}'
  `);

  const result = stmt.run(now, req.user.id, rejectedReason, ...userIds);

  // Audit log
  logAudit({
    actor: req.user,
    actionType: 'USER_REJECTED',
    target: null,
    targetTeam: null,
    metadata: { userIds, rejectedCount: result.changes, reason: rejectedReason },
  });

  // Send rejection emails (async, non-blocking)
  if (result.changes > 0) {
    const rejectedUsers = db.prepare(
      `SELECT id, first_name, last_name, email FROM users WHERE id IN (${placeholders}) AND approval_status = 'rejected'`
    ).all(...userIds);

    for (const u of rejectedUsers) {
      const { subject, html } = accountRejectedEmail({
        firstName: u.first_name,
        lastName: u.last_name,
        reason: rejectedReason,
      });
      sendMail({ to: u.email, subject, html }).catch((err) =>
        console.error(`[Approvals] Failed to send rejection email to ${u.email}:`, err.message)
      );
    }

    // Update pending count badge for super-admin
    notifyPendingCount();
  }

  res.json({ ok: true, rejectedCount: result.changes });
});

export default router;
