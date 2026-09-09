import { useState } from 'react';
import { DB } from '../lib/db.js';
import { AVATARS } from '../lib/constants.js';

export default function EditChildModal({ child, onClose }) {
  const [name,   setName]   = useState(child.name);
  const [avatar, setAvatar] = useState(child.avatar);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  async function handleSave() {
    if (!name.trim()) return setErr('Please enter a name.');
    setSaving(true);
    setErr('');
    try {
      const updated = await DB.users.update(child.id, { name: name.trim(), avatar });
      onClose(updated);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Edit Child</div>
        {err && <p style={{ color: 'var(--danger)', marginBottom: 12 }}>{err}</p>}
        <label className="field-label">Name</label>
        <input
          className="input"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={32}
        />
        <label className="field-label" style={{ marginTop: 16 }}>Avatar</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {AVATARS.map(a => (
            <button
              key={a}
              onClick={() => setAvatar(a)}
              style={{
                fontSize: '1.6rem',
                background: avatar === a ? 'var(--bg)' : 'none',
                border: avatar === a ? '2px solid var(--primary)' : '2px solid transparent',
                borderRadius: 8,
                cursor: 'pointer',
                padding: 4,
              }}
            >{a}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-full" onClick={() => onClose(null)}>Cancel</button>
          <button className="btn btn-primary btn-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
