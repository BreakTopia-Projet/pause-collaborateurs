import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import './EditUserModal.css';

const API = '/api';

export default function ConfirmDeleteModal({ member, onClose, onDeleted, getToken }) {
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  if (!member) return null;

  async function handleConfirm() {
    setError('');
    setDeleting(true);
    try {
      const res = await fetch(`${API}/admin/users/${member.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onDeleted(member.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 id="delete-user-title">{t('deleteUser.title')}</h2>
        <p style={{ margin: '0.75rem 0 1rem', fontSize: '0.875rem', lineHeight: 1.5 }}>
          <strong>{member.firstName} {member.lastName}</strong> ({member.email})
        </p>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          {t('deleteUser.message')}
        </p>
        {error && <div className="auth-error" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={deleting}>
            {t('deleteUser.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger"
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? '…' : t('deleteUser.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
