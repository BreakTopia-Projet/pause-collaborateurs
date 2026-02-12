/**
 * Sort users for display in team lists.
 *
 * Order:
 *   1. On-break users first, sorted by longest pause duration (descending).
 *   2. Current logged-in user (only if NOT on break and NOT offline).
 *   3. All other working users, sorted alphabetically by last name + first name.
 *   4. Offline users last, sorted alphabetically.
 *
 * If the current user IS on break, they stay in group 1 at their natural position.
 *
 * @param {Array}    users          - Array of user/member objects.
 * @param {number}   currentUserId  - The id of the currently logged-in user.
 * @param {Function} [getElapsed]   - Optional function (user) => seconds. Defaults to user.elapsedSeconds ?? 0.
 * @returns {Array} A new sorted array (does not mutate the input).
 */
export function sortUsersForDisplay(users, currentUserId, getElapsed) {
  return [...users].sort((a, b) => {
    const aGroup = getGroup(a);
    const bGroup = getGroup(b);

    // Group 0 = on break, Group 1 = working, Group 2 = offline
    if (aGroup !== bGroup) return aGroup - bGroup;

    // Within on-break group: longest duration first
    if (aGroup === 0) {
      const aE = getElapsed ? getElapsed(a) : (a.elapsedSeconds ?? 0);
      const bE = getElapsed ? getElapsed(b) : (b.elapsedSeconds ?? 0);
      return bE - aE;
    }

    // Within working group: current user first, then alphabetical
    if (aGroup === 1) {
      const aMe = a.id === currentUserId ? 0 : 1;
      const bMe = b.id === currentUserId ? 0 : 1;
      if (aMe !== bMe) return aMe - bMe;
    }

    // Alphabetical within group
    return getName(a).localeCompare(getName(b));
  });
}

/**
 * Determine the display group of a member.
 * 0 = on break, 1 = working, 2 = offline
 * Supports both `liveStatus` (Admin/SuperAdmin) and `status` (Dashboard) fields.
 */
function getGroup(m) {
  const st = m.liveStatus ?? m.status ?? 'working';
  if (st === 'break' || st === 'extended_break') return 0;
  if (st === 'offline') return 2;
  return 1;
}

/**
 * Determine whether a member is currently on break.
 * Supports both `liveStatus` (Admin/SuperAdmin) and `status` (Dashboard) fields.
 */
export function isOnBreak(m) {
  const st = m.liveStatus ?? m.status ?? 'working';
  return st === 'break' || st === 'extended_break';
}

/** Build a sortable display name string. */
function getName(m) {
  return `${m.lastName ?? ''}${m.firstName ?? ''}`;
}
