import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations, supportedLocales } from '../i18n/translations';

const LANG_STORAGE_KEY = 'pause_lang';

const LanguageContext = createContext(null);

export function LanguageProvider({ children, userPreferredLanguage, onLanguageUpdate }) {
  const [locale, setLocaleState] = useState(() => {
    if (userPreferredLanguage && supportedLocales.includes(userPreferredLanguage)) {
      return userPreferredLanguage;
    }
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY);
      return stored && supportedLocales.includes(stored) ? stored : 'fr';
    } catch {
      return 'fr';
    }
  });

  // Sync locale when user logs in and brings a preferred language
  useEffect(() => {
    if (userPreferredLanguage && supportedLocales.includes(userPreferredLanguage) && userPreferredLanguage !== locale) {
      setLocaleState(userPreferredLanguage);
    }
  }, [userPreferredLanguage]);

  const setLocale = useCallback(
    (newLocale) => {
      if (!supportedLocales.includes(newLocale)) return;
      setLocaleState(newLocale);
      try {
        localStorage.setItem(LANG_STORAGE_KEY, newLocale);
      } catch {}
      onLanguageUpdate?.(newLocale);
    },
    [onLanguageUpdate]
  );

  const t = useCallback(
    (key) => {
      const keys = key.split('.');
      let value = translations[locale];
      for (const k of keys) {
        value = value?.[k];
      }
      return value ?? key;
    },
    [locale]
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, supportedLocales }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
