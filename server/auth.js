import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, SUPER_ADMIN_EMAIL } from './config.js';
import db from './db.js';
import { APPROVAL_STATUS, isUserApproved, APPROVAL_ERROR_CODES } from '../shared/approvalStatus.js';

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  const user = db.prepare('SELECT id, email, first_name, last_name, preferred_language, role, team_id, tokens_invalid_before, approval_status FROM users WHERE id = ?').get(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'Utilisateur introuvable' });
  }
  // Check if token was issued before an auto-logout invalidation
  if (user.tokens_invalid_before && payload.iat) {
    const invalidBefore = new Date(user.tokens_invalid_before).getTime() / 1000;
    if (payload.iat < invalidBefore) {
      return res.status(401).json({ error: 'Session expirée (déconnexion automatique)' });
    }
  }
  // Defense in depth: block non-approved users from accessing protected routes
  if (!isUserApproved(user)) {
    return res.status(403).json({ error: 'Compte non approuvé', errorCode: APPROVAL_ERROR_CODES.NOT_APPROVED });
  }
  req.user = user;
  next();
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
}

const VALID_LANGUAGES = ['fr', 'de', 'it', 'en'];

export function createUser(email, password, firstName, lastName, preferredLanguage = 'fr', teamId = 1) {
  const lang = VALID_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'fr';
  const hash = hashPassword(password);
  const tid = teamId == null ? 1 : teamId;
  const normalizedEmail = email.trim().toLowerCase();
  const result = db.prepare(
    'INSERT INTO users (email, password_hash, first_name, last_name, preferred_language, role, team_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(normalizedEmail, hash, firstName, lastName, lang, 'user', tid);
  return db.prepare('SELECT id, email, first_name, last_name, preferred_language, role, team_id FROM users WHERE id = ?').get(result.lastInsertRowid);
}

export function updateUserPreferredLanguage(userId, preferredLanguage) {
  const lang = VALID_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'fr';
  db.prepare('UPDATE users SET preferred_language = ? WHERE id = ?').run(lang, userId);
  return db.prepare('SELECT id, email, first_name, last_name, preferred_language, role, team_id FROM users WHERE id = ?').get(userId);
}

export function getUserById(userId) {
  return db.prepare('SELECT id, email, first_name, last_name, preferred_language, role, team_id FROM users WHERE id = ?').get(userId);
}

export function updateUserProfile(userId, { firstName, lastName, email }) {
  const u = getUserById(userId);
  if (!u) return null;
  if (firstName != null) db.prepare('UPDATE users SET first_name = ? WHERE id = ?').run(firstName, userId);
  if (lastName != null) db.prepare('UPDATE users SET last_name = ? WHERE id = ?').run(lastName, userId);
  if (email != null) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
  return getUserById(userId);
}

export function setUserRole(userId, role) {
  const r = role === 'admin' || role === 'user' ? role : 'user';
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(r, userId);
  return getUserById(userId);
}

/**
 * Vérifie si l'email de l'utilisateur correspond au SUPER_ADMIN_EMAIL.
 * Si oui et que le rôle n'est pas déjà 'superadmin', le met à jour en base.
 * Si non mais que le rôle est 'superadmin', le rétrograde en 'user'
 * (empêche qu'un autre compte conserve le rôle superadmin par erreur).
 * Retourne l'utilisateur à jour.
 */
export function ensureSuperAdminRole(user) {
  if (!user) return user;
  const isSuperEmail = user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

  if (isSuperEmail && user.role !== 'superadmin') {
    db.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").run(user.id);
    return getUserById(user.id);
  }
  if (!isSuperEmail && user.role === 'superadmin') {
    db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(user.id);
    return getUserById(user.id);
  }
  return user;
}

/**
 * Retourne true si l'email donné est celui du super-administrateur.
 */
export function isSuperAdminEmail(email) {
  return email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}
