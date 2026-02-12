import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import ChangeTeamModal from './ChangeTeamModal';
import './UserDetailModal.css';

const API = '/api';

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(
      d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
    );
  }
  return days;
}

export default function UserDetailModal({ member, teams, onClose, onMemberUpdated, onMemberDeleted }) {
  const { user, getToken } = useAuth();
  const { t } = useLanguage();
  const [tab, setTab] = useState('activity');
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showChangeTeam, setShowChangeTeam] = useState(false);

  useEffect(() => {
    if (member) {
      setEditFirstName(member.firstName ?? '');
      setEditLastName(member.lastName ?? '');
      setEditEmail(member.email ?? '');
      setError('');
      setSuccess('');
      setTab('activity');
    }
  }, [member]);

  if (!member) return null;

  const days = last7Days();
  const isSelf = member.id === user?.id;
  const isSuperadminTarget = member.role === 'superadmin';
  const isSuperadminActor = user?.role === 'superadmin';

  /* ── Profile save ── */
  async function handleSaveProfile(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const res = await fetch(`${API}/admin/users/${member.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          firstName: editFirstName.trim(),
          lastName: editLastName.trim(),
          email: editEmail.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onMemberUpdated({ ...member, firstName: data.firstName, lastName: data.lastName, email: data.email });
      setSuccess('OK');
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  /* ── Reset counter ── */
  async function handleResetCounter() {
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`${API}/admin/users/${member.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ resetCounter: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onMemberUpdated({
        ...member,
        breakStats: { byDay: {}, weeklyTotalSeconds: 0 },
      });
      setSuccess(t('admin.resetCounter') + ' ✓');
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  /* ── Role change ── */
  async function handleSetRole(newRole) {
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`${API}/admin/users/${member.id}/role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onMemberUpdated({ ...member, role: data.role });
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  /* ── Status badge ── */
  function statusBadge(status) {
    const labels = {
      working: t('team.working'),
      break: t('team.break'),
      extended_break: t('team.extendedBreak'),
    };
    const cls =
      status === 'working'
        ? 'ud-status-working'
        : status === 'extended_break'
        ? 'ud-status-extended'
        : 'ud-status-break';
    return <span className={`ud-status-badge ${cls}`}>{labels[status] || status}</span>;
  }

  return (
    <>
      <div className="modal-overlay ud-overlay" onClick={onClose}>
        <div className="ud-panel" onClick={(e) => e.stopPropagation()}>
          {/* ── Header ── */}
          <div className="ud-header">
            <button type="button" className="ud-close" onClick={onClose} aria-label="Close">
              &times;
            </button>
            <div className="ud-identity">
              <div className="ud-avatar">
                {(member.firstName?.[0] || '').toUpperCase()}
                {(member.lastName?.[0] || '').toUpperCase()}
              </div>
              <div>
                <h2 className="ud-name">{member.firstName} {member.lastName}</h2>
                <span className="ud-email">{member.email}</span>
              </div>
            </div>
            <div className="ud-meta">
              <span className="ud-meta-item">
                <span className="ud-meta-label">{t('admin.selectTeam')}</span>
                <strong>{member.teamName ?? '–'}</strong>
              </span>
              <span className="ud-meta-item">
                <span className="ud-meta-label">{t('admin.role')}</span>
                <span className={`role-badge role-${member.role}`}>
                  {member.role === 'superadmin' && t('admin.roleSuperadmin')}
                  {member.role === 'admin' && t('admin.roleAdmin')}
                  {member.role === 'user' && t('admin.roleUser')}
                </span>
              </span>
              <span className="ud-meta-item">
                <span className="ud-meta-label">{t('userDetail.currentStatus')}</span>
                {statusBadge(member.liveStatus || 'working')}
              </span>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="ud-tabs">
            <button
              type="button"
              className={`ud-tab ${tab === 'activity' ? 'ud-tab-active' : ''}`}
              onClick={() => setTab('activity')}
            >
              {t('userDetail.tabActivity')}
            </button>
            <button
              type="button"
              className={`ud-tab ${tab === 'admin' ? 'ud-tab-active' : ''}`}
              onClick={() => setTab('admin')}
            >
              {t('userDetail.tabAdmin')}
            </button>
          </div>

          {/* ── Tab content ── */}
          <div className="ud-body">
            {tab === 'activity' && (
              <div className="ud-activity">
                <h3 className="ud-section-title">{t('userDetail.dailyBreakdown')}</h3>
                <table className="ud-day-table">
                  <thead>
                    <tr>
                      {days.map((d) => (
                        <th key={d}>{d.slice(5)}</th>
                      ))}
                      <th className="ud-week-col">{t('userDetail.weekTotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {days.map((d) => {
                        const sec = member.breakStats?.byDay?.[d] ?? 0;
                        return (
                          <td key={d} className={sec > 0 ? 'ud-has-data' : ''}>
                            {formatDuration(sec)}
                          </td>
                        );
                      })}
                      <td className="ud-week-col ud-week-val">
                        {formatDuration(member.breakStats?.weeklyTotalSeconds ?? 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Current break duration if on break */}
                {member.liveStatus && member.liveStatus !== 'working' && (
                  <div className="ud-current-break">
                    <span className="ud-current-break-label">{t('team.duration')}</span>
                    <strong>{formatDuration(member.elapsedSeconds ?? 0)}</strong>
                  </div>
                )}
              </div>
            )}

            {tab === 'admin' && (
              <div className="ud-admin">
                {error && <div className="auth-error ud-error" role="alert">{error}</div>}
                {success && <div className="ud-success">{success}</div>}

                {/* ── Profile section ── */}
                <div className="ud-section">
                  <h3 className="ud-section-title">{t('userDetail.sectionProfile')}</h3>
                  <form className="ud-form" onSubmit={handleSaveProfile}>
                    <label>
                      {t('auth.firstName')}
                      <input
                        type="text"
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      {t('auth.lastName')}
                      <input
                        type="text"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      {t('auth.email')}
                      <input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        required
                      />
                    </label>
                    <button type="submit" className="btn btn-primary btn-small" disabled={saving}>
                      {saving ? '…' : t('admin.save')}
                    </button>
                  </form>
                </div>

                {/* ── Role section ── */}
                {!isSuperadminTarget && (
                  <div className="ud-section">
                    <h3 className="ud-section-title">{t('userDetail.sectionRole')}</h3>
                    <div className="ud-role-actions">
                      {member.role === 'admin' && isSuperadminActor ? (
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => handleSetRole('user')}
                          disabled={saving}
                        >
                          {t('admin.removeAdmin')}
                        </button>
                      ) : member.role === 'user' ? (
                        <button
                          type="button"
                          className="btn btn-small btn-primary"
                          onClick={() => handleSetRole('admin')}
                          disabled={saving}
                        >
                          {t('admin.promoteAdmin')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* ── Team section (super-admin only) ── */}
                {isSuperadminActor && (
                  <div className="ud-section">
                    <h3 className="ud-section-title">{t('userDetail.sectionTeam')}</h3>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setShowChangeTeam(true)}
                      disabled={saving}
                    >
                      {t('teamChange.button')}
                    </button>
                  </div>
                )}

                {/* ── Reset counter ── */}
                <div className="ud-section">
                  <h3 className="ud-section-title">{t('admin.resetCounter')}</h3>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={handleResetCounter}
                    disabled={saving}
                  >
                    {t('admin.resetCounter')}
                  </button>
                </div>

                {/* ── Danger zone ── */}
                {!isSuperadminTarget && !isSelf && (
                  <div className="ud-section ud-danger-zone">
                    <h3 className="ud-section-title ud-danger-title">{t('userDetail.sectionDanger')}</h3>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => setShowDeleteModal(true)}
                      disabled={saving}
                    >
                      {t('deleteUser.button')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showDeleteModal && (
        <ConfirmDeleteModal
          member={member}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={(id) => {
            setShowDeleteModal(false);
            onMemberDeleted(id);
          }}
          getToken={getToken}
        />
      )}

      {showChangeTeam && (
        <ChangeTeamModal
          member={member}
          teams={teams}
          onClose={() => setShowChangeTeam(false)}
          onChanged={(updated) => {
            setShowChangeTeam(false);
            onMemberUpdated({ ...member, teamId: updated.teamId, teamName: updated.teamName });
          }}
          getToken={getToken}
        />
      )}
    </>
  );
}
