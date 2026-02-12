import { Router } from 'express';
import { createUser, getUserByEmail, verifyPassword, createToken, authMiddleware, updateUserPreferredLanguage, ensureSuperAdminRole, hashPassword, isSuperAdminEmail } from '../auth.js';
import db from '../db.js';
import { APPROVAL_STATUS, APPROVAL_ERROR_CODES } from '../../shared/approvalStatus.js';
import { sendMail } from '../services/mailService.js';
import { registrationPendingEmail } from '../services/emailTemplates.js';
import { queuePendingNotification } from '../services/adminNotifier.js';
import { notifyPendingCount } from '../socketEmitter.js';

const router = Router();

function toUserPayload(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    preferredLanguage: user.preferred_language || 'fr',
    role: user.role || 'user',
    teamId: user.team_id ?? null,
  };
}

router.post('/register', (req, res) => {
  const { email: rawEmail, password, firstName, lastName, preferredLanguage, teamCode } = req.body;
  const email = rawEmail?.trim().toLowerCase();
  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'Email, mot de passe, prénom et nom requis' });
  }

  // teamCode is REQUIRED — normalize: trim + uppercase
  if (!teamCode || !teamCode.trim()) {
    return res.status(400).json({ error: 'Code d\'équipe requis', errorCode: 'TEAM_CODE_MISSING' });
  }
  const normalizedCode = teamCode.trim().toUpperCase().replace(/\s+/g, ' ');

  // Look up the team by code (case-insensitive, active only)
  const team = db.prepare(
    'SELECT id, name, code, is_active FROM teams WHERE UPPER(code) = ? AND is_active = 1'
  ).get(normalizedCode);

  if (!team) {
    return res.status(400).json({ error: 'Code d\'équipe invalide ou équipe inactive', errorCode: 'TEAM_CODE_INVALID' });
  }

  if (getUserByEmail(email)) {
    return res.status(409).json({ error: 'Cet email est déjà utilisé' });
  }

  // Server decides team_id — any teamId/team field in the body is ignored
  let user = createUser(email, password, firstName, lastName, preferredLanguage, team.id);
  user = ensureSuperAdminRole(user);

  // Approval workflow: super-admin email is auto-approved, others are pending
  if (isSuperAdminEmail(email)) {
    db.prepare(`UPDATE users SET approval_status = '${APPROVAL_STATUS.APPROVED}', approved_at = datetime('now') WHERE id = ?`).run(user.id);
    const token = createToken(user);
    res.status(201).json({ user: toUserPayload(user), token });
  } else {
    // User stays pending — do NOT issue a token
    db.prepare(`UPDATE users SET approval_status = '${APPROVAL_STATUS.PENDING}' WHERE id = ?`).run(user.id);

    // Send "registration pending" email to user (async, non-blocking)
    const { subject, html } = registrationPendingEmail({ firstName, lastName });
    sendMail({ to: email, subject, html }).catch((err) =>
      console.error('[Auth] Failed to send registration email:', err.message)
    );

    // Queue Super-Admin digest notification (batched with cooldown)
    queuePendingNotification({
      firstName,
      lastName,
      email,
      teamCode: normalizedCode,
    });

    // Notify connected Super-Admins via socket (badge update)
    notifyPendingCount();

    res.status(201).json({
      pending: true,
      message: 'Compte créé avec succès. En attente d\'approbation par un administrateur.',
    });
  }
});

router.post('/login', (req, res) => {
  const { email: rawEmail, password } = req.body;
  const email = rawEmail?.trim().toLowerCase();
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }
  let user = getUserByEmail(email);

  // Step 1: Verify credentials (always check password first)
  if (!user || !verifyPassword(password, user.password_hash)) {
    console.log('[AUTH/login] FAIL bad_credentials', { email });
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  // Step 2: Auto-heal NULL/empty approval_status → treat as approved (legacy users)
  if (!user.approval_status || user.approval_status === '') {
    db.prepare("UPDATE users SET approval_status = 'approved', approved_at = COALESCE(approved_at, datetime('now')) WHERE id = ?").run(user.id);
    user.approval_status = APPROVAL_STATUS.APPROVED;
    console.log('[AUTH/login] auto-healed NULL approval_status → approved', { email, userId: user.id });
  }

  // Step 3: Admin/superadmin are ALWAYS approved (prevents lockout)
  if ((user.role === 'admin' || user.role === 'superadmin') && user.approval_status !== APPROVAL_STATUS.APPROVED) {
    db.prepare("UPDATE users SET approval_status = 'approved', approved_at = COALESCE(approved_at, datetime('now')) WHERE id = ?").run(user.id);
    user.approval_status = APPROVAL_STATUS.APPROVED;
    console.log('[AUTH/login] auto-approved admin/superadmin', { email, role: user.role, userId: user.id });
  }

  // Step 4: Approval check — block pending / rejected regular users
  if (user.approval_status === APPROVAL_STATUS.PENDING) {
    console.log('[AUTH/login] BLOCKED pending_approval', { email, userId: user.id });
    return res.status(403).json({
      error: 'Votre compte est en attente d\'approbation.',
      errorCode: APPROVAL_ERROR_CODES.PENDING,
    });
  }
  if (user.approval_status === APPROVAL_STATUS.REJECTED) {
    console.log('[AUTH/login] BLOCKED rejected', { email, userId: user.id });
    return res.status(403).json({
      error: 'Votre compte a été refusé.',
      errorCode: APPROVAL_ERROR_CODES.REJECTED,
    });
  }

  user = ensureSuperAdminRole(user);
  const token = createToken(user);
  const payload = toUserPayload(user);
  console.log('[AUTH/login] OK', { email: payload.email, role: payload.role, teamId: payload.teamId });
  res.json({ user: payload, token });
});

/** Change own password. Requires currentPassword + newPassword. */
router.patch('/me/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
  }
  const full = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!full || !verifyPassword(currentPassword, full.password_hash)) {
    return res.status(403).json({ error: 'Mot de passe actuel incorrect' });
  }
  const hash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

/** GET /auth/me — returns fresh user profile from DB. Used by frontend to refresh stale localStorage. */
router.get('/me', authMiddleware, (req, res) => {
  const payload = toUserPayload(req.user);
  console.log('[AUTH/me]', { email: payload.email, role: payload.role, teamId: payload.teamId });
  res.json({ user: payload });
});

router.patch('/profile', authMiddleware, (req, res) => {
  const { preferredLanguage } = req.body;
  if (preferredLanguage == null) {
    return res.status(400).json({ error: 'preferredLanguage requis' });
  }
  const updated = updateUserPreferredLanguage(req.user.id, preferredLanguage);
  res.json({ user: toUserPayload(updated) });
});

export default router;
