/**
 * Shared approval status constants and utilities.
 * Used by both backend (server/) and frontend (client/).
 */

export const APPROVAL_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/** All valid approval statuses */
export const APPROVAL_STATUSES = Object.freeze(
  Object.values(APPROVAL_STATUS)
);

/** Allowed transitions: { fromStatus: [toStatus, ...] } */
export const APPROVAL_TRANSITIONS = Object.freeze({
  [APPROVAL_STATUS.PENDING]: [APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED],
  // No transitions allowed from approved or rejected
});

/**
 * Returns true if the user's approval_status is 'approved'.
 * @param {object|string} userOrStatus - User object with approval_status, or status string
 * @returns {boolean}
 */
export function isUserApproved(userOrStatus) {
  const status = typeof userOrStatus === 'string'
    ? userOrStatus
    : userOrStatus?.approval_status;
  return status === APPROVAL_STATUS.APPROVED;
}

/**
 * Returns true if the transition from currentStatus to newStatus is allowed.
 * @param {string} currentStatus
 * @param {string} newStatus
 * @returns {boolean}
 */
export function isTransitionAllowed(currentStatus, newStatus) {
  const allowed = APPROVAL_TRANSITIONS[currentStatus];
  return Array.isArray(allowed) && allowed.includes(newStatus);
}

/** Error codes returned by the API for approval-related failures */
export const APPROVAL_ERROR_CODES = Object.freeze({
  PENDING: 'APPROVAL_PENDING',
  REJECTED: 'APPROVAL_REJECTED',
  NOT_APPROVED: 'APPROVAL_NOT_APPROVED',
});
