import { useLanguage } from '../context/LanguageContext';
import './LanguageSelector.css';

export default function LanguageSelector() {
  const { locale, setLocale, t, supportedLocales } = useLanguage();

  return (
    <div className="language-selector-wrap" role="group" aria-label={t('language.label')}>
      <label htmlFor="lang-select" className="language-selector-label">
        <span className="language-selector-icon" aria-hidden>🌐</span>
      </label>
      <select
        id="lang-select"
        className="language-selector"
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label={t('language.label')}
      >
        {supportedLocales.map((loc) => (
          <option key={loc} value={loc}>
            {t(`language.${loc}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
