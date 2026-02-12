import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { APPROVAL_ERROR_CODES } from '../../../shared/approvalStatus.js';
import logo from '../assets/breaktopia-logo.png';
import './Auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [approvalMessage, setApprovalMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const { t } = useLanguage();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setApprovalMessage('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      if (err.errorCode === APPROVAL_ERROR_CODES.PENDING) {
        setApprovalMessage(t('auth.approvalPending'));
      } else if (err.errorCode === APPROVAL_ERROR_CODES.REJECTED) {
        setApprovalMessage(t('auth.approvalRejected'));
      } else {
        setError(err.message || t('auth.errorLogin'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={logo} alt="Breaktopia" className="login-logo" />
          <p className="auth-copyright">&copy;2025, Developed by C&eacute;dric Pell&eacute;, All rights reserved</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error" role="alert">{error}</div>}
          {approvalMessage && <div className="auth-approval-message" role="status">{approvalMessage}</div>}
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
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? t('auth.loggingIn') : t('auth.login')}
          </button>
        </form>
        <p className="auth-switch">
          {t('auth.noAccount')}{' '}
          <Link to="/signup" className="btn-link">{t('auth.goToSignUp')}</Link>
        </p>
      </div>
    </div>
  );
}
