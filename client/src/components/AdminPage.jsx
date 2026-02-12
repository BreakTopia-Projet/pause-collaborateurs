import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTeam } from '../hooks/useTeam';
import { sortUsersForDisplay } from '../utils/sortUsers';
import { formatOfflineSince, getOfflineSinceSeconds } from '../utils/formatOfflineSince';
import UserDetailModal from './UserDetailModal';
import AuditLogPanel from './AuditLogPanel';
import BreakHistoryPanel from './BreakHistoryPanel';
import TeamDashboard from './TeamDashboard';
import './AdminDashboard.css';

const API = '/api';

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export default function AdminPage() {
  const { user, getToken } = useAuth();
  const { t } = useLanguage();
  const { team: realtimeTeam, capacity, fetchCapacity, pauseProlongeeMinutes, lastSyncAt } = useTeam(getToken);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [members, setMembers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailMember, setDetailMember] = useState(null);

  // Toggle: show/hide offline users (localStorage persistence)
  const [showOffline, setShowOffline] = useState(() => {
    try { return localStorage.getItem('showOfflineUsers') === 'true'; } catch { return false; }
  });
  const handleToggleOffline = (e) => {
    const val = e.target.checked;
    setShowOffline(val);
    try { localStorage.setItem('showOfflineUsers', String(val)); } catch {}
  };

  // Offline-since ticking state (updates every 30s)
  const [offlineSince, setOfflineSince] = useState({});
  useEffect(() => {
    const update = () => {
      const next = {};
      members.forEach((m) => {
        if (m.liveStatus === 'offline' && m.lastSeenAt) {
          next[m.id] = getOfflineSinceSeconds(m.lastSeenAt);
        }
      });
      setOfflineSince(next);
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [members]);

  // Capacity settings state
  const [capInput, setCapInput] = useState('');
  const [capSaving, setCapSaving] = useState(false);
  const [capMsg, setCapMsg] = useState('');

  useEffect(() => {
    if (capacity?.breakCapacity != null && !capSaving) {
      setCapInput(String(capacity.breakCapacity));
    }
  }, [capacity?.breakCapacity, capSaving]);

  const handleSaveCapacity = async () => {
    const val = parseInt(capInput, 10);
    if (Number.isNaN(val) || val < 0 || val > 50) {
      setCapMsg('Valeur invalide (0-50)');
      return;
    }
    setCapSaving(true);
    setCapMsg('');
    try {
      const teamId = user?.teamId ?? user?.team_id;
      const res = await fetch(`${API}/teams/${teamId}/capacity`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ breakCapacity: val }),
      });
      if (!res.ok) {
        const data = await res.json();
        setCapMsg(data.error || 'Erreur');
      } else {
        setCapMsg(t('capacity.saved'));
        await fetchCapacity();
        setTimeout(() => setCapMsg(''), 2500);
      }
    } catch {
      setCapMsg('Erreur réseau');
    } finally {
      setCapSaving(false);
    }
  };

  const fetchTeams = useCallback(async () => {
    const res = await fetch(`${API}/admin/teams`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setTeams(Array.isArray(data) ? data : []);
  }, [getToken]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/team-members`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) { setMembers([]); return; }
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);
  useEffect(() => { fetchMembers(); }, [fetchMembers]);
  useEffect(() => {
    const id = setInterval(fetchMembers, 30000);
    return () => clearInterval(id);
  }, [fetchMembers]);

  const handleExportPdf = async () => {
    const res = await fetch(`${API}/admin/export/pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pauses-equipe.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ── Presence export CSV ── */
  const handlePresenceCsv = async () => {
    const res = await fetch(`${API}/admin/presence/export.csv`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `presence-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ── Presence export PDF ── */
  const handlePresencePdf = async () => {
    const res = await fetch(`${API}/admin/presence/export.pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `presence-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleMemberUpdated = (updated) => {
    setMembers((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
    setDetailMember((prev) => prev && prev.id === updated.id ? { ...prev, ...updated } : prev);
    fetchMembers();
  };

  const handleMemberDeleted = (deletedId) => {
    setMembers((prev) => prev.filter((m) => m.id !== deletedId));
    setDetailMember(null);
    fetchMembers();
  };

  /* ── KPIs (exclude offline users) ── */
  const onlineMembers = members.filter((m) => m.liveStatus !== 'offline');
  const totalActive = onlineMembers.length;
  const onBreakCount = onlineMembers.filter((m) => m.liveStatus && m.liveStatus !== 'working').length;
  const workingCount = totalActive - onBreakCount;
  const onBreakMembers = onlineMembers.filter((m) => m.liveStatus && m.liveStatus !== 'working')
    .sort((a, b) => (b.elapsedSeconds ?? 0) - (a.elapsedSeconds ?? 0));

  /* ── Sort: on-break first (longest), then current user, then rest alpha ── */
  const sorted = sortUsersForDisplay(members, user?.id);

  /** Compute display status based on dynamic threshold */
  function getDisplayStatus(m) {
    const st = m.liveStatus || 'working';
    if (st === 'offline') return 'offline';
    if (st === 'working') return 'working';
    if (st === 'extended_break') return 'extended_break';
    const sec = m.elapsedSeconds ?? 0;
    return (sec / 60) >= pauseProlongeeMinutes ? 'extended_break' : 'break';
  }

  function statusBadge(m) {
    const status = typeof m === 'string' ? m : getDisplayStatus(m);
    const labels = { working: t('team.working'), break: t('team.break'), extended_break: t('team.extendedBreak'), offline: t('team.offline') };
    const cls = status === 'offline' ? 'pg-status-offline' : status === 'working' ? 'pg-status-working' : status === 'extended_break' ? 'pg-status-extended' : 'pg-status-break';
    const badge = <span className={`pg-status-badge ${cls}`}>{labels[status] || status}</span>;
    if (status === 'offline' && typeof m === 'object' && offlineSince[m.id] != null) {
      return <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>{badge}<span className="offline-since">{formatOfflineSince(offlineSince[m.id], t)}</span></span>;
    }
    return badge;
  }

  // Filter by toggle for employee list
  const visibleSorted = sortUsersForDisplay(
    showOffline ? members : members.filter((m) => m.liveStatus !== 'offline'),
    user?.id,
  );

  const TABS = [
    { id: 'dashboard', label: t('adminTabs.dashboard') },
    { id: 'employees', label: t('adminTabs.employees') },
    { id: 'settings', label: t('adminTabs.settings') },
    { id: 'audit', label: t('adminTabs.audit') },
    { id: 'history', label: t('adminTabs.history') },
  ];

  return (
    <div className="admin-dashboard">
      <div className="pg-page-header">
        <div className="pg-page-header-inner">
          <div>
            <h1 className="pg-page-title">{t('admin.title')}</h1>
            <p className="pg-page-subtitle">{t('admin.subtitle')}</p>
          </div>
        </div>
        <nav className="pg-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`pg-tab${activeTab === tab.id ? ' pg-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <main className="admin-main pg-main">
        {/* ═══ TAB: Dashboard (unified component — same as user Dashboard) ═══ */}
        {activeTab === 'dashboard' && (
          <div className="pg-tab-content">
            <TeamDashboard
              team={realtimeTeam}
              currentUserId={user?.id}
              pauseProlongeeMinutes={pauseProlongeeMinutes}
              lastSyncAt={lastSyncAt}
              breakCapacity={capacity?.breakCapacity ?? 2}
              backendOnBreakNow={capacity?.onBreakNow ?? 0}
            />
          </div>
        )}

        {/* ═══ TAB: Employees ═══ */}
        {activeTab === 'employees' && (
          <div className="pg-tab-content">
            <div className="pg-toolbar">
              <h2 className="pg-section-title">{t('admin.myTeam')}</h2>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn-export" onClick={handlePresenceCsv} title={t('export.presenceCsv')}>
                  📄 CSV
                </button>
                <button type="button" className="btn-export" onClick={handlePresencePdf} title={t('export.presencePdf')}>
                  📑 PDF
                </button>
                <button type="button" className="btn btn-secondary btn-small" onClick={handleExportPdf}>
                  {t('admin.exportPdf')}
                </button>
              </div>
            </div>
            <div className="offline-toggle-bar">
              <label>
                <input type="checkbox" checked={showOffline} onChange={handleToggleOffline} />
                {t('toggle.showOffline')}
              </label>
            </div>
            {loading ? (
              <p className="admin-loading">{t('app.loading')}</p>
            ) : visibleSorted.length === 0 ? (
              <p className="admin-empty">{t('admin.noMembers')}</p>
            ) : (
              <div className="eg-grid eg-card">
                <div className="eg-header" role="row">
                  <div className="eg-header-cell">{t('team.member')}</div>
                  <div className="eg-header-cell eg-col-center role-col" style={{ justifyContent: 'center', textAlign: 'center' }}>{t('admin.role')}</div>
                  <div className="eg-header-cell eg-col-end"></div>
                </div>
                {visibleSorted.map((m) => (
                  <div key={m.id} className={`eg-row${m.id === user?.id ? ' row-current-user' : ''}${m.liveStatus === 'offline' ? ' row-offline' : ''}`} role="row">
                    <div className="eg-cell eg-cell-name">{m.firstName} {m.lastName}</div>
                    <div className="eg-cell eg-cell-center role-col" style={{ justifyContent: 'center', textAlign: 'center' }}>
                      <span className={`role-badge role-${m.role}`}>
                        {m.role === 'superadmin' && t('admin.roleSuperadmin')}
                        {m.role === 'admin' && t('admin.roleAdmin')}
                        {m.role === 'user' && t('admin.roleUser')}
                      </span>
                    </div>
                    <div className="eg-cell eg-cell-end">
                      <button type="button" className="btn btn-small btn-primary" onClick={() => setDetailMember(m)}>
                        {t('userDetail.viewDetails')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: Settings ═══ */}
        {activeTab === 'settings' && (
          <div className="pg-tab-content">
            <div className="pg-card pg-settings-card">
              <h3 className="pg-card-title">{t('capacity.teamSettings')}</h3>
              <p className="pg-helper-text">{t('capacity.helperText')}</p>
              <div className="pg-cap-row">
                <span className="pg-cap-current">
                  {t('capacity.label')} : <strong>{capacity?.onBreakNow ?? 0} / {capacity?.breakCapacity ?? 2}</strong>
                </span>
              </div>
              <div className="pg-cap-form">
                <label className="pg-cap-form-label">{t('capacity.label')}</label>
                <input
                  type="number" min="0" max="50"
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  className="pg-cap-input"
                />
                <button type="button" className="btn btn-primary btn-small" onClick={handleSaveCapacity} disabled={capSaving}>
                  {t('capacity.save')}
                </button>
                {capMsg && <span className="admin-capacity-msg">{capMsg}</span>}
              </div>
            </div>
          </div>
        )}

        {/* ═══ TAB: Audit ═══ */}
        {activeTab === 'audit' && (
          <div className="pg-tab-content">
            <AuditLogPanel getToken={getToken} />
          </div>
        )}

        {/* ═══ TAB: History ═══ */}
        {activeTab === 'history' && (
          <div className="pg-tab-content">
            <BreakHistoryPanel getToken={getToken} isSuperAdmin={false} teams={teams} />
          </div>
        )}
      </main>

      {detailMember && (
        <UserDetailModal
          member={detailMember}
          teams={teams}
          onClose={() => setDetailMember(null)}
          onMemberUpdated={handleMemberUpdated}
          onMemberDeleted={handleMemberDeleted}
        />
      )}
    </div>
  );
}
