import { useLanguage } from '../context/LanguageContext';

/**
 * Real-time summary pill for the global header.
 * Shows "X en pause / Y au travail" with color cues.
 *
 * Pure display component — data comes from props.
 */
export default function HeaderSummary({ onBreak, working, capacityWarning }) {
  const { t } = useLanguage();

  if (onBreak === 0 && working === 0) return null;

  const breakCls = capacityWarning ? 'ghs-break ghs-break-warn' : 'ghs-break';

  return (
    <div className="ghs" role="status" aria-live="polite" aria-label="Résumé équipe">
      <span className={breakCls}>
        <span className="ghs-dot ghs-dot-break" aria-hidden="true" />
        <span className="ghs-count">{onBreak}</span>
        <span className="ghs-label">{t('kpi.onBreak').toLowerCase()}</span>
      </span>
      <span className="ghs-sep" aria-hidden="true">/</span>
      <span className="ghs-work">
        <span className="ghs-dot ghs-dot-work" aria-hidden="true" />
        <span className="ghs-count">{working}</span>
        <span className="ghs-label">{t('kpi.working').toLowerCase()}</span>
      </span>
    </div>
  );
}
