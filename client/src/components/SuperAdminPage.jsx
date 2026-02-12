import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTeam } from '../hooks/useTeam';
import { sortUsersForDisplay } from '../utils/sortUsers';
import { formatOfflineSince, getOfflineSinceSeconds } from '../utils/formatOfflineSince';
import UserDetailModal from './UserDetailModal';
import AuditLogPanel from './AuditLogPanel';
import BreakHistoryPanel from './BreakHistoryPanel';
import TeamFormModal from './TeamFormModal';
import ApprovalsPanel from './ApprovalsPanel';
import TeamDashboard from './TeamDashboard';
import './AdminDashboard.css';
import './SuperAdminOverview.css';

const API = '/api';

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export default function SuperAdminPage() {
  const { user, getToken } = useAuth();
  const { t } = useLanguage();
  const { team: realtimeAllUsers, capacity, fetchCapacity, pauseProlongeeMinutes, lastSyncAt } = useTeam(getToken);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailMember, setDetailMember] = useState(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});

  // Capacity edits
  const [capEdits, setCapEdits] = useState({});
  const [capMsg, setCapMsg] = useState('');
  const [capSaving, setCapSaving] = useState(null);

  // Threshold edit
  const [thresholdInput, setThresholdInput] = useState('');
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdMsg, setThresholdMsg] = useState('');

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

  // Team management
  const [managedTeams, setManagedTeams] = useState([]);
  const [managedTeamsLoading, setManagedTeamsLoading] = useState(true);
  const [managedTeamsError, setManagedTeamsError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null); // null=create, object=edit
  const [teamMsg, setTeamMsg] = useState('');

  useEffect(() => {
    if (pauseProlongeeMinutes != null && !thresholdSaving) {
      setThresholdInput(String(pauseProlongeeMinutes));
    }
  }, [pauseProlongeeMinutes, thresholdSaving]);

  const handleSaveThreshold = async () => {
    const val = parseInt(thresholdInput, 10);
    if (Number.isNaN(val) || val < 1 || val > 120) { setThresholdMsg('Valeur invalide (1-120)'); return; }
    setThresholdSaving(true);
    setThresholdMsg('');
    try {
      const res = await fetch(`${API}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ pauseProlongeeMinutes: val }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setThresholdMsg(data.error || 'Erreur lors de la sauvegarde');
        console.error('[SuperAdmin] saveThreshold failed:', res.status, data);
      } else {
        const data = await res.json();
        // Confirm with the server-returned value
        if (data.pauseProlongeeMinutes != null) {
          setThresholdInput(String(data.pauseProlongeeMinutes));
        }
        setThresholdMsg(t('threshold.saved'));
        setTimeout(() => setThresholdMsg(''), 2500);
      }
    } catch (err) {
      console.error('[SuperAdmin] saveThreshold network error:', err);
      setThresholdMsg('Erreur réseau');
    } finally {
      setThresholdSaving(false);
    }
  };

  const capTeams = capacity?.teams || [];

  /* ── Fetch teams (active only — for dropdowns) ── */
  const fetchTeams = useCallback(async () => {
    const res = await fetch(`${API}/admin/teams`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return;
    const data = await res.json();
    setTeams(Array.isArray(data) ? data : []);
  }, [getToken]);

  /* ── Fetch all teams (incl. archived — for management) ── */
  const fetchManagedTeams = useCallback(async () => {
    setManagedTeamsLoading(true);
    setManagedTeamsError('');
    try {
      const res = await fetch(`${API}/teams?all=1`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[SuperAdmin] fetchManagedTeams failed:', res.status, errText);
        setManagedTeamsError(`Erreur ${res.status} lors du chargement des équipes`);
        return;
      }
      const data = await res.json();
      console.log('[SuperAdmin] fetchManagedTeams response:', data);
      setManagedTeams(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[SuperAdmin] fetchManagedTeams network error:', err);
      setManagedTeamsError('Erreur réseau lors du chargement des équipes');
    } finally {
      setManagedTeamsLoading(false);
    }
  }, [getToken]);

  /* ── Fetch all members ── */
  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/team-members`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) { setMembers([]); return; }
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, [getToken]);

  useEffect(() => { fetchTeams(); fetchManagedTeams(); }, [fetchTeams, fetchManagedTeams]);
  useEffect(() => { fetchMembers(); }, [fetchMembers]);
  useEffect(() => { const id = setInterval(fetchMembers, 30000); return () => clearInterval(id); }, [fetchMembers]);

  /* ── PDF export (breaks) ── */
  const handleExportPdf = async () => {
    const res = await fetch(`${API}/admin/export/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pauses-global.pdf';
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

  /* ── Save capacity ── */
  const handleSaveCapacity = async (teamId) => {
    const raw = capEdits[teamId];
    const val = parseInt(raw, 10);
    if (Number.isNaN(val) || val < 0 || val > 50) { setCapMsg('Valeur invalide (0-50)'); return; }
    setCapSaving(teamId);
    setCapMsg('');
    try {
      const res = await fetch(`${API}/teams/${teamId}/capacity`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ breakCapacity: val }),
      });
      if (!res.ok) { const data = await res.json(); setCapMsg(data.error || 'Erreur'); }
      else { setCapMsg(t('capacity.saved')); await fetchCapacity(); setTimeout(() => setCapMsg(''), 2500); }
    } catch { setCapMsg('Erreur réseau'); }
    finally { setCapSaving(null); }
  };

  /* ── Team CRUD handlers ── */
  const handleTeamSave = async (payload) => {
    const isEdit = !!editingTeam;
    const url = isEdit ? `${API}/teams/${editingTeam.id}` : `${API}/teams`;
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    setTeamModalOpen(false);
    setEditingTeam(null);
    setTeamMsg(isEdit ? t('teamMgmt.updated') : t('teamMgmt.created'));
    setTimeout(() => setTeamMsg(''), 2500);
    await fetchManagedTeams();
    await fetchTeams();
    await fetchCapacity();
  };

  const handleArchiveTeam = async (team) => {
    const memberCount = team.memberCount ?? 0;
    const msg = memberCount > 0
      ? `${t('teamMgmt.confirmArchive').replace('{name}', team.name)}\n\n${t('teamMgmt.archiveWarning').replace('{count}', memberCount)}`
      : t('teamMgmt.confirmArchive').replace('{name}', team.name);
    if (!window.confirm(msg)) return;
    const res = await fetch(`${API}/teams/${team.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Erreur'); return; }
    setTeamMsg(t('teamMgmt.archivedSuccess'));
    setTimeout(() => setTeamMsg(''), 2500);
    await fetchManagedTeams();
    await fetchTeams();
    await fetchCapacity();
  };

  const handleUnarchiveTeam = async (team) => {
    const res = await fetch(`${API}/teams/${team.id}/unarchive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Erreur'); return; }
    setTeamMsg(t('teamMgmt.unarchivedSuccess'));
    setTimeout(() => setTeamMsg(''), 2500);
    await fetchManagedTeams();
    await fetchTeams();
    await fetchCapacity();
  };

  /* ── Callbacks ── */
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

  /* ── Filter + group ── */
  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower
    ? members.filter((m) => `${m.firstName} ${m.lastName}`.toLowerCase().includes(searchLower) || (m.email && m.email.toLowerCase().includes(searchLower)))
    : members;

  const teamGroups = {};
  filtered.forEach((m) => { const key = m.teamName || '–'; if (!teamGroups[key]) teamGroups[key] = []; teamGroups[key].push(m); });
  const sortedTeamNames = Object.keys(teamGroups).sort((a, b) => a.localeCompare(b));

  // Employee-tab groups (respects showOffline toggle + search)
  const empFiltered = (showOffline ? members : members.filter((m) => m.liveStatus !== 'offline'))
    .filter((m) => !searchLower || `${m.firstName} ${m.lastName}`.toLowerCase().includes(searchLower) || (m.email && m.email.toLowerCase().includes(searchLower)));
  const empTeamGroups = {};
  empFiltered.forEach((m) => { const key = m.teamName || '–'; if (!empTeamGroups[key]) empTeamGroups[key] = []; empTeamGroups[key].push(m); });
  const empTeamNames = Object.keys(empTeamGroups).sort((a, b) => a.localeCompare(b));

  /* ── Global KPIs (exclude offline users) ── */
  const onlineMembers = filtered.filter((m) => m.liveStatus !== 'offline');
  const globalTotal = onlineMembers.length;
  const globalOnBreak = onlineMembers.filter((m) => m.liveStatus && m.liveStatus !== 'working').length;
  const globalWorking = globalTotal - globalOnBreak;

  const toggleTeam = (teamName) => setCollapsed((prev) => ({ ...prev, [teamName]: !prev[teamName] }));

  // Build capacity lookup by teamName
  const capByTeamName = {};
  capTeams.forEach((ct) => { capByTeamName[ct.teamName] = ct; });

  /** Compute display status based on dynamic threshold */
  function getDisplayStatus(m) {
    const st = m.liveStatus || 'working';
    if (st === 'offline') return 'offline';
    if (st === 'working') return 'working';
    if (st === 'extended_break') return 'extended_break';
    // st === 'break'
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

  const TABS = [
    { id: 'dashboard', label: t('adminTabs.dashboard') },
    { id: 'employees', label: t('adminTabs.employees') },
    { id: 'approvals', label: t('adminTabs.approvals') },
    { id: 'settings', label: t('adminTabs.settings') },
    { id: 'audit', label: t('adminTabs.audit') },
    { id: 'history', label: t('adminTabs.history') },
  ];

  return (
    <div className="admin-dashboard superadmin-page">
      <div className="pg-page-header">
        <div className="pg-page-header-inner">
          <div>
            <h1 className="pg-page-title">{t('superadmin.title')}</h1>
            <p className="pg-page-subtitle">{t('superadmin.subtitle')}</p>
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

      <main className="admin-main pg-main sa-main">
        {/* ═══ TAB: Dashboard (real-time, grouped by team) ═══ */}
        {activeTab === 'dashboard' && (() => {
          // Group real-time users by teamName
          const rtTeamGroups = {};
          realtimeAllUsers.forEach((m) => {
            const key = m.teamName || '–';
            if (!rtTeamGroups[key]) rtTeamGroups[key] = [];
            rtTeamGroups[key].push(m);
          });
          const rtTeamNames = Object.keys(rtTeamGroups).sort((a, b) => a.localeCompare(b));

          return (
            <div className="pg-tab-content">
              {rtTeamNames.map((teamName) => {
                const teamMembers = rtTeamGroups[teamName];
                const ct = capTeams.find((c) => c.teamName === teamName);
                return (
                  <div key={teamName} className="sa-team-dashboard-block">
                    <h3 className="sa-team-dashboard-title">{teamName}</h3>
                    <TeamDashboard
                      team={teamMembers}
                      currentUserId={user?.id}
                      pauseProlongeeMinutes={pauseProlongeeMinutes}
                      lastSyncAt={lastSyncAt}
                      breakCapacity={ct?.breakCapacity ?? 2}
                      backendOnBreakNow={ct?.onBreakNow ?? 0}
                      hideTitle
                    />
                  </div>
                );
              })}
              {rtTeamNames.length === 0 && (
                <p className="admin-empty">{t('admin.noMembers')}</p>
              )}
            </div>
          );
        })()}

        {/* ═══ TAB: Employees ═══ */}
        {activeTab === 'employees' && (
          <div className="pg-tab-content">
            <div className="pg-toolbar">
              <input
                type="text"
                className="pg-search"
                placeholder={t('superadmin.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
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
            ) : empTeamNames.length === 0 ? (
              <p className="admin-empty">{t('admin.noMembers')}</p>
            ) : (
              <div className="eg-grid eg-accordion">
                {/* Shared column header — rendered once, aligns all teams */}
                <div className="eg-header" role="row">
                  <div className="eg-header-cell">{t('team.member')}</div>
                  <div className="eg-header-cell eg-col-center role-col" style={{ justifyContent: 'center', textAlign: 'center' }}>{t('admin.role')}</div>
                  <div className="eg-header-cell eg-col-end"></div>
                </div>

                {empTeamNames.map((teamName) => {
                  const group = empTeamGroups[teamName];
                  const isCollapsed = !!collapsed[teamName];
                  const groupOnlineEmp = group.filter((m) => m.liveStatus !== 'offline');
                  const teamOnBreak = groupOnlineEmp.filter((m) => m.liveStatus && m.liveStatus !== 'working').length;
                  const teamWorking = groupOnlineEmp.length - teamOnBreak;
                  const sortedGroup = sortUsersForDisplay(group, user?.id);

                  return (
                    <div key={teamName} className="eg-team-group">
                      <button type="button" className="eg-team-header" onClick={() => toggleTeam(teamName)} aria-expanded={!isCollapsed}>
                        <span className="eg-team-arrow">{isCollapsed ? '▸' : '▾'}</span>
                        <span className="eg-team-name">{teamName}</span>
                        <span className="eg-team-kpis">
                          <span className="eg-team-kpi">{groupOnlineEmp.length} {t('kpi.activeEmployees').toLowerCase()}</span>
                          <span className="eg-team-kpi eg-team-kpi-working">{teamWorking} {t('kpi.working').toLowerCase()}</span>
                          <span className="eg-team-kpi eg-team-kpi-break">{teamOnBreak} {t('kpi.onBreak').toLowerCase()}</span>
                          {capByTeamName[teamName] && (() => {
                            const cap = capByTeamName[teamName];
                            const x = cap.onBreakNow ?? teamOnBreak;
                            const y = cap.breakCapacity ?? 2;
                            const cls = x > y ? 'eg-cap-over' : x === y ? 'eg-cap-full' : 'eg-cap-ok';
                            return <span className={`eg-team-kpi eg-team-kpi-cap ${cls}`}>{x} / {y}</span>;
                          })()}
                        </span>
                      </button>
                      {!isCollapsed && (
                        <div className="eg-team-section">
                          {sortedGroup.map((m) => (
                            <div key={m.id} className={`eg-row${m.id === user?.id ? ' row-current-user' : ''}`} role="row">
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
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: Approvals ═══ */}
        {activeTab === 'approvals' && (
          <div className="pg-tab-content">
            <ApprovalsPanel getToken={getToken} />
          </div>
        )}

        {/* ═══ TAB: Settings ═══ */}
        {activeTab === 'settings' && (
          <div className="pg-tab-content">

            {/* ── Team Management ── */}
            <div className="pg-card pg-settings-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <h3 className="pg-card-title" style={{ margin: 0 }}>{t('teamMgmt.title')}</h3>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                    {t('teamMgmt.showArchived')}
                  </label>
                  <button type="button" className="btn btn-primary btn-small" onClick={() => { setEditingTeam(null); setTeamModalOpen(true); }}>
                    {t('teamMgmt.addTeam')}
                  </button>
                </div>
              </div>
              {teamMsg && <p className="admin-capacity-msg">{teamMsg}</p>}
              {managedTeamsError && (
                <p style={{ color: '#c62828', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  {managedTeamsError}{' '}
                  <button type="button" className="btn btn-small btn-secondary" onClick={fetchManagedTeams}>Réessayer</button>
                </p>
              )}

              {managedTeamsLoading ? (
                <p style={{ padding: '1rem 0', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Chargement des équipes…</p>
              ) : (
              <table className="pg-compact-table">
                <thead>
                  <tr>
                    <th>{t('teamMgmt.teamName')}</th>
                    <th>{t('teamMgmt.teamCode')}</th>
                    <th>{t('teamMgmt.breakCapacity')}</th>
                    <th>{t('kpi.onBreak')}</th>
                    <th>{t('teamMgmt.members')}</th>
                    <th>{t('teamMgmt.status')}</th>
                    <th>{t('teamMgmt.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {managedTeams
                    .filter((mt) => showArchived || mt.isActive)
                    .length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>Aucune équipe trouvée</td></tr>
                    )}
                  {managedTeams
                    .filter((mt) => showArchived || mt.isActive)
                    .map((mt) => (
                    <tr key={mt.id} style={!mt.isActive ? { opacity: 0.6 } : {}}>
                      <td className="pg-cell-name">{mt.name}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{mt.code}</td>
                      <td>
                        <input
                          type="number" min="0" max="50"
                          className="pg-cap-input"
                          value={capEdits[mt.id] != null ? capEdits[mt.id] : mt.breakCapacity}
                          onChange={(e) => setCapEdits((prev) => ({ ...prev, [mt.id]: e.target.value }))}
                          style={{ width: 60 }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          style={{ marginLeft: '0.3rem' }}
                          onClick={() => handleSaveCapacity(mt.id)}
                          disabled={capSaving === mt.id}
                        >
                          {t('capacity.save')}
                        </button>
                      </td>
                      <td>{mt.onBreakNow}</td>
                      <td>{mt.memberCount}</td>
                      <td>
                        <span className={`pg-status-badge ${mt.isActive ? 'pg-status-working' : 'pg-status-extended'}`} style={{ fontSize: '0.75rem' }}>
                          {mt.isActive ? t('teamMgmt.active') : t('teamMgmt.archived')}
                        </span>
                      </td>
                      <td style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => { setEditingTeam(mt); setTeamModalOpen(true); }}>
                          {t('teamMgmt.edit')}
                        </button>
                        {mt.isActive ? (
                          <button type="button" className="btn btn-small" style={{ color: '#c62828', borderColor: '#c62828' }} onClick={() => handleArchiveTeam(mt)}>
                            {t('teamMgmt.archive')}
                          </button>
                        ) : (
                          <button type="button" className="btn btn-small btn-primary" onClick={() => handleUnarchiveTeam(mt)}>
                            {t('teamMgmt.unarchive')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
              {capMsg && <p className="admin-capacity-msg" style={{ marginTop: '0.5rem' }}>{capMsg}</p>}
            </div>

            {/* ── Threshold setting ── */}
            <div className="pg-card pg-settings-card" style={{ marginTop: '1.5rem' }}>
              <h3 className="pg-card-title">{t('threshold.label')}</h3>
              <p className="pg-helper-text">{t('threshold.helperText')}</p>
              {thresholdMsg && <p className="admin-capacity-msg">{thresholdMsg}</p>}
              <div className="pg-cap-form">
                <input
                  type="number" min="1" max="120"
                  className="pg-cap-input"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                />
                <button type="button" className="btn btn-primary btn-small" onClick={handleSaveThreshold} disabled={thresholdSaving}>
                  {t('capacity.save')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Team form modal */}
        {teamModalOpen && (
          <TeamFormModal
            team={editingTeam}
            onClose={() => { setTeamModalOpen(false); setEditingTeam(null); }}
            onSave={handleTeamSave}
          />
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
            <BreakHistoryPanel getToken={getToken} isSuperAdmin={true} teams={teams} />
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
