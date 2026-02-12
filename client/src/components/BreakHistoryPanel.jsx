import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import './BreakHistoryPanel.css';

const API = '/api';

/** Daily break limit in minutes — employees exceeding this are highlighted */
const DAILY_BREAK_LIMIT_MIN = 43;
const DAILY_BREAK_LIMIT_SEC = DAILY_BREAK_LIMIT_MIN * 60;

/* ── helpers ── */

function toDateStr(d) { return d.toISOString().slice(0, 10); }

function getMonday(d) {
  const dt = new Date(d);
  const day = dt.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return dt;
}

function fmtDuration(sec) {
  if (sec == null) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  return `${m}min ${String(s).padStart(2, '0')}s`;
}

function fmtTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
}

/* ── component ── */

export default function BreakHistoryPanel({ getToken, isSuperAdmin, teams }) {
  const { t } = useLanguage();

  // View mode
  const [view, setView] = useState('day'); // 'day' | 'week'

  // Filters
  const today = toDateStr(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [teamFilter, setTeamFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');

  // Data
  const [sessions, setSessions] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Accordion state for day view
  const [expandedDays, setExpandedDays] = useState({});

  // Week detail drill-down (userId clicked in week view)
  const [weekDetailUser, setWeekDetailUser] = useState(null);
  const [weekDetailSessions, setWeekDetailSessions] = useState([]);

  /* ── Quick date ranges ── */
  const setRange = (key) => {
    const now = new Date();
    if (key === 'today') {
      setFrom(today); setTo(today);
    } else if (key === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const ys = toDateStr(y);
      setFrom(ys); setTo(ys);
    } else if (key === 'thisWeek') {
      const mon = getMonday(now);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      setFrom(toDateStr(mon)); setTo(toDateStr(sun));
    } else if (key === 'lastWeek') {
      const mon = getMonday(now); mon.setDate(mon.getDate() - 7);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      setFrom(toDateStr(mon)); setTo(toDateStr(sun));
    }
  };

  /* ── Fetch sessions (day view) ── */
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ from, to });
      if (teamFilter) params.set('teamId', teamFilter);
      if (userFilter) params.set('userId', userFilter);
      const res = await fetch(`${API}/admin/break-sessions?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Erreur ${res.status}`);
        setSessions([]);
        return;
      }
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
      // Auto-expand first day
      if (data.length > 0) {
        const firstDay = data[0].startedAt?.slice(0, 10);
        if (firstDay) setExpandedDays({ [firstDay]: true });
      }
    } catch (err) {
      console.error('[BreakHistory] fetch error:', err);
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, [getToken, from, to, teamFilter, userFilter]);

  /* ── Fetch summary (week view) ── */
  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ from, to });
      if (teamFilter) params.set('teamId', teamFilter);
      const res = await fetch(`${API}/admin/break-summary?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Erreur ${res.status}`);
        setSummary([]);
        return;
      }
      const data = await res.json();
      setSummary(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[BreakHistory] summary error:', err);
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, [getToken, from, to, teamFilter]);

  /* ── Load data on filter / view change ── */
  useEffect(() => {
    if (view === 'day') fetchSessions();
    else fetchSummary();
  }, [view, fetchSessions, fetchSummary]);

  /* ── Week detail drill-down ── */
  const handleWeekUserClick = async (userId) => {
    if (weekDetailUser === userId) { setWeekDetailUser(null); return; }
    setWeekDetailUser(userId);
    try {
      const params = new URLSearchParams({ from, to, userId: String(userId) });
      if (teamFilter) params.set('teamId', teamFilter);
      const res = await fetch(`${API}/admin/break-sessions?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWeekDetailSessions(Array.isArray(data) ? data : []);
      }
    } catch { /* silent */ }
  };

  /* ── Group sessions by day ── */
  const dayGroups = {};
  sessions.forEach((s) => {
    const day = s.startedAt?.slice(0, 10) || 'unknown';
    if (!dayGroups[day]) dayGroups[day] = [];
    dayGroups[day].push(s);
  });
  const sortedDays = Object.keys(dayGroups).sort((a, b) => b.localeCompare(a));

  const toggleDay = (day) => setExpandedDays((prev) => ({ ...prev, [day]: !prev[day] }));

  /* ── Compute per-user per-day totals for daily limit check ── */
  // Key: "day:userId" → total completed duration in seconds
  const userDayTotals = {};
  sessions.forEach((s) => {
    const day = s.startedAt?.slice(0, 10) || 'unknown';
    const key = `${day}:${s.userId}`;
    userDayTotals[key] = (userDayTotals[key] ?? 0) + (s.durationSeconds ?? 0);
  });

  /** Returns true if this user exceeded the daily break limit on this day */
  const isOverDailyLimit = (day, userId) => {
    return (userDayTotals[`${day}:${userId}`] ?? 0) > DAILY_BREAK_LIMIT_SEC;
  };

  /* ── Collect unique users from sessions for the user filter dropdown ── */
  const uniqueUsers = {};
  sessions.forEach((s) => { uniqueUsers[s.userId] = `${s.firstName} ${s.lastName}`; });
  summary.forEach((s) => { uniqueUsers[s.userId] = `${s.firstName} ${s.lastName}`; });

  return (
    <div className="bh-panel">
      {/* ── Controls ── */}
      <div className="bh-controls">
        <div className="bh-view-toggle">
          <button type="button" className={`bh-view-btn${view === 'day' ? ' bh-view-active' : ''}`} onClick={() => setView('day')}>
            {t('history.viewDay')}
          </button>
          <button type="button" className={`bh-view-btn${view === 'week' ? ' bh-view-active' : ''}`} onClick={() => setView('week')}>
            {t('history.viewWeek')}
          </button>
        </div>

        <div className="bh-quick-ranges">
          {['today', 'yesterday', 'thisWeek', 'lastWeek'].map((k) => (
            <button key={k} type="button" className="bh-quick-btn" onClick={() => setRange(k)}>
              {t(`history.${k}`)}
            </button>
          ))}
        </div>

        <div className="bh-filters">
          <label className="bh-filter">
            {t('history.from')}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bh-date-input" />
          </label>
          <label className="bh-filter">
            {t('history.to')}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bh-date-input" />
          </label>

          {isSuperAdmin && teams && teams.length > 0 && (
            <label className="bh-filter">
              {t('history.team')}
              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="bh-select">
                <option value="">{t('history.allTeams')}</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>{tm.name}</option>
                ))}
              </select>
            </label>
          )}

          {view === 'day' && (
            <label className="bh-filter">
              {t('history.employee')}
              <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="bh-select">
                <option value="">{t('history.allEmployees')}</option>
                {Object.entries(uniqueUsers).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {error && <p className="bh-error">{error}</p>}
      {loading && <p className="bh-loading">{t('history.loading')}</p>}

      {/* ── Day view ── */}
      {!loading && view === 'day' && (
        <div className="bh-day-view">
          {sortedDays.length === 0 && !error && (
            <p className="bh-empty">{t('history.noSessions')}</p>
          )}
          {sortedDays.map((day) => {
            const daySessions = dayGroups[day];
            const dayTotal = daySessions.reduce((acc, s) => acc + (s.durationSeconds ?? 0), 0);
            const isExpanded = !!expandedDays[day];
            // Check if any user exceeded the daily limit on this day
            const dayHasOverLimit = daySessions.some((s) => isOverDailyLimit(day, s.userId));
            return (
              <div key={day} className={`bh-day-group${dayHasOverLimit ? ' bh-day-group-warn' : ''}`}>
                <button type="button" className="bh-day-header" onClick={() => toggleDay(day)} aria-expanded={isExpanded}>
                  <span className="bh-day-arrow">{isExpanded ? '▾' : '▸'}</span>
                  <span className="bh-day-date">
                    {dayHasOverLimit && <span className="bh-warn-icon" title={t('history.overLimitTooltip')}>⚠️</span>}
                    {fmtDate(day + 'T12:00:00Z')}
                  </span>
                  <span className="bh-day-count">{daySessions.length} pause{daySessions.length > 1 ? 's' : ''}</span>
                  <span className={`bh-day-total${dayHasOverLimit ? ' bh-day-total-warn' : ''}`}>{t('history.totalDay')}: {fmtDuration(dayTotal)}</span>
                </button>
                {isExpanded && (
                  <table className="bh-table">
                    <thead>
                      <tr>
                        <th>{t('history.employee')}</th>
                        {isSuperAdmin && <th>{t('history.team')}</th>}
                        <th>{t('history.startTime')}</th>
                        <th>{t('history.endTime')}</th>
                        <th>{t('history.duration')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daySessions.map((s) => {
                        const over = isOverDailyLimit(day, s.userId);
                        return (
                          <tr key={s.id} className={over ? 'bh-row-overlimit' : ''}>
                            <td className="bh-cell-name">
                              {over && <span className="bh-warn-icon" title={t('history.overLimitTooltip')}>⚠️</span>}
                              {s.firstName} {s.lastName}
                            </td>
                            {isSuperAdmin && <td className="bh-cell-team">{s.teamName || '–'}</td>}
                            <td>{fmtTime(s.startedAt)}</td>
                            <td>{s.endedAt ? fmtTime(s.endedAt) : <span className="bh-ongoing">{t('history.ongoing')}</span>}</td>
                            <td className="bh-cell-dur">{s.durationSeconds != null ? fmtDuration(s.durationSeconds) : <span className="bh-ongoing">{t('history.ongoing')}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Week view ── */}
      {!loading && view === 'week' && (
        <div className="bh-week-view">
          {summary.length === 0 && !error && (
            <p className="bh-empty">{t('history.noSessions')}</p>
          )}
          {summary.length > 0 && (
            <table className="bh-table bh-summary-table">
              <thead>
                <tr>
                  <th>{t('history.employee')}</th>
                  {isSuperAdmin && <th>{t('history.team')}</th>}
                  <th>{t('history.totalWeek')}</th>
                  <th>{t('history.sessionCount')}</th>
                  <th>{t('history.avgDuration')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <>
                    <tr key={s.userId} className="bh-summary-row" onClick={() => handleWeekUserClick(s.userId)} style={{ cursor: 'pointer' }} title="Cliquer pour voir le détail">
                      <td className="bh-cell-name">{s.firstName} {s.lastName}</td>
                      {isSuperAdmin && <td className="bh-cell-team">{s.teamName || '–'}</td>}
                      <td className="bh-cell-dur">{fmtDuration(s.totalSeconds)}</td>
                      <td>{s.sessionCount}</td>
                      <td>{fmtDuration(s.avgSeconds)}</td>
                    </tr>
                    {weekDetailUser === s.userId && weekDetailSessions.length > 0 && (
                      <tr key={`${s.userId}-detail`} className="bh-detail-row">
                        <td colSpan={isSuperAdmin ? 5 : 4}>
                          <table className="bh-table bh-inner-table">
                            <thead>
                              <tr>
                                <th>{t('history.startTime')}</th>
                                <th>{t('history.endTime')}</th>
                                <th>{t('history.duration')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {weekDetailSessions.map((ws) => (
                                <tr key={ws.id}>
                                  <td>{fmtTime(ws.startedAt)} — {fmtDate(ws.startedAt)}</td>
                                  <td>{ws.endedAt ? fmtTime(ws.endedAt) : <span className="bh-ongoing">{t('history.ongoing')}</span>}</td>
                                  <td className="bh-cell-dur">{ws.durationSeconds != null ? fmtDuration(ws.durationSeconds) : <span className="bh-ongoing">{t('history.ongoing')}</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
