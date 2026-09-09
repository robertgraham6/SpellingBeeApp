import { useState } from 'react';
import { DB } from '../lib/db.js';

// Creates a new child-scope word list from manually entered words.
// Each line in the textarea is one word, optionally followed by a pipe
// separator and a definition:
//   ephemeral
//   ephemeral | lasting for a very short time
export default function AddWordsModal({ childId, childName, createdBy, onClose, onSaved }) {
  const [listName, setListName] = useState(`${childName}'s List ${new Date().toLocaleDateString()}`);
  const [rawText,  setRawText]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  // Parse the textarea into word objects
  function parseWords() {
    return rawText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [word, ...rest] = line.split('|');
        return { word: word.trim(), definition: rest.join('|').trim() };
      })
      .filter(w => w.word.length > 0);
  }

  const parsed = parseWords();

  async function handleSave() {
    if (!listName.trim())  return setError('Please enter a list name.');
    if (parsed.length === 0) return setError('Please enter at least one word.');
    setSaving(true); setError('');
    try {
      const list = await DB.wordLists.createManual(createdBy, childId, listName.trim(), parsed);
      onSaved({ ...list, wordCount: parsed.length });
    } catch (e) {
      setError(e.message || 'Could not save the list.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-title">Add Words for {childName}</div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.88rem',
            marginBottom: 12, textAlign: 'center' }}>
            {error}
          </p>
        )}

        <label className="field-label">List Name</label>
        <input
          className="input"
          value={listName}
          onChange={e => setListName(e.target.value)}
          style={{ marginBottom: 16 }}
        />

        <label className="field-label">
          Words{' '}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            — one per line; optionally add <code>|</code> then a definition
          </span>
        </label>
        <textarea
          className="input"
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          placeholder={'ephemeral\nambiguous | open to more than one interpretation\npersevere'}
          rows={10}
          style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.9rem',
            marginBottom: 8, lineHeight: 1.6 }}
        />
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 20 }}>
          {parsed.length} word{parsed.length !== 1 ? 's' : ''} detected
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-full" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary btn-full" onClick={handleSave}
            disabled={saving || parsed.length === 0 || !listName.trim()}>
            {saving ? 'Saving…' : `Save ${parsed.length > 0 ? `(${parsed.length} words)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
