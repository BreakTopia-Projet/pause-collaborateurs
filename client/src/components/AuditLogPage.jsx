import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import './AdminDashboard.css';
import './AuditLogPage.css';

const API = '/api';

const ACTION_TYPES = ['USER_DELETE', 'ROLE_CHANGE', 'COUNTER_RESET', 'TEAM_CHANGE', 'AUTO_LOGOUT'];

function actionLabel(actionType, t) {
  switch (actionType) {
    case 'USER_DELETE': return t('audit.actionUserDelete');
    case 'ROLE_CHANGE': return t('audit.actionRoleChange');
    case 'COUNTER_RESET': return t('audit.actionCounterReset');
    case 'TEAM_CHANGE': return t('audit.actionTeamChange');
    case 'AUTO_LOGOUT': return t('audit.actionAutoLogout');
    default: return actionType;
  }
}

function formatDetails(log, t) {
  if (log.actionType === 'ROLE_CHANGE' && log.metadata) {
    return t('audit.roleChange')
      .replace('{old}', log.metadata.oldRole ?? '?')
      .replace('{new}', log.metadata.newRole ?? '?');
  }
  if (log.actionType === 'USER_DELETE') {
    return t('audit.deletedUser');
  }
  if (log.actionType === 'COUNTER_RESET') {
    return t('audit.counterReset');
  }
  if (log.actionType === 'TEAM_CHANGE' && log.metadata) {
    return t('audit.teamChange')
      .replace('{old}', log.metadata.oldTeam ?? '?')
      .replace('{new}', log.metadata.newTeam ?? '?');
  }
  if (log.actionType === 'AUTO_LOGOUT') {
    return t('audit.autoLogout');
  }
  return log.metadata ? JSON.stringify(log.metadata) : '–';
}

function formatDateTime(isoStr) {
  if (!isoStr) return '–';
  // SQLite stores as "YYYY-MM-DD HH:MM:SS" (UTC)
  const d = new Date(isoStr + 'Z');
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function AuditLogPage() {
  const { user, logout, getToken } = useAuth();
  const { t } = useLanguage();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [range, setRange] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const isSuperadmin = user?.role === 'superadmin';

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (range !== 'all') params.set('range', range);
      if (actionFilter !== 'all') params.set('actionType', actionFilter);
      if (search.trim()) params.set('search', search.trim());

      const url = `${API}/admin/audit-logs${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        setLogs([]);
        return;
      }
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [getToken, range, actionFilter, search]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const backLink = isSuperadmin ? '/super-admin' : '/admin';

  return (
    <div className="admin-dashboard audit-page">
      <header className="dashboard-header">
        <div className="header-inner">
          <div>
            <h1>{t('audit.title')}</h1>
            <p className="header-subtitle">{t('audit.subtitle')}</p>
          </div>
          <div className="header-user">
            <Link to={backLink} className="btn btn-secondary">
              {t('admin.goToDashboard')}
            </Link>
            <span className="user-name">
              {user?.firstName} {user?.lastName}
            </span>
            <button type="button" className="btn btn-secondary" onClick={logout}>
              {t('dashboard.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="admin-main">
        {/* ── Filters toolbar ── */}
        <div className="admin-toolbar audit-toolbar">
          <label>
            {t('audit.dateRange')}
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="all">{t('audit.rangeAll')}</option>
              <option value="today">{t('audit.rangeToday')}</option>
              <option value="7days">{t('audit.range7days')}</option>
              <option value="30days">{t('audit.range30days')}</option>
            </select>
          </label>

          <label>
            {t('audit.actionType')}
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">{t('audit.actionAll')}</option>
              {ACTION_TYPES.map((at) => (
                <option key={at} value={at}>{actionLabel(at, t)}</option>
              ))}
            </select>
          </label>

          <form onSubmit={handleSearchSubmit} className="audit-search-form">
            <label>
              {t('auth.email')}
              <div className="audit-search-row">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('audit.searchPlaceholder')}
                />
                <button type="submit" className="btn btn-primary btn-small">
                  &#x1F50D;
                </button>
              </div>
            </label>
          </form>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <p className="admin-loading">{t('app.loading')}</p>
        ) : logs.length === 0 ? (
          <p className="admin-empty">{t('audit.noLogs')}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table audit-table">
              <thead>
                <tr>
                  <th>{t('audit.colDate')}</th>
                  <th>{t('audit.colActor')}</th>
                  <th>{t('audit.colActorRole')}</th>
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
                      <span className={`role-badge role-${log.actorRole}`}>
                        {log.actorRole}
                      </span>
                    </td>
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
      </main>
    </div>
  );
}
