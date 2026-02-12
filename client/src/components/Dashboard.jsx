import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTeam } from '../hooks/useTeam';
import TeamDashboard from './TeamDashboard';
import StatusActions from './StatusActions';
import './Dashboard.css';

export default function Dashboard() {
  const { user, getToken, logout } = useAuth();
  const { t } = useLanguage();
  const { team: allTeam, setStatus, connected, pauseProlongeeMinutes, capacity, lastSyncAt } = useTeam(getToken, logout);

  // Personal dashboard: only show the user's own team
  // (SuperAdmin's useTeam returns ALL users; filter to own team)
  const team = useMemo(() => {
    if (!user?.teamId) return allTeam;
    return allTeam.filter((m) => m.teamId === user.teamId || !m.teamId);
  }, [allTeam, user?.teamId]);

  const currentUserEntry = team.find((m) => m.id === user?.id);

  // Capacity data for current user's team
  // For superadmin, capacity is { teams: [...] }, extract own team's capacity
  const myTeamCapacity = capacity?.teams
    ? capacity.teams.find((tc) => tc.teamId === user?.teamId)
    : capacity;
  const breakCapacity = myTeamCapacity?.breakCapacity ?? 2;

  // Error message state (e.g., capacity reached)
  const [statusError, setStatusError] = useState('');

  // Wrap setStatus to handle capacity errors
  const handleSetStatus = async (status) => {
    setStatusError('');
    try {
      await setStatus(status);
    } catch (err) {
      if (err.code === 'PAUSE_CAPACITY_FULL') {
        setStatusError(t('ui.pauseCapacityFull'));
      } else {
        setStatusError(err.message);
      }
    }
  };

  // Live elapsed seconds for the current user's status
  const [myElapsed, setMyElapsed] = useState(0);

  useEffect(() => {
    if (!currentUserEntry?.statusChangedAt) {
      setMyElapsed(0);
      return;
    }
    const calc = () => {
      const start = new Date(currentUserEntry.statusChangedAt).getTime();
      setMyElapsed(Math.floor((Date.now() - start) / 1000));
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [currentUserEntry?.statusChangedAt]);

  // Backend-authoritative break count (includes offline users in DB)
  const backendOnBreakNow = myTeamCapacity?.onBreakNow ?? 0;

  // Capacity full detection for the "My Status" section
  const capacityFull = backendOnBreakNow >= breakCapacity;

  // Determine if the current user is working (not already on break)
  const isCurrentUserWorking = !currentUserEntry?.status || currentUserEntry?.status === 'working' || currentUserEntry?.status === 'offline';

  // Real-time capacity full detection — auto-dismiss when a spot frees up
  const isCapacityFull = capacityFull && isCurrentUserWorking;

  // Clear error when capacity frees up
  useEffect(() => {
    if (!isCapacityFull) setStatusError('');
  }, [isCapacityFull]);

  return (
    <div className="dashboard">
      <main className="dashboard-main">
        {/* ── Primary: My Status ── */}
        <section className="my-status-section">
          <h2>{t('dashboard.myStatus')}</h2>
          <StatusActions
            currentStatus={currentUserEntry?.status}
            onStatusChange={handleSetStatus}
            elapsedSeconds={myElapsed}
            pauseProlongeeMinutes={pauseProlongeeMinutes}
            isCapacityFull={isCapacityFull}
          />
          {/* Capacity full inline banner (auto-shows/hides based on real-time data) */}
          {isCapacityFull && (
            <div className="capacity-banner">
              <span className="capacity-banner-icon" aria-hidden="true">⏳</span>
              <span>{t('ui.pauseCapacityFull')}</span>
            </div>
          )}
          {/* Generic error (non-capacity) */}
          {statusError && !isCapacityFull && (
            <div className="capacity-error">{statusError}</div>
          )}
        </section>

        {/* ── Secondary: Unified Team Dashboard ── */}
        <TeamDashboard
          team={team}
          currentUserId={user?.id}
          pauseProlongeeMinutes={pauseProlongeeMinutes}
          lastSyncAt={lastSyncAt}
          breakCapacity={breakCapacity}
          backendOnBreakNow={backendOnBreakNow}
        />
      </main>
    </div>
  );
}
