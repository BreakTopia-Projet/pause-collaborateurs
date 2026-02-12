import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import './ApprovalsPanel.css';

const API = '/api';

export default function ApprovalsPanel({ getToken }) {
  const { t } = useLanguage();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [processing, setProcessing] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/approvals?status=${statusFilter}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) { setUsers([]); return; }
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [getToken, statusFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Filter by search
  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower
    ? users.filter((u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower) ||
        (u.teamCode && u.teamCode.toLowerCase().includes(searchLower))
      )
    : users;

  const pendingCount = users.filter((u) => u.approvalStatus === 'pending').length;

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((u) => u.id)));
    }
  };

  const handleApprove = async (userIds) => {
    setProcessing(true);
    try {
      const res = await fetch(`${API}/admin/approvals/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ userIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Erreur');
        return;
      }
      const data = await res.json();
      showToast(`${data.approvedCount} ${t('approvals.approved')}`);
      await fetchUsers();
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (userIds) => {
    const reason = window.prompt(t('approvals.rejectReasonPrompt') || 'Raison du refus (optionnel) :');
    if (reason === null) return; // cancelled
    setProcessing(true);
    try {
      const res = await fetch(`${API}/admin/approvals/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ userIds, reason: reason || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Erreur');
        return;
      }
      const data = await res.json();
      showToast(`${data.rejectedCount} ${t('approvals.rejected')}`);
      await fetchUsers();
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '–';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="approvals-panel">
      <div className="approvals-header">
        <h2 className="approvals-title">{t('approvals.title')}</h2>
        {statusFilter === 'pending' && (
          <span className="approvals-badge">{pendingCount} {t('approvals.pendingCount')}</span>
        )}
      </div>

      <div className="approvals-toolbar">
        <div className="approvals-filters">
          <select
            className="approvals-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="pending">{t('approvals.filterPending')}</option>
            <option value="rejected">{t('approvals.filterRejected')}</option>
            <option value="all">{t('approvals.filterAll')}</option>
          </select>
          <input
            type="text"
            className="approvals-search"
            placeholder={t('approvals.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {selected.size > 0 && (
          <div className="approvals-bulk-actions">
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={processing}
              onClick={() => handleApprove([...selected])}
            >
              {t('approvals.approveSelected')} ({selected.size})
            </button>
            <button
              type="button"
              className="btn btn-small approvals-btn-reject"
              disabled={processing}
              onClick={() => handleReject([...selected])}
            >
              {t('approvals.rejectSelected')} ({selected.size})
            </button>
          </div>
        )}
      </div>

      {toast && <div className="approvals-toast">{toast}</div>}

      {loading ? (
        <p className="approvals-loading">{t('app.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="approvals-empty">{t('approvals.noResults')}</p>
      ) : (
        <table className="approvals-table">
          <thead>
            <tr>
              <th className="approvals-th-check">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleSelectAll}
                  aria-label={t('approvals.selectAll')}
                />
              </th>
              <th>{t('approvals.colEmployee')}</th>
              <th>{t('approvals.colEmail')}</th>
              <th>{t('approvals.colTeamCode')}</th>
              <th>{t('approvals.colDate')}</th>
              <th>{t('approvals.colStatus')}</th>
              <th>{t('approvals.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className={selected.has(u.id) ? 'approvals-row-selected' : ''}>
                <td className="approvals-td-check">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggleSelect(u.id)}
                    aria-label={`${u.firstName} ${u.lastName}`}
                  />
                </td>
                <td className="approvals-td-name">{u.firstName} {u.lastName}</td>
                <td className="approvals-td-email">{u.email}</td>
                <td className="approvals-td-code">{u.teamCode || '–'}</td>
                <td className="approvals-td-date">{formatDate(u.createdAt)}</td>
                <td>
                  <span className={`approvals-status approvals-status-${u.approvalStatus}`}>
                    {u.approvalStatus === 'pending' && t('approvals.statusPending')}
                    {u.approvalStatus === 'rejected' && t('approvals.statusRejected')}
                    {u.approvalStatus === 'approved' && t('approvals.statusApproved')}
                  </span>
                  {u.rejectedReason && (
                    <span className="approvals-reason" title={u.rejectedReason}>
                      ({u.rejectedReason})
                    </span>
                  )}
                </td>
                <td className="approvals-td-actions">
                  {u.approvalStatus !== 'approved' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={processing}
                      onClick={() => handleApprove([u.id])}
                    >
                      {t('approvals.approve')}
                    </button>
                  )}
                  {u.approvalStatus !== 'rejected' && (
                    <button
                      type="button"
                      className="btn btn-small approvals-btn-reject"
                      disabled={processing}
                      onClick={() => handleReject([u.id])}
                    >
                      {t('approvals.reject')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
