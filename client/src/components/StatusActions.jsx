import { useLanguage } from '../context/LanguageContext';
import './StatusActions.css';

const STATUS_WORKING = 'working';
const STATUS_BREAK = 'break';

export default function StatusActions({ currentStatus, onStatusChange, elapsedSeconds, pauseProlongeeMinutes = 15, isCapacityFull = false }) {
  const { t } = useLanguage();
  // 'offline' is treated as working since the user is clearly online if viewing this component
  const isWorking = currentStatus === STATUS_WORKING || currentStatus === undefined || currentStatus === 'offline';
  const isBreak = currentStatus === STATUS_BREAK || currentStatus === 'extended_break';

  // Determine if break is extended
  const breakMinutes = (elapsedSeconds ?? 0) / 60;
  const isExtended = isBreak && breakMinutes >= pauseProlongeeMinutes;

  const statusLabel = isWorking ? t('team.working') : isExtended ? t('team.extendedBreak') : t('team.break');
  const statusClass = isWorking ? 'working' : isExtended ? 'extended' : 'break';

  // Button is disabled when user is working and capacity is full
  const startBreakDisabled = isWorking && isCapacityFull;

  // Format elapsed break time
  const formatTime = (sec) => {
    if (sec == null || sec < 0) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="my-status-card">
      {/* Status indicator */}
      <div className={`my-status-indicator my-status-${statusClass}`}>
        <span className={`my-status-dot my-status-dot-${statusClass}`} aria-hidden="true" />
        <span className="my-status-label">{statusLabel}</span>
        {isBreak && elapsedSeconds != null && (
          <span className="my-status-timer">{formatTime(elapsedSeconds)}</span>
        )}
      </div>

      {/* Single action button */}
      <div className="my-status-action">
        {isWorking ? (
          <button
            type="button"
            className={`btn-status-action btn-start-break${startBreakDisabled ? ' btn-disabled' : ''}`}
            onClick={() => onStatusChange(STATUS_BREAK)}
            aria-label={t('status.startBreak')}
            disabled={startBreakDisabled}
          >
            {t('status.startBreak')}
          </button>
        ) : (
          <button
            type="button"
            className="btn-status-action btn-resume-work"
            onClick={() => onStatusChange(STATUS_WORKING)}
            aria-label={t('status.resumeWork')}
          >
            {t('status.resumeWork')}
          </button>
        )}
      </div>
    </div>
  );
}
