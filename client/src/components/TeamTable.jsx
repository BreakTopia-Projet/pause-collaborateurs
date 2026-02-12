import { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { sortUsersForDisplay } from '../utils/sortUsers';
import { formatOfflineSince, getOfflineSinceSeconds } from '../utils/formatOfflineSince';
import InfoTooltip from './InfoTooltip';
import './TeamTable.css';

const STATUS_KEYS = {
  working: 'team.working',
  break: 'team.break',
  extended_break: 'team.extendedBreak',
  offline: 'team.offline',
};

const STATUS_CLASS = {
  working: 'status-working',
  break: 'status-break',
  extended_break: 'status-extended',
  offline: 'status-offline',
};

function getDisplayStatus(member, elapsedSeconds, pauseProlongeeMinutes = 15) {
  if (member.status === 'offline') return 'offline';
  if (member.status === 'working') return 'working';
  if (member.status === 'extended_break') return 'extended_break';
  if (member.status === 'break') {
    const minutes = (elapsedSeconds ?? member.elapsedSeconds ?? 0) / 60;
    return minutes >= pauseProlongeeMinutes ? 'extended_break' : 'break';
  }
  return 'working';
}

/** Format current break elapsed as mm:ss (zero-padded minutes) */
function formatDuration(seconds) {
  if (seconds == null || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Format daily total as h:mm:ss (always includes hours) */
function formatDailyTotal(seconds) {
  if (seconds == null || seconds <= 0) return '0:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Compute the ongoing break's contribution to today's total.
 * If the break started before today, only count from midnight.
 */
function getOngoingTodaySeconds(statusChangedAt) {
  if (!statusChangedAt) return 0;
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const breakStartMs = new Date(statusChangedAt).getTime();
  const effectiveStartMs = Math.max(breakStartMs, todayStart.getTime());
  return Math.max(0, Math.floor((now - effectiveStartMs) / 1000));
}

export default function TeamTable({ team, currentUserId, pauseProlongeeMinutes = 15, showOffline = true }) {
  const { t } = useLanguage();
  const [elapsed, setElapsed] = useState({});
  const [ongoingToday, setOngoingToday] = useState({});
  const [offlineSince, setOfflineSince] = useState({});

  useEffect(() => {
    const update = () => {
      const nextElapsed = {};
      const nextOngoing = {};
      team.forEach((m) => {
        if (m.statusChangedAt && (m.status === 'break' || m.status === 'extended_break' || m.status === 'working')) {
          const start = new Date(m.statusChangedAt).getTime();
          nextElapsed[m.id] = Math.floor((Date.now() - start) / 1000);
        }
        // Compute ongoing break's today contribution for live ticking
        if (m.status === 'break' || m.status === 'extended_break') {
          nextOngoing[m.id] = getOngoingTodaySeconds(m.statusChangedAt);
        }
      });
      setElapsed(nextElapsed);
      setOngoingToday(nextOngoing);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [team]);

  // Tick offline durations every 30s
  useEffect(() => {
    const updateOffline = () => {
      const next = {};
      team.forEach((m) => {
        if (m.status === 'offline' && m.lastSeenAt) {
          next[m.id] = getOfflineSinceSeconds(m.lastSeenAt);
        }
      });
      setOfflineSince(next);
    };
    updateOffline();
    const id = setInterval(updateOffline, 30_000);
    return () => clearInterval(id);
  }, [team]);

  if (!team.length) {
    return (
      <div className="team-table-empty">
        <p>{t('team.empty')}</p>
      </div>
    );
  }

  // Filter offline users according to toggle
  const filteredTeam = showOffline ? team : team.filter((m) => m.status !== 'offline');

  // Sort: on-break first (longest duration), then current user, then rest alpha
  const sorted = sortUsersForDisplay(
    filteredTeam,
    currentUserId,
    (m) => elapsed[m.id] ?? m.elapsedSeconds ?? 0,
  );

  return (
    <div className="team-table-wrap">
      <table className="team-table" role="table" aria-label={t('team.tableLabel')}>
        <thead>
          <tr>
            <th scope="col">{t('team.member')}</th>
            <th scope="col">{t('team.status')}</th>
            <th scope="col">
              {t('team.duration')} <span className="th-unit">(mm:ss)</span>
              <InfoTooltip text={t('team.durationTooltip')} />
            </th>
            <th scope="col">
              {t('team.dailyTotal')} <span className="th-unit">(hh:mm:ss)</span>
              <InfoTooltip text={t('team.dailyTotalTooltip')} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((member) => {
            const sec = elapsed[member.id] ?? member.elapsedSeconds ?? 0;
            const displayStatus = getDisplayStatus(member, sec, pauseProlongeeMinutes);
            const isOnBreak = displayStatus === 'break' || displayStatus === 'extended_break';
            const isOffline = displayStatus === 'offline';
            const isCurrent = currentUserId === member.id;

            // Daily total = completed breaks today (from server) + ongoing break's today portion (live)
            const completedToday = member.dailyCompletedPauseSeconds ?? 0;
            const ongoingTodaySec = isOnBreak ? (ongoingToday[member.id] ?? 0) : 0;
            const dailyTotalSec = completedToday + ongoingTodaySec;

            return (
              <tr
                key={member.id}
                className={`${isCurrent ? 'row-current-user' : ''}${isOffline ? ' row-offline' : ''}`}
              >
                <td>
                  <span className="member-name">
                    {member.firstName} {member.lastName}
                    {isCurrent && <span className="member-you"> ({t('team.you') || 'you'})</span>}
                  </span>
                </td>
                <td>
                  <span className={`team-status-badge team-badge-${displayStatus === 'extended_break' ? 'extended' : displayStatus}`}>
                    <span
                      className={`status-dot ${STATUS_CLASS[displayStatus] || ''}`}
                      aria-hidden="true"
                    />
                    {t(STATUS_KEYS[displayStatus] || displayStatus)}
                  </span>
                  {isOffline && offlineSince[member.id] != null && (
                    <span className="offline-since">
                      {formatOfflineSince(offlineSince[member.id], t)}
                    </span>
                  )}
                </td>
                <td className="duration-cell">
                  {isOffline ? '—' : isOnBreak ? formatDuration(sec) : ''}
                </td>
                <td className="daily-total-cell">
                  {isOffline ? '—' : formatDailyTotal(dailyTotalSec)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
