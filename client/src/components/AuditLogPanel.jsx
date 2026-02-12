import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import './AuditLogPage.css';

const API = '/api';
const ACTION_TYPES = ['USER_DELETE', 'ROLE_CHANGE', 'COUNTER_RESET', 'TEAM_CHANGE', 'USER_APPROVED', 'USER_REJECTED', 'TEAM_UPDATE', 'AUTO_LOGOUT'];

function actionLabel(actionType, t) {
  switch (actionType) {
    case 'USER_DELETE': return t('audit.actionUserDelete');
    case 'ROLE_CHANGE': return t('audit.actionRoleChange');
    case 'COUNTER_RESET': return t('audit.actionCounterReset');
    case 'TEAM_CHANGE': return t('audit.actionTeamChange');
    case 'USER_APPROVED': return t('audit.actionUserApproved');
    case 'USER_REJECTED': return t('audit.actionUserRejected');
    case 'TEAM_UPDATE': return t('audit.actionTeamUpdate');
    case 'AUTO_LOGOUT': return t('audit.actionAutoLogout');
    default: return actionType;
  }
}

function formatDetails(log, t) {
  if (log.actionType === 'ROLE_CHANGE' && log.metadata) {
    return t('audit.roleChange').replace('{old}', log.metadata.oldRole ?? '?').replace('{new}', log.metadata.newRole ?? '?');
  }
  if (log.actionType === 'USER_DELETE') return t('audit.deletedUser');
  if (log.actionType === 'COUNTER_RESET') return t('audit.counterReset');
  if (log.actionType === 'TEAM_CHANGE' && log.metadata) {
    return t('audit.teamChange').replace('{old}', log.metadata.oldTeam ?? '?').replace('{new}', log.metadata.newTeam ?? '?');
  }
  if (log.actionType === 'USER_APPROVED' && log.metadata) {
    return t('audit.userApproved').replace('{count}', log.metadata.approvedCount ?? '?');
  }
  if (log.actionType === 'USER_REJECTED' && log.metadata) {
    const reason = log.metadata.reason ? ` — ${log.metadata.reason}` : '';
    return t('audit.userRejected').replace('{count}', log.metadata.rejectedCount ?? '?') + reason;
  }
  if (log.actionType === 'TEAM_UPDATE' && log.metadata) {
    const parts = [];
    if (log.metadata.oldName && log.metadata.newName) parts.push(`${log.metadata.oldName} → ${log.metadata.newName}`);
    if (log.metadata.oldCode && log.metadata.newCode) parts.push(`Code: ${log.metadata.oldCode} → ${log.metadata.newCode}`);
    return parts.length > 0 ? parts.join(', ') : t('audit.teamUpdated');
  }
  if (log.actionType === 'AUTO_LOGOUT' && log.metadata) {
    const reason = log.metadata.reason ?? '';
    const pauseInfo = log.metadata.pauseAutoClosed ? ` (pause fermée: ${Math.floor((log.metadata.pauseDurationSeconds ?? 0) / 60)}min)` : '';
    return reason + pauseInfo;
  }
  return log.metadata ? JSON.stringify(log.metadata) : '–';
}

function formatDateTime(isoStr) {
  if (!isoStr) return '–';
  const d = new Date(isoStr + 'Z');
  return d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/**
 * Embeddable audit log panel (used inside Admin and SuperAdmin tabs).
 * Props: getToken()
 */
export default function AuditLogPanel({ getToken }) {
  const { t } = useLanguage();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (range !== 'all') params.set('range', range);
      if (actionFilter !== 'all') params.set('actionType', actionFilter);
      if (search.trim()) params.set('search', search.trim());
      const url = `${API}/admin/audit-logs${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) { setLogs([]); return; }
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [getToken, range, actionFilter, search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleSearchSubmit = (e) => { e.preventDefault(); setSearch(searchInput); };

  return (
    <div className="audit-panel">
      {/* ── Filters ── */}
      <div className="audit-filters">
        <label className="audit-filter-label">
          {t('audit.dateRange')}
          <select value={range} onChange={(e) => setRange(e.target.value)} className="audit-filter-select">
            <option value="all">{t('audit.rangeAll')}</option>
            <option value="today">{t('audit.rangeToday')}</option>
            <option value="7days">{t('audit.range7days')}</option>
            <option value="30days">{t('audit.range30days')}</option>
          </select>
        </label>
        <label className="audit-filter-label">
          {t('audit.actionType')}
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="audit-filter-select">
            <option value="all">{t('audit.actionAll')}</option>
            {ACTION_TYPES.map((at) => (
              <option key={at} value={at}>{actionLabel(at, t)}</option>
            ))}
          </select>
        </label>
        <form onSubmit={handleSearchSubmit} className="audit-filter-search">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('audit.searchPlaceholder')}
            className="audit-filter-input"
          />
          <button type="submit" className="btn btn-primary btn-small">&#x1F50D;</button>
        </form>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <p className="admin-loading">{t('app.loading')}</p>
      ) : logs.length === 0 ? (
        <p className="admin-empty">{t('audit.noLogs')}</p>
      ) : (
        <div className="pg-card">
          <table className="pg-compact-table audit-table-inline">
            <thead>
              <tr>
                <th>{t('audit.colDate')}</th>
                <th>{t('audit.colActor')}</th>
                <th>{t('audit.colAction')}</th>
                <th>{t('audit.colTarget')}</th>
                <th>{t('audit.colTeam')}</th>
                <th>{t('audit.colDetails')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="audit-date-cell">{formatDateTime(log.createdAt)}</td>
                  <td>{log.actorEmail}</td>
                  <td>
                    <span className={`audit-action-badge audit-action-${log.actionType}`}>
                      {actionLabel(log.actionType, t)}
                    </span>
                  </td>
                  <td>{log.targetEmail ?? '–'}</td>
                  <td>{log.targetTeam ?? '–'}</td>
                  <td className="audit-details-cell">{formatDetails(log, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
