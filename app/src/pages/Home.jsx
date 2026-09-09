import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { DB } from '../lib/db.js';
import AddChildModal from '../components/AddChildModal.jsx';
import EditChildModal from '../components/EditChildModal.jsx';
import Layout from '../components/Layout.jsx';
import AssignListModal from '../components/AssignListModal.jsx';

// ── Confirmation modal ────────────────────────────────────────────────────────
// Replaces window.confirm() + window.alert() for destructive actions.
// Accepts an async onConfirm — runs it when the user clicks the action button,
// shows an inline error if it throws, and only closes on success or Cancel.
function ConfirmModal({ title, message, confirmLabel, variant = 'danger', onConfirm, onCancel }) {
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const confirmStyle = {
    danger:  { background: 'var(--danger)',  color: '#fff', border: '2px solid var(--danger)'  },
    warning: { background: 'var(--warning)', color: '#fff', border: '2px solid var(--warning)' },
  }[variant];

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      // onConfirm resolves → caller's state change will unmount this modal
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-title" style={{
          color: variant === 'danger' ? 'var(--danger)' : 'var(--warning)'
        }}>
          {title}
        </div>
        <p style={{ textAlign: 'center', marginBottom: 20 }}>{message}</p>
        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.88rem',
            marginBottom: 16, textAlign: 'center' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-full" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-full"
            style={confirmStyle}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ correct, incorrect, total }) {
  const pctCorrect   = total ? Math.round((correct   / total) * 100) : 0;
  const pctIncorrect = total ? Math.round((incorrect / total) * 100) : 0;
  return (
    <div>
      <div style={{ display:'flex', height:10, borderRadius:50, overflow:'hidden', background:'var(--border)', marginBottom:6 }}>
        <div style={{ width:`${pctCorrect}%`,   background:'var(--secondary)', transition:'width 0.6s' }} />
        <div style={{ width:`${pctIncorrect}%`, background:'var(--danger)',    transition:'width 0.6s' }} />
      </div>
      <div style={{ display:'flex', gap:12, fontSize:'0.78rem', color:'var(--text-muted)' }}>
        <span style={{ color:'var(--secondary)', fontWeight:600 }}>✔ {correct} correct</span>
        <span style={{ color:'var(--danger)',    fontWeight:600 }}>✘ {incorrect} incorrect</span>
        <span>{total - correct - incorrect} untested</span>
      </div>
    </div>
  );
}

// ── Child card ────────────────────────────────────────────────────────────────
function ChildCard({ child, hist, wordCount, activeListName, isDeleting, isResetting, onSelect, onDelete, onReset, onEdit, onChangeList }) {
  const total = wordCount || 0;
  return (
    <div className="card" style={{ display:'flex', flexDirection:'column', gap:16,
      opacity: isDeleting ? 0.5 : 1, transition:'opacity 0.2s' }}>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div className="avatar avatar-lg">{child.avatar}</div>
          <div>
            <h3 style={{ marginBottom:2 }}>{child.name}</h3>
          </div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button className="btn btn-ghost btn-sm" onClick={onEdit} disabled={isDeleting}
            title="Edit name / avatar">✏️</button>
          <button className="btn btn-ghost btn-sm" onClick={onDelete} disabled={isDeleting}
            style={{ color:'var(--danger)', borderColor:'var(--danger)' }}>
            {isDeleting ? '…' : '🗑️'}
          </button>
        </div>
      </div>

      {hist && total > 0 && (
        <ProgressBar correct={hist.correct} incorrect={hist.incorrect} total={total} />
      )}
      {total === 0 && (
        <p style={{ fontSize:'0.85rem', color:'var(--text-muted)' }}>No word list assigned yet.</p>
      )}

      <div style={{ fontSize:'0.82rem', color:'var(--text-muted)', display:'flex',
        alignItems:'center', justifyContent:'space-between' }}>
        <span>📋 {activeListName || 'No list assigned'}</span>
        <button className="btn btn-ghost btn-sm" onClick={onChangeList}
          disabled={isDeleting} style={{ fontSize:'0.78rem' }}>Change List</button>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={() => onSelect(child, '/review')}>
          📖 Review
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => onSelect(child, '/practice')}>
          ✏️ Practice
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onReset} disabled={isResetting}
          style={{ color:'var(--warning)', borderColor:'var(--warning)', marginLeft:'auto' }}
          title="Reset all progress for this child">
          {isResetting ? '…' : '↺ Reset'}
        </button>
      </div>
    </div>
  );
}

// ── Home ────────────────────────────────────────────────────────────────────────
export default function Home() {
  const {
    childList, childWordCounts, selectChild,
    addChildToList, removeChildFromList,
    resetChildProgress, histCounts, updateChildInList, assignChildList,
    profile,
  } = useApp();

  const [showAdd,      setShowAdd]      = useState(false);
  const [editChild,    setEditChild]    = useState(null);
  const [deletingId,   setDeletingId]   = useState(null);
  const [resettingId,  setResettingId]  = useState(null);
  const [activeListNames, setActiveListNames] = useState({}); // { childId: listName }
  // null | child object — which child's list picker is open
  const [assignListChild, setAssignListChild] = useState(null);
  // Pending confirm dialog: null | { title, message, confirmLabel, variant, onConfirm }
  const [confirmDialog, setConfirmDialog] = useState(null);
  const navigate = useNavigate();

  // Load the active list name for each child so the card can display it
  useEffect(() => {
    if (!childList.length) return;
    Promise.all(
      childList.map(c =>
        DB.wordLists.getActiveListName(c.id)
          .then(name => ({ id: c.id, name }))
          .catch(() => ({ id: c.id, name: null }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.id] = r.name; });
      setActiveListNames(map);
    });
  }, [childList]);

  function handleDelete(child) {
    setConfirmDialog({
      title:        '🗑️ Delete Child',
      message:      `Delete ${child.name} and all their progress? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant:      'danger',
      onConfirm:    async () => {
        setDeletingId(child.id);
        try {
          await DB.users.delete(child.id);
          removeChildFromList(child.id);
          setConfirmDialog(null);
        } finally {
          setDeletingId(null);
        }
      },
    });
  }

  function handleReset(child) {
    setConfirmDialog({
      title:        '↺ Reset Progress',
      message:      `Reset all progress for ${child.name}? Their word list will stay. This cannot be undone.`,
      confirmLabel: 'Reset',
      variant:      'warning',
      onConfirm:    async () => {
        setResettingId(child.id);
        try {
          await resetChildProgress(child.id);
          setConfirmDialog(null);
        } finally {
          setResettingId(null);
        }
      },
    });
  }

  async function handleSelect(child, path) {
    await selectChild(child);
    navigate(path);
  }

  function handleChildAdded(newChild) {
    if (newChild) {
      // Modal already called DB.users.create and returned the child.
      // We add it to the list here — the modal no longer does this
      // to prevent the double-add that occurred previously.
      addChildToList(newChild);
    }
    setShowAdd(false);
  }

  function handleChildEdited(updatedChild) {
    setEditChild(null);
    if (updatedChild) updateChildInList(updatedChild);
  }

  async function handleAssignList(child, listId) {
    await assignChildList(child.id, listId);
    // Refresh the active list name shown on the card
    const name = await DB.wordLists.getActiveListName(child.id).catch(() => null);
    setActiveListNames(prev => ({ ...prev, [child.id]: name }));
    setAssignListChild(null);
  }

  // If admin has no child accounts yet, give them a clear signpost to their
  // workspace, with an option to also add a child profile.
  if (profile?.role === 'admin' && childList.length === 0) {
    return (
      <Layout>
        <div className="empty-state">
          <div className="icon">📚</div>
          <h3>Welcome, {profile.name}</h3>
          <p style={{ marginBottom:24 }}>
            Your workspace is the shared word library.
          </p>
          <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
            <Link to="/word-lists">
              <button className="btn btn-primary">Go to Word Lists</button>
            </Link>
            <button className="btn btn-ghost" onClick={() => setShowAdd(true)}>+ Add Child</button>
          </div>
        </div>
        {showAdd && <AddChildModal onClose={handleChildAdded} />}
      </Layout>
    );
  }

  return (
    <Layout>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:28 }}>
        <div>
          <h1 style={{ marginBottom:4 }}>Home</h1>
          <p>Welcome back, {profile?.name}!</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Child</button>
      </div>

      {childList.length === 0 ? (
        <div className="empty-state">
          <div className="icon">👧</div>
          <h3>No child account added</h3>
          <p style={{ marginBottom:20 }}>Add a child profile to get started.</p>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Child</button>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:20 }}>
          {childList.map(child => (
            <ChildCard
              key={child.id}
              child={child}
              hist={histCounts[child.id] || null}
              wordCount={childWordCounts[child.id] ?? 0}
              isDeleting={deletingId  === child.id}
              isResetting={resettingId === child.id}
              activeListName={activeListNames[child.id] ?? null}
              onSelect={handleSelect}
              onDelete={() => handleDelete(child)}
              onReset={() => handleReset(child)}
              onEdit={() => setEditChild(child)}
              onChangeList={() => setAssignListChild(child)}
            />
          ))}
        </div>
      )}

      {showAdd       && <AddChildModal  onClose={handleChildAdded} />}
      {editChild     && <EditChildModal child={editChild} onClose={handleChildEdited} />}
      {assignListChild && (
        <AssignListModal
          child={assignListChild}
          onClose={() => setAssignListChild(null)}
          onAssign={(listId) => handleAssignList(assignListChild, listId)}
        />
      )}
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </Layout>
  );
}
