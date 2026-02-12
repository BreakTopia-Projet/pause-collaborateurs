import db from './db.js';

/** Durée en secondes entre deux dates ISO (ended_at peut être null = en cours, utiliser now) */
function durationSeconds(startedAt, endedAt, nowIso) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : new Date(nowIso).getTime();
  return Math.max(0, Math.floor((end - start) / 1000));
}

/** Date ISO en YYYY-MM-DD (jour local) */
function toDateKey(iso) {
  const d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Début de la semaine (lundi) pour une date ISO */
function weekStart(iso) {
  const d = new Date(iso);
  const day = d.getDay();
  const diff = d.getDate() - (day === 0 ? 6 : day - 1);
  const m = new Date(d);
  m.setDate(diff);
  m.setHours(0, 0, 0, 0);
  return m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0') + '-' + String(m.getDate()).padStart(2, '0');
}

/**
 * Retourne pour chaque userId : { byDay: { 'YYYY-MM-DD': seconds }, weeklyTotal: seconds }
 * byDay = 7 derniers jours, weeklyTotal = semaine courante (lundi-dimanche)
 */
export function getBreakStatsForUsers(userIds) {
  if (!userIds.length) return {};
  const placeholders = userIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT user_id, started_at, ended_at
    FROM break_logs
    WHERE user_id IN (${placeholders})
    ORDER BY started_at
  `).all(...userIds);

  const now = new Date().toISOString();
  const result = {};
  userIds.forEach((id) => {
    result[id] = { byDay: {}, weeklyTotal: 0 };
  });

  const thisWeekStart = weekStart(now);
  const today = toDateKey(now);

  for (const r of rows) {
    const uid = r.user_id;
    if (!result[uid]) continue;
    const sec = durationSeconds(r.started_at, r.ended_at, now);
    const dayKey = toDateKey(r.started_at);
    result[uid].byDay[dayKey] = (result[uid].byDay[dayKey] || 0) + sec;
    if (weekStart(r.started_at) === thisWeekStart) {
      result[uid].weeklyTotal += sec;
    }
    // Pause encore en cours (ended_at null) : compter aussi pour aujourd'hui et cette semaine si la pause a commencé avant
    if (!r.ended_at) {
      if (dayKey !== today) result[uid].byDay[today] = (result[uid].byDay[today] || 0) + sec;
      if (weekStart(r.started_at) !== thisWeekStart) result[uid].weeklyTotal += sec;
    }
  }

  return result;
}

/** Supprime tous les break_logs d'un utilisateur (reset compteur) */
export function resetBreakLogs(userId) {
  db.prepare('DELETE FROM break_logs WHERE user_id = ?').run(userId);
}
