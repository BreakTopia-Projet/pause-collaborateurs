import { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import './EditUserModal.css';

/**
 * Modal for creating or editing a team.
 * Props:
 *   team    — null for create, { id, name, code, breakCapacity } for edit
 *   onClose — called to dismiss
 *   onSave  — async (payload) => void
 */
export default function TeamFormModal({ team, onClose, onSave }) {
  const { t } = useLanguage();
  const isEdit = !!team;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [breakCapacity, setBreakCapacity] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (team) {
      setName(team.name || '');
      setCode(team.code || '');
      setBreakCapacity(team.breakCapacity ?? 2);
    } else {
      setName('');
      setCode('');
      setBreakCapacity(2);
    }
    setError('');
  }, [team]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError(t('teamMgmt.nameRequired')); return; }
    if (!code.trim()) { setError(t('teamMgmt.codeRequired')); return; }

    const cap = parseInt(breakCapacity, 10);
    const payload = {
      name: name.trim(),
      code: code.trim(),
      breakCapacity: Number.isNaN(cap) || cap < 0 || cap > 50 ? 2 : cap,
    };

    setSaving(true);
    try {
      await onSave(payload);
    } catch (err) {
      setError(err.message || 'Erreur');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2>{isEdit ? t('teamMgmt.editTeam') : t('teamMgmt.createTeam')}</h2>

        {error && <div className="auth-error" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
            {t('teamMgmt.teamName')}
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
              placeholder="ex: DMC Marketing"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
            {t('teamMgmt.teamCode')}
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
              placeholder="ex: DMC-MK1"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
            {t('teamMgmt.breakCapacity')}
            <input
              type="number"
              min="0"
              max="50"
              value={breakCapacity}
              onChange={(e) => setBreakCapacity(e.target.value)}
              style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', width: 100 }}
            />
          </label>

          <div className="modal-actions" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              {t('teamMgmt.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '…' : t('teamMgmt.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
