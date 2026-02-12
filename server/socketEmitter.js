import db from './db.js';
import { getAllStatuses } from './status.js';
import { getTeamCapacity, getOnBreakCount, getAllTeamCapacities } from './teamCapacity.js';
import { getOnlineUserIds } from './presence.js';
import { getPendingApprovalsCount } from './services/adminNotifier.js';

let ioRef = null;

export function setIo(io) {
  ioRef = io;
}

/**
 * Notify all connected clients about team status updates.
 * - Each team room receives only its own team's statuses.
 * - The 'superadmin' room receives all statuses (global view).
 * - Also emits capacity data alongside team updates.
 */
export function notifyTeamUpdate() {
  if (!ioRef) return;

  // Get all unique team IDs
  const teamRows = db.prepare('SELECT DISTINCT id FROM teams').all();
  const teamIds = teamRows.map((r) => r.id);

  // Emit per-team updates
  for (const teamId of teamIds) {
    const teamStatuses = getAllStatuses(teamId);
    ioRef.to(`team:${teamId}`).emit('team', teamStatuses);

    // Also emit capacity data for that team
    const cap = getTeamCapacity(teamId);
    const onBreak = getOnBreakCount(teamId);
    ioRef.to(`team:${teamId}`).emit('teamCapacity', {
      teamId,
      breakCapacity: cap,
      onBreakNow: onBreak,
    });
  }

  // Also broadcast all statuses to the superadmin room
  const allStatuses = getAllStatuses(null);
  ioRef.to('superadmin').emit('team', allStatuses);

  // Broadcast all capacities to superadmin
  ioRef.to('superadmin').emit('teamCapacity', { teams: getAllTeamCapacities() });

  // Broadcast online presence so dashboards can filter immediately
  const onlineUserIds = getOnlineUserIds();
  ioRef.emit('onlinePresence', { onlineUserIds });
}

/**
 * Notify Super-Admin sockets of the current pending approvals count.
 * Emitted as 'pendingApprovals' event to the 'superadmin' room.
 */
export function notifyPendingCount() {
  if (!ioRef) return;
  const count = getPendingApprovalsCount();
  ioRef.to('superadmin').emit('pendingApprovals', { count });
}

/**
 * Notify clients when capacity settings change (admin/super-admin edit).
 * @param {number} teamId - The team whose capacity changed
 */
export function notifyCapacityUpdate(teamId) {
  if (!ioRef) return;

  const cap = getTeamCapacity(teamId);
  const onBreak = getOnBreakCount(teamId);

  // Notify the specific team room
  ioRef.to(`team:${teamId}`).emit('teamCapacity', {
    teamId,
    breakCapacity: cap,
    onBreakNow: onBreak,
  });

  // Notify superadmin with all capacities
  ioRef.to('superadmin').emit('teamCapacity', { teams: getAllTeamCapacities() });
}
