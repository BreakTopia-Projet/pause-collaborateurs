import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import logo from '../assets/breaktopia-logo.png';
import './Auth.css';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('fr');
  const [teamCode, setTeamCode] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { register } = useAuth();
  const { t, supportedLocales } = useLanguage();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setSubmitting(true);
    try {
      const result = await register(email, password, firstName, lastName, preferredLanguage, teamCode.trim());
      if (result?.pending) {
        setSuccessMessage(t('auth.registrationPending'));
      }
    } catch (err) {
      setError(err.message || t('auth.errorRegister'));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = firstName.trim() && lastName.trim() && email.trim() && password && teamCode.trim();

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={logo} alt="Breaktopia" className="login-logo" />
          <h1>{t('auth.createAccount')}</h1>
          <p className="auth-copyright">&copy;2025, Developed by C&eacute;dric Pell&eacute;, All rights reserved</p>
        </div>
        {successMessage && (
          <div className="auth-success-message" role="status">
            <p>{successMessage}</p>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: '0.75rem', display: 'inline-block' }}>
              {t('auth.goToLogin')}
            </Link>
          </div>
        )}
        <form onSubmit={handleSubmit} className="auth-form" style={successMessage ? { display: 'none' } : {}}>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <label>
            {t('auth.firstName')}
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoComplete="given-name"
            />
          </label>
          <label>
            {t('auth.lastName')}
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              autoComplete="family-name"
            />
          </label>
          <label>
            {t('auth.teamCodeLabel')}
            <input
              type="text"
              value={teamCode}
              onChange={(e) => setTeamCode(e.target.value)}
              required
              placeholder={t('auth.teamCodePlaceholder')}
              autoComplete="off"
              spellCheck="false"
            />
            <span className="auth-helper">{t('auth.teamCodeHelp')}</span>
          </label>
          <label>
            {t('auth.preferredLanguage')}
            <select
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value)}
              className="auth-select"
              aria-label={t('auth.preferredLanguage')}
            >
              {supportedLocales.map((loc) => (
                <option key={loc} value={loc}>{t(`language.${loc}`)}</option>
              ))}
            </select>
          </label>
          <label>
            {t('auth.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
            />
          </label>
          <label>
            {t('auth.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={6}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting || !canSubmit}>
            {submitting ? t('auth.signingUp') : t('auth.signUp')}
          </button>
        </form>
        <p className="auth-switch">
          {t('auth.alreadyAccount')}{' '}
          <Link to="/login" className="btn-link">{t('auth.goToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}
