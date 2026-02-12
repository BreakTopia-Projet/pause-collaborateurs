import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SUPER_ADMIN_EMAIL } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, 'pause.db');

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);
// Migrations for existing teams tables
try { db.exec("ALTER TABLE teams ADD COLUMN code TEXT;"); } catch {}
try { db.exec("ALTER TABLE teams ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;"); } catch {}
// SQLite ALTER TABLE ADD COLUMN requires constant DEFAULT — use NULL then backfill
try { db.exec("ALTER TABLE teams ADD COLUMN created_at TEXT DEFAULT NULL;"); } catch {}
try { db.exec("ALTER TABLE teams ADD COLUMN updated_at TEXT DEFAULT NULL;"); } catch {}
// Backfill NULL timestamps with current time
db.prepare("UPDATE teams SET created_at = datetime('now') WHERE created_at IS NULL").run();
db.prepare("UPDATE teams SET updated_at = datetime('now') WHERE updated_at IS NULL").run();
// Backfill: set code = name for rows where code is NULL
db.prepare("UPDATE teams SET code = name WHERE code IS NULL").run();
// Create unique index on code (if not exists)
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_code ON teams(code);"); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    preferred_language TEXT NOT NULL DEFAULT 'fr',
    role TEXT NOT NULL DEFAULT 'user',
    team_id INTEGER REFERENCES teams(id),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
// Migrations for existing DBs (columns already present in CREATE above for new installs)
try {
  db.exec(`ALTER TABLE users ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'fr';`);
} catch {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';`);
} catch {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN team_id INTEGER REFERENCES teams(id);`);
} catch {}
// Column for token invalidation: tokens issued before this timestamp are rejected
try {
  db.exec(`ALTER TABLE users ADD COLUMN tokens_invalid_before TEXT DEFAULT NULL;`);
} catch {}
// last_seen_at — updated on every presence ping and on disconnect
try { db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT DEFAULT NULL;"); } catch {}

// Approval workflow columns
try { db.exec("ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN approved_at TEXT DEFAULT NULL;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN approved_by INTEGER DEFAULT NULL;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN rejected_at TEXT DEFAULT NULL;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN rejected_by INTEGER DEFAULT NULL;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN rejected_reason TEXT DEFAULT NULL;"); } catch {}

// ── Normalize emails to lowercase (case-insensitive login) ──
{
  const fixed = db.prepare(`
    UPDATE users SET email = LOWER(email) WHERE email != LOWER(email)
  `).run();
  if (fixed.changes > 0) {
    console.log(`[DB] Backfill: normalized ${fixed.changes} emails to lowercase`);
  }
}

// ── Robust backfill for approval_status ──
// 1) First migration: if NO user is approved, approve ALL existing users
//    (they were created before the approval feature existed)
{
  const approvedCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE approval_status = 'approved'").get().cnt;
  if (approvedCount === 0) {
    const backfilled = db.prepare("UPDATE users SET approval_status = 'approved', approved_at = datetime('now')").run();
    console.log(`[DB] Backfill: approved ${backfilled.changes} existing users (first migration)`);
  }
}
// 2) Ongoing safety: admin/superadmin roles MUST always be approved
//    (prevents lockout if role was assigned after a pending registration)
{
  const fixed = db.prepare(`
    UPDATE users SET approval_status = 'approved', approved_at = COALESCE(approved_at, datetime('now'))
    WHERE role IN ('admin', 'superadmin') AND approval_status != 'approved'
  `).run();
  if (fixed.changes > 0) {
    console.log(`[DB] Backfill: auto-approved ${fixed.changes} admin/superadmin users`);
  }
}
// 3) Auto-heal NULL approval_status (defensive: should not happen, but covers edge cases)
{
  const healed = db.prepare(`
    UPDATE users SET approval_status = 'approved', approved_at = datetime('now')
    WHERE approval_status IS NULL OR approval_status = ''
  `).run();
  if (healed.changes > 0) {
    console.log(`[DB] Backfill: healed ${healed.changes} users with NULL/empty approval_status`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS status (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('working', 'break', 'offline')),
    status_changed_at TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_status_status ON status(status);
`);
// Migration: add 'offline' to existing CHECK constraint (SQLite requires table rebuild)
// Test with a real INSERT then rollback to detect old constraint
{
  let needsMigration = false;
  try {
    db.exec("BEGIN; INSERT INTO status (user_id, status, status_changed_at) VALUES (-999999, 'offline', datetime('now')); ROLLBACK;");
  } catch {
    needsMigration = true;
    try { db.exec("ROLLBACK;"); } catch {}
  }
  if (needsMigration) {
    db.exec(`
      CREATE TABLE status_new (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('working', 'break', 'offline')),
        status_changed_at TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO status_new SELECT * FROM status;
      DROP TABLE status;
      ALTER TABLE status_new RENAME TO status;
      CREATE INDEX IF NOT EXISTS idx_status_status ON status(status);
    `);
    console.log('[DB] Migrated status table: added offline to CHECK constraint');
  }
}
// ── Create break_logs table BEFORE any query that references it ──
db.exec(`
  CREATE TABLE IF NOT EXISTS break_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_break_logs_user_started ON break_logs(user_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_break_logs_started ON break_logs(started_at);
`);
console.log('[DB] break_logs table ensured');

// ── Server startup: set all users offline + close any dangling break sessions ──
// On server restart, no users are connected — they'll come back online via ping.
// IMPORTANT: Use JS ISO string (with 'Z') instead of SQLite datetime('now') (no 'Z')
// to avoid timezone mismatch when JS later parses these dates.
{
  const nowISO = new Date().toISOString();
  db.prepare("UPDATE break_logs SET ended_at = ? WHERE ended_at IS NULL").run(nowISO);
  db.prepare("UPDATE status SET status = 'offline', status_changed_at = ?, updated_at = ? WHERE status != 'offline'").run(nowISO, nowISO);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    actor_email TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_user_id INTEGER,
    target_email TEXT,
    target_team TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action_type);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_target_team ON audit_logs(target_team);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS team_settings (
    team_id INTEGER PRIMARY KEY REFERENCES teams(id),
    break_capacity INTEGER NOT NULL DEFAULT 2,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Performance indexes ──
try { db.exec("CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_users_approval_status ON users(approval_status);"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_break_logs_ended ON break_logs(ended_at);"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);"); } catch {}

// Seed default app settings
const defaultAppSettings = { pauseProlongeeMinutes: '20' };
for (const [k, v] of Object.entries(defaultAppSettings)) {
  const exists = db.prepare('SELECT key FROM app_settings WHERE key = ?').get(k);
  if (!exists) {
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(k, v);
  }
}

// Ensure required teams exist (including the default fallback team)
const REQUIRED_TEAMS = [
  { code: 'DMC-MM1', name: 'DMC-MM1' },
  { code: 'DMC-MM2', name: 'DMC-MM2' },
  { code: 'DMC-MM3', name: 'DMC-MM3' },
  { code: 'DEFAULT', name: 'Équipe par défaut' },
];
for (const team of REQUIRED_TEAMS) {
  // Try matching by code first, then fall back to name (for legacy DBs before code existed)
  const exists = db.prepare('SELECT id FROM teams WHERE code = ? OR name = ?').get(team.code, team.name);
  if (!exists) {
    db.prepare('INSERT INTO teams (name, code) VALUES (?, ?)').run(team.name, team.code);
  }
}
// Legacy: ensure at least one team exists as fallback (id=1 may be "Équipe par défaut" from earlier installs)
const anyTeam = db.prepare('SELECT id FROM teams ORDER BY id LIMIT 1').get();
const fallbackTeamId = anyTeam?.id ?? 1;
// Assign orphan users to the first available team
db.prepare('UPDATE users SET team_id = ? WHERE team_id IS NULL').run(fallbackTeamId);
// Also reassign users whose team_id references a deleted team
db.prepare(`
  UPDATE users SET team_id = ?
  WHERE team_id NOT IN (SELECT id FROM teams)
`).run(fallbackTeamId);

// Seed default break capacity (2) for all teams that don't have settings yet
const allTeamRows = db.prepare('SELECT id FROM teams').all();
for (const tr of allTeamRows) {
  const hasSetting = db.prepare('SELECT team_id FROM team_settings WHERE team_id = ?').get(tr.id);
  if (!hasSetting) {
    db.prepare('INSERT INTO team_settings (team_id, break_capacity) VALUES (?, 2)').run(tr.id);
  }
}

// Enforce superadmin role based on SUPER_ADMIN_EMAIL at startup.
// This handles the case where the DB already has the super-admin account
// but its role was tampered with or not yet set.
const superUser = db.prepare('SELECT id, role, approval_status FROM users WHERE LOWER(email) = LOWER(?)').get(SUPER_ADMIN_EMAIL);
if (superUser && superUser.role !== 'superadmin') {
  db.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").run(superUser.id);
}
// Ensure super-admin is always approved
if (superUser && superUser.approval_status !== 'approved') {
  db.prepare("UPDATE users SET approval_status = 'approved', approved_at = datetime('now') WHERE id = ?").run(superUser.id);
}
// Revoke any stale superadmin that doesn't match the configured email
db.prepare("UPDATE users SET role = 'user' WHERE role = 'superadmin' AND LOWER(email) != LOWER(?)").run(SUPER_ADMIN_EMAIL);

export default db;
