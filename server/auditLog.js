import db from './db.js';

const insertStmt = db.prepare(`
  INSERT INTO audit_logs (actor_user_id, actor_email, actor_role, action_type, target_user_id, target_email, target_team, metadata_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

/**
 * Insert an immutable audit log entry.
 *
 * @param {object} params
 * @param {object} params.actor           - The authenticated user performing the action (req.user)
 * @param {string} params.actionType      - e.g. USER_DELETE, ROLE_CHANGE, COUNTER_RESET
 * @param {object} [params.target]        - The user being acted upon (snapshot before mutation)
 * @param {string} [params.targetTeam]    - Team name snapshot of the target
 * @param {object} [params.metadata]      - Extra details (e.g. { oldRole, newRole })
 */
export function logAudit({ actor, actionType, target, targetTeam, metadata }) {
  insertStmt.run(
    actor.id,
    actor.email,
    actor.role,
    actionType,
    target?.id ?? null,
    target?.email ?? null,
    targetTeam ?? null,
    metadata ? JSON.stringify(metadata) : null
  );
}
