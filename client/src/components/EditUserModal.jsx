import { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import './EditUserModal.css';

const API = '/api';

export default function EditUserModal({ member, onClose, onSave, getToken }) {
  const { t } = useLanguage();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [resetCounter, setResetCounter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (member) {
      setFirstName(member.firstName ?? '');
      setLastName(member.lastName ?? '');
      setEmail(member.email ?? '');
      setResetCounter(false);
    }
  }, [member]);

  if (!member) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`${API}/admin/users/${member.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          resetCounter,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onSave(data);
      onClose();
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
      <div className="modal-content edit-user-modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="edit-user-title">{t('admin.editUser')}</h2>
        <form onSubmit={handleSubmit}>
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
            {t('auth.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={resetCounter}
              onChange={(e) => setResetCounter(e.target.checked)}
            />
            {t('admin.resetCounter')}
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('admin.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '…' : t('admin.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
