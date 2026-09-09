import { useState, useEffect } from 'react';
import { DB } from '../lib/db.js';

// Modal that lets a parent pick an active list for a child.
// Shows the shared admin library and the child's own personal lists.
export default function AssignListModal({ child, onClose, onAssign }) {
  const [adminLists, setAdminLists] = useState([]);
  const [childLists, setChildLists] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [assigning,  setAssigning]  = useState(null); // listId being assigned
  const [error,      setError]      = useState('');

  useEffect(() => {
    Promise.all([
      DB.wordLists.getAdminLists(),
      DB.wordLists.getChildLists(child.id)
    ]).then(([admin, mine]) => {
      setAdminLists(admin);
      setChildLists(mine);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [child.id]);

  async function handleSelect(listId) {
    setAssigning(listId);
    setError('');
    try {
      await onAssign(listId);
      // onAssign resolves → parent closes the modal
    } catch (e) {
      setError(e.message || 'Could not assign list.');
      setAssigning(null);
    }
  }

  function ListOption({ list }) {
    const busy = assigning === list.id;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 0', borderBottom: '1px solid var(--border)'
      }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 600, margin: 0 }}>{list.name}</p>
          {list.description && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text)', margin: '2px 0 2px' }}>
              {list.description}
            </p>
          )}
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
            {list.wordCount ?? '?'} words
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => handleSelect(list.id)}
          disabled={!!assigning}
        >
          {busy ? '…' : 'Select'}
        </button>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-title">
          {child.avatar} {child.name} — Change List
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.88rem',
            marginBottom: 12, textAlign: 'center' }}>
            {error}
          </p>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <p>Loading lists…</p>
          </div>
        ) : (
          <>
            {/* Shared library */}
            <h3 style={{ marginBottom: 8, color: 'var(--primary)', fontSize: '0.95rem' }}>
              📚 Shared Library
            </h3>
            {adminLists.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                No shared lists available yet.
              </p>
            ) : (
              <div style={{ marginBottom: 20 }}>
                {adminLists.map(l => <ListOption key={l.id} list={l} />)}
              </div>
            )}

            {/* Child's own lists */}
            <h3 style={{ marginBottom: 8, color: 'var(--primary)', fontSize: '0.95rem' }}>
              🗒️ {child.name}'s Personal Lists
            </h3>
            {childLists.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                No personal lists yet. Import one from Word Lists.
              </p>
            ) : (
              <div style={{ marginBottom: 20 }}>
                {childLists.map(l => <ListOption key={l.id} list={l} />)}
              </div>
            )}
          </>
        )}

        <button className="btn btn-ghost btn-full" onClick={onClose} disabled={!!assigning}>
          Cancel
        </button>
      </div>
    </div>
  );
}
