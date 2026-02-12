import db from './db.js';

/**
 * Get the break capacity for a team.
 * Returns the configured value, or 2 as default.
 */
export function getTeamCapacity(teamId) {
  const row = db.prepare('SELECT break_capacity FROM team_settings WHERE team_id = ?').get(teamId);
  return row?.break_capacity ?? 2;
}

/**
 * Count how many users in a team are currently on break.
 */
export function getOnBreakCount(teamId) {
  const row = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM status s
    JOIN users u ON u.id = s.user_id
    WHERE u.team_id = ? AND s.status = 'break' AND u.approval_status = 'approved'
  `).get(teamId);
  return row?.cnt ?? 0;
}

/**
 * Set break capacity for a team.
 */
export function setBreakCapacity(teamId, capacity) {
  db.prepare(`
    INSERT INTO team_settings (team_id, break_capacity, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(team_id) DO UPDATE SET break_capacity = ?, updated_at = datetime('now')
  `).run(teamId, capacity, capacity);
}

/**
 * Get capacities and current on-break counts for all teams.
 */
export function getAllTeamCapacities(includeArchived = false) {
  const sql = includeArchived
    ? 'SELECT id, name, is_active FROM teams ORDER BY name'
    : 'SELECT id, name, is_active FROM teams WHERE is_active = 1 ORDER BY name';
  const teams = db.prepare(sql).all();
  return teams.map((t) => {
    const cap = getTeamCapacity(t.id);
    const onBreak = getOnBreakCount(t.id);
    return { teamId: t.id, teamName: t.name, breakCapacity: cap, onBreakNow: onBreak, isActive: !!t.is_active };
  });
}
