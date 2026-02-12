#!/usr/bin/env node
/**
 * Reset super-admin password (dev/local use only).
 *
 * Usage:
 *   node server/scripts/resetSuperAdminPassword.js "MyNewPassword123!"
 *
 * Finds the user matching SUPER_ADMIN_EMAIL in the SQLite database
 * and updates the password hash using the same bcrypt method as
 * registration and login.
 */

import { SUPER_ADMIN_EMAIL } from '../config.js';
import { hashPassword } from '../auth.js';
import db from '../db.js';

const newPassword = process.argv[2];

if (!newPassword) {
  console.error('Usage: node server/scripts/resetSuperAdminPassword.js "NewPassword"');
  console.error('');
  console.error('  The new password must be at least 8 characters.');
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error('Error: password must be at least 8 characters.');
  process.exit(1);
}

const user = db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = LOWER(?)').get(SUPER_ADMIN_EMAIL);

if (!user) {
  console.error(`No user found with email: ${SUPER_ADMIN_EMAIL}`);
  console.error('');
  console.error('To create the super-admin account:');
  console.error(`  1. Start the app and register with email: ${SUPER_ADMIN_EMAIL}`);
  console.error('  2. The role "superadmin" will be assigned automatically on login.');
  console.error('  3. Then you can use this script to reset the password if needed.');
  process.exit(1);
}

const hash = hashPassword(newPassword);
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

console.log('');
console.log('Super-admin password reset successfully.');
console.log(`  Email: ${user.email}`);
console.log(`  Role:  ${user.role}`);
console.log('');
console.log('You can now log in with the new password.');
