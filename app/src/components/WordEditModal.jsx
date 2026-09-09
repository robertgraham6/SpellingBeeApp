import { useState } from 'react';
import { DB } from '../lib/db.js';

const FIELDS = [
  { key: 'word',               label: 'Word',                  base: 'baseWord' },
  { key: 'pronunciation',      label: 'Pronunciation',         base: 'basePronunciation' },
  { key: 'definition',         label: 'Definition',            base: 'baseDefinition',    tall: true },
  { key: 'allowableSpellings', label: 'Allowable Spellings',   base: 'baseAllowableSpellings' },
  { key: 'partOfSpeech',       label: 'Part of Speech',        base: 'basePartOfSpeech' },
  { key: 'origin',             label: 'Origin',                base: 'baseOrigin',        tall: true },
  { key: 'sentence',           label: 'Sentence',              base: 'baseSentence',      tall: true },
  { key: 'audioLink',          label: 'Audio Link',            base: 'baseAudioLink' },
  { key: 'bundle',             label: 'Bundle',                base: 'baseBundle' },
];

// Builds the initial form state from the merged word object.
function initForm(word) {
  const state = {};
  FIELDS.forEach(f => { state[f.key] = word[f.key] || ''; });
  return state;
}

export default function WordEditModal({ word, listId, onClose, onSaved }) {
  const [form,    setForm]    = useState(() => initForm(word));
  const [saving,  setSaving]  = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error,   setError]   = useState('');

  function setField(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (!form.word.trim()) return setError('Word cannot be empty.');

    // Skip the DB write if every field matches the current effective value
    // (which is already the override value if one exists, or the base value).
    // This avoids creating spurious word_overrides rows when nothing changed.
    const anyChanged = FIELDS.some(f => (form[f.key] || '') !== (word[f.key] || ''));
    if (!anyChanged) { onClose(); return; }

    setSaving(true); setError('');
    try {
      await DB.wordLists.upsertOverride(word.wordId, listId, {
        word:               form.word.trim()               || null,
        pronunciation:      form.pronunciation.trim()      || null,
        definition:         form.definition.trim()         || null,
        allowableSpellings: form.allowableSpellings.trim() || null,
        partOfSpeech:       form.partOfSpeech.trim()       || null,
        origin:             form.origin.trim()             || null,
        sentence:           form.sentence.trim()           || null,
        audioLink:          form.audioLink.trim()          || null,
        bundle:             form.bundle.trim()             || null,
      });
      onSaved({ ...word, ...form, hasOverride: true });
    } catch (e) {
      setError(e.message || 'Could not save.');
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!word.hasOverride) return;
    setResetting(true); setError('');
    try {
      await DB.wordLists.deleteOverride(word.wordId, listId);
      // Restore the form to base (master) values
      const baseForm = {};
      FIELDS.forEach(f => { baseForm[f.key] = word[f.base] || ''; });
      setForm(baseForm);
      onSaved({ ...word, ...baseForm, hasOverride: false });
    } catch (e) {
      setError(e.message || 'Could not reset.');
      setResetting(false);
    }
  }

  const busy = saving || resetting;

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-title">
          ✏️ Edit Word
          {word.hasOverride && (
            <span style={{ fontSize: '0.75rem', fontWeight: 400,
              color: 'var(--warning)', marginLeft: 10 }}>
              ⚠ has overrides
            </span>
          )}
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.88rem',
            marginBottom: 12, textAlign: 'center' }}>{error}</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12,
          maxHeight: '60vh', overflowY: 'auto', paddingRight: 4, marginBottom: 16 }}>
          {FIELDS.map(({ key, label, base, tall }) => (
            <div key={key}>
              <label className="field-label" style={{ marginBottom: 4 }}>
                {label}
                {word.hasOverride && word[base] && word[base] !== form[key] && (
                  <span style={{ fontWeight: 400, fontSize: '0.78rem',
                    color: 'var(--text-muted)', marginLeft: 8 }}>
                    original: {word[base]}
                  </span>
                )}
              </label>
              {tall ? (
                <textarea className="input" value={form[key]}
                  onChange={e => setField(key, e.target.value)}
                  rows={2} style={{ resize: 'vertical', fontSize: '0.9rem' }} />
              ) : (
                <input className="input" value={form[key]}
                  onChange={e => setField(key, e.target.value)} />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-full" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {word.hasOverride && (
            <button className="btn btn-full"
              style={{ border: '2px solid var(--warning)', color: 'var(--warning)',
                background: 'transparent' }}
              onClick={handleReset} disabled={busy}>
              {resetting ? '…' : '↩ Reset to Original'}
            </button>
          )}
          <button className="btn btn-primary btn-full" onClick={handleSave} disabled={busy}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
