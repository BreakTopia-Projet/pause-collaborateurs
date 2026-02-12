/**
 * TeamDashboard — Unified real-time team dashboard component.
 *
 * Reused by:
 *  - Dashboard.jsx (user view)
 *  - AdminPage.jsx (admin "Tableau de bord" tab)
 *
 * Receives team data from useTeam hook (socket-based real-time).
 * Renders: KPI cards + toggle show/hide offline + TeamTable + last sync indicator.
 *
 * All roles see the EXACT SAME rendering for their team scope.
 */
import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import TeamTable from './TeamTable';
import './TeamDashboard.css';

export default function TeamDashboard({
  team,
  currentUserId,
  pauseProlongeeMinutes = 15,
  lastSyncAt,
  breakCapacity = 2,
  backendOnBreakNow = 0,
  hideTitle = false,
}) {
  const { t } = useLanguage();

  // Toggle: show/hide offline users (persisted in localStorage)
  const [showOffline, setShowOffline] = useState(() => {
    try { return localStorage.getItem('showOfflineUsers') === 'true'; } catch { return false; }
  });
  const handleToggleOffline = (e) => {
    const val = e.target.checked;
    setShowOffline(val);
    try { localStorage.setItem('showOfflineUsers', String(val)); } catch {}
  };

  // KPI counters — computed from team data (online users only)
  const onlineTeam = team.filter((m) => m.status !== 'offline');
  const totalActive = onlineTeam.length;
  const workingCount = onlineTeam.filter(
    (m) => !m.status || m.status === 'working'
  ).length;
  const onBreakCount = totalActive - workingCount;

  // Capacity uses backend-authoritative count for consistency with enforcement
  const capacityFull = backendOnBreakNow >= breakCapacity;
  const capacityOver = backendOnBreakNow > breakCapacity;

  return (
    <section className="td-section">
      {/* Header with title + last sync */}
      <div className="td-header">
        {!hideTitle && <h2 className="td-title">{t('dashboard.teamView')}</h2>}
        <span className="td-last-sync">
          {!hideTitle && '— '}{t('dashboard.lastUpdate')}{' '}
          {lastSyncAt
            ? new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '--:--:--'}
        </span>
      </div>

      {/* Discreet online-only hint */}
      <p className="td-online-hint">{t('dashboard.onlineHint')}</p>

      {/* Toggle offline users */}
      <div className="td-toggle-bar">
        <label>
          <input type="checkbox" checked={showOffline} onChange={handleToggleOffline} />
          {t('toggle.showOffline')}
        </label>
      </div>

      {/* KPI bar */}
      <div className="td-kpi-bar">
        <div className="td-kpi">
          <span className="td-kpi-value">{totalActive}</span>
          <span className="td-kpi-label">{t('kpi.activeEmployees')}</span>
        </div>
        <div className="td-kpi td-kpi-working">
          <span className="td-kpi-value">{workingCount}</span>
          <span className="td-kpi-label">{t('kpi.working')}</span>
        </div>
        <div className="td-kpi td-kpi-break">
          <span className="td-kpi-value">{onBreakCount}</span>
          <span className="td-kpi-label">{t('kpi.onBreak')}</span>
        </div>
        <div className={`td-kpi td-kpi-capacity${capacityFull ? ' td-kpi-capacity-full' : ''}`} title={capacityOver ? t('capacity.warning') : ''}>
          <span className="td-kpi-value">{backendOnBreakNow} / {breakCapacity}</span>
          <span className="td-kpi-label">{t('capacity.label')}</span>
        </div>
      </div>

      {/* Team table */}
      <TeamTable
        team={team}
        currentUserId={currentUserId}
        pauseProlongeeMinutes={pauseProlongeeMinutes}
        showOffline={showOffline}
      />
    </section>
  );
}
