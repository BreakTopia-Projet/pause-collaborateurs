import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import './AccountPage.css';

const API = '/api';

export default function AccountPage() {
  const { user, getToken } = useAuth();
  const { t } = useLanguage();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Client-side validation
    if (newPassword.length < 8) {
      setError(t('account.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('account.passwordMismatch'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API}/auth/me/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setSuccess(t('account.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="account-page">
      <main className="account-main">
        <h1 className="pg-page-title" style={{ marginBottom: '1rem' }}>{t('account.title')}</h1>
        <section className="account-section">
          <h2>{t('account.changePassword')}</h2>
          <form className="account-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            {success && <div className="auth-success" role="status">{success}</div>}

            <label>
              {t('account.currentPassword')}
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            <label>
              {t('account.newPassword')}
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            <label>
              {t('account.confirmPassword')}
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('account.saving') : t('account.save')}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
