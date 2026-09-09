import { useState, useMemo } from 'react';
import { DB } from '../lib/db.js';
import { normalizeWord } from '../lib/normalize.js';

// Fields shown in the diff table (excluding the word itself which is always shown)
const DIFF_FIELDS = ['pronunciation','definition','partOfSpeech','origin','sentence','audioLink','bundle'];

// Compare two word objects and return only the fields that differ (ignoring blanks)
function diffFields(existing, incoming) {
  const changed = {};
  DIFF_FIELDS.forEach(f => {
    const a = (existing[f] || '').trim();
    const b = (incoming[f] || '').trim();
    if (b && a !== b) changed[f] = { from: a, to: b };
  });
  // Also check the word itself (surface form)
  if ((incoming.word || '').trim() && incoming.word.trim() !== existing.word.trim()) {
    changed.word = { from: existing.word, to: incoming.word.trim() };
  }
  return changed;
}

export default function ImportDiffModal({ listId, listName, existingWords, incomingWords, onClose, onApplied }) {
  const [applying, setApplying] = useState(false);
  const [error,    setError]    = useState('');
  const [filter,   setFilter]   = useState('all'); // 'all' | 'changed' | 'new' | 'removed'

  // Build diff entries on mount (useMemo so it only runs once)
  const { changed, added, removed, unchanged } = useMemo(() => {
    const existingMap = {};
    existingWords.forEach(w => {
      existingMap[normalizeWord(w.word)] = w;
    });
    const incomingMap = {};
    incomingWords.forEach(w => {
      incomingMap[normalizeWord(w.word)] = w;
    });

    const changed   = []; // { existing, incoming, diff }
    const added     = []; // { incoming }
    const removed   = []; // { existing } — in current list but absent from file
    const unchanged = [];

    incomingWords.forEach(inc => {
      const key = normalizeWord(inc.word);
      const ex  = existingMap[key];
      if (!ex) {
        added.push({ incoming: inc, selected: true });
      } else {
        const diff = diffFields(ex, inc);
        if (Object.keys(diff).length > 0) {
          changed.push({ existing: ex, incoming: inc, diff, selected: true });
        } else {
          unchanged.push(ex);
        }
      }
    });

    // Words in the existing list that are absent from the incoming file.
    // These are shown as informational only — the update does not delete them.
    existingWords.forEach(ex => {
      if (!incomingMap[normalizeWord(ex.word)]) removed.push(ex);
    });

    return { changed, added, removed, unchanged };
  }, [existingWords, incomingWords]);

  // Selection state — track which entries are checked
  const [selectedChanged, setSelectedChanged] = useState(
    () => new Set(changed.map((_, i) => i))
  );
  const [selectedAdded, setSelectedAdded] = useState(
    () => new Set(added.map((_, i) => i))
  );

  function toggleChanged(i) {
    setSelectedChanged(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }
  function toggleAdded(i) {
    setSelectedAdded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }
  function selectAllChanged(val) {
    setSelectedChanged(val ? new Set(changed.map((_, i) => i)) : new Set());
  }
  function selectAllAdded(val) {
    setSelectedAdded(val ? new Set(added.map((_, i) => i)) : new Set());
  }

  const totalSelected = selectedChanged.size + selectedAdded.size;

  async function handleApply() {
    if (totalSelected === 0) return;
    setApplying(true); setError('');
    try {
      // Build the two arrays for the RPC
      const changes = [...selectedChanged].map(i => {
        const { existing, diff } = changed[i];
        const fields = { wordId: existing.wordId };
        Object.entries(diff).forEach(([f, { to }]) => { fields[f] = to; });
        return fields;
      });
      const newWords = [...selectedAdded].map(i => added[i].incoming);

      const newCount = await DB.wordLists.applyUpdate(listId, changes, newWords);
      onApplied(newCount);
    } catch (e) {
      setError(e.message || 'Could not apply changes.');
      setApplying(false);
    }
  }

  const labelStyle = { fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em' };
  const badgeBase  = { display:'inline-block', padding:'1px 8px', borderRadius:50,
    fontSize:'0.75rem', fontWeight:700 };

  const visibleChanged  = filter === 'new' || filter === 'removed' ? [] : changed;
  const visibleAdded    = filter === 'changed' || filter === 'removed' ? [] : added;
  const visibleRemoved  = filter === 'changed' || filter === 'new' ? [] : removed;

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 700, width: '95vw' }}>
        <div className="modal-title">📋 Review Changes — {listName}</div>

        {/* Summary bar */}
        <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
          <span style={{ ...badgeBase, background:'#fff3e0', color:'var(--warning)',
            border:'1px solid var(--warning)' }}>
            {changed.length} changed
          </span>
          <span style={{ ...badgeBase, background:'#e3fff2', color:'var(--secondary)',
            border:'1px solid var(--secondary)' }}>
            {added.length} new
          </span>
          <span style={{ ...badgeBase, background:'#f0f0f5', color:'var(--text-muted)',
            border:'1px solid var(--border)' }}>
            {unchanged.length} unchanged
          </span>
          {removed.length > 0 && (
            <span style={{ ...badgeBase, background:'#fff0f5', color:'var(--danger)',
              border:'1px solid var(--danger)' }}>
              {removed.length} not in file
            </span>
          )}
        </div>

        {/* Filter tabs */}
        <div style={{ display:'flex', gap:6, marginBottom:16 }}>
          {[['all','All'],['changed','Changed'],['new','New']].map(([val, label]) => (
            <button key={val} className={`filter-btn ${filter === val ? 'active' : ''}`}
              onClick={() => setFilter(val)}>{label}</button>
          ))}
          {removed.length > 0 && (
            <button className={`filter-btn ${filter === 'removed' ? 'active' : ''}`}
              onClick={() => setFilter('removed')}>Not in file ({removed.length})</button>
          )}
        </div>

        <div style={{ maxHeight: '50vh', overflowY: 'auto', marginBottom: 16 }}>

          {/* Changed words */}
          {visibleChanged.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                <span style={labelStyle}>Changed ({changed.length})</span>
                <label style={{ fontSize:'0.82rem', color:'var(--text-muted)', cursor:'pointer' }}>
                  <input type="checkbox" checked={selectedChanged.size === changed.length}
                    onChange={e => selectAllChanged(e.target.checked)}
                    style={{ marginRight:4 }} />
                  Select all
                </label>
              </div>
              {visibleChanged.map((entry, i) => (
                <div key={i} style={{ display:'flex', gap:10, padding:'10px 0',
                  borderBottom:'1px solid var(--border)', opacity: selectedChanged.has(i) ? 1 : 0.5 }}>
                  <input type="checkbox" checked={selectedChanged.has(i)}
                    onChange={() => toggleChanged(i)}
                    style={{ marginTop: 3, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight:700, margin:'0 0 6px' }}>{entry.existing.word}</p>
                    {Object.entries(entry.diff).map(([field, { from, to }]) => (
                      <div key={field} style={{ fontSize:'0.82rem', marginBottom:3 }}>
                        <span style={{ fontWeight:600, color:'var(--text-muted)',
                          textTransform:'capitalize' }}>{field}: </span>
                        {from && <span style={{ textDecoration:'line-through',
                          color:'var(--danger)', marginRight:4 }}>{from}</span>}
                        <span style={{ color:'var(--secondary)' }}>{to}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* New words */}
          {visibleAdded.length > 0 && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                <span style={labelStyle}>New Words ({added.length})</span>
                <label style={{ fontSize:'0.82rem', color:'var(--text-muted)', cursor:'pointer' }}>
                  <input type="checkbox" checked={selectedAdded.size === added.length}
                    onChange={e => selectAllAdded(e.target.checked)}
                    style={{ marginRight:4 }} />
                  Select all
                </label>
              </div>
              {visibleAdded.map((entry, i) => (
                <div key={i} style={{ display:'flex', gap:10, padding:'10px 0',
                  borderBottom:'1px solid var(--border)', opacity: selectedAdded.has(i) ? 1 : 0.5 }}>
                  <input type="checkbox" checked={selectedAdded.has(i)}
                    onChange={() => toggleAdded(i)}
                    style={{ marginTop: 3, flexShrink: 0 }} />
                  <div>
                    <p style={{ fontWeight:700, margin:'0 0 2px', color:'var(--secondary)' }}>
                      + {entry.incoming.word}
                    </p>
                    {entry.incoming.definition && (
                      <p style={{ fontSize:'0.82rem', color:'var(--text-muted)', margin:0 }}>
                        {entry.incoming.definition.substring(0, 80)}
                        {entry.incoming.definition.length > 80 ? '…' : ''}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Words not in the new file — informational only, not deleted */}
          {visibleRemoved.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                <span style={labelStyle}>Not in file — will stay ({removed.length})</span>
              </div>
              <p style={{ fontSize:'0.82rem', color:'var(--text-muted)', marginBottom:8 }}>
                These words are in the current list but absent from the uploaded file.
                They will not be removed — only additions and edits are applied.
              </p>
              {visibleRemoved.map((ex, i) => (
                <div key={ex.wordId || i} style={{ display:'flex', gap:10,
                  padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                  <span style={{ fontWeight:600, fontSize:'0.88rem',
                    color:'var(--text-muted)', flex:1 }}>{ex.word}</span>
                  {ex.definition && (
                    <span style={{ fontSize:'0.78rem', color:'var(--text-muted)',
                      flex:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {ex.definition}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {changed.length === 0 && added.length === 0 && removed.length === 0 && (
            <div className="empty-state" style={{ padding: '32px 0' }}>
              <div className="icon">✅</div>
              <h3>No differences found</h3>
              <p>The uploaded file matches the current list exactly.</p>
            </div>
          )}
        </div>

        {error && (
          <p style={{ color:'var(--danger)', fontSize:'0.88rem',
            marginBottom:12, textAlign:'center' }}>{error}</p>
        )}

        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-full" onClick={onClose} disabled={applying}>
            Cancel
          </button>
          <button className="btn btn-primary btn-full" onClick={handleApply}
            disabled={applying || totalSelected === 0}>
            {applying ? 'Applying…' : `Apply ${totalSelected} Change${totalSelected !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
