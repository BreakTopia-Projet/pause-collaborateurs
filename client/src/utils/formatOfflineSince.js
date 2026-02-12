/**
 * Format offline duration for display.
 * @param {number} seconds - seconds since last seen
 * @param {Function} t - translation function
 * @returns {string} e.g. "depuis 40 s", "depuis 12 min", "depuis 1 h 03"
 */
export function formatOfflineSince(seconds, t) {
  if (seconds == null || seconds < 0) return '';
  const prefix = t('offline.since') || 'depuis';
  if (seconds < 60) {
    return `${prefix} ${Math.floor(seconds)} s`;
  }
  if (seconds < 3600) {
    return `${prefix} ${Math.floor(seconds / 60)} min`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${prefix} ${h} h ${String(m).padStart(2, '0')}`;
}

/**
 * Compute seconds since lastSeenAt (ISO string).
 * @param {string|null} lastSeenAt
 * @returns {number|null}
 */
export function getOfflineSinceSeconds(lastSeenAt) {
  if (!lastSeenAt) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000));
}
