import { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import './EditUserModal.css';

const API = '/api';

export default function ChangeTeamModal({ member, teams, onClose, onChanged, getToken }) {
  const { t } = useLanguage();
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (member) {
      setSelectedTeamId(member.teamId ?? '');
      setError('');
    }
  }, [member]);

  if (!member) return null;

  async function handleConfirm() {
    setError('');
    const newTeamId = parseInt(selectedTeamId, 10);
    if (Number.isNaN(newTeamId)) {
      setError(t('teamChange.selectTeam'));
      return;
    }
    if (newTeamId === member.teamId) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API}/admin/users/${member.id}/team`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ teamId: newTeamId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onChanged(data);
      onClose();
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="change-team-title">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 id="change-team-title">{t('teamChange.title')}</h2>
        <p style={{ margin: '0.75rem 0 0.5rem', fontSize: '0.875rem' }}>
          <strong>{member.firstName} {member.lastName}</strong> ({member.email})
        </p>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {t('admin.selectTeam')}: <strong>{member.teamName ?? '–'}</strong>
        </p>

        {error && <div className="auth-error" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500, marginBottom: '1rem' }}>
          {t('teamChange.selectTeam')}
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', minWidth: '200px' }}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {t('teamChange.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving ? '…' : t('teamChange.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
