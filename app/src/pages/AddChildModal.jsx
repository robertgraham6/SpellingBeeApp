import { useState } from 'react';
import { DB } from '../lib/db.js';
import { AVATARS } from '../lib/constants.js';
import { useApp } from '../context/AppContext.jsx';

export default function AddChildModal({ onClose }) {
  const { profile } = useApp();
  const [name,   setName]   = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  async function handleSave() {
    if (!name.trim()) return setErr('Please enter a name.');
    setSaving(true); setErr('');
    try {
      const child = await DB.users.create({
        parent_id:   profile.id,
        name:        name.trim(),
        avatar,
        role:        'kid',
        access_type: 'local',
        last_mode:   'spelling',
        theme:       'space',
      });
      onClose(child);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-title">Add Child</div>

        {err && <p style={{ color:'var(--danger)', fontSize:'0.85rem', marginBottom:10 }}>{err}</p>}

        <div style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom:16 }}>
          <div style={{ flex:1 }}>
            <label className="field-label">Name</label>
            <input className="input" value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              maxLength={32} autoFocus />
          </div>
          <div>
            <label className="field-label">Avatar</label>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', maxWidth:120 }}>
              {AVATARS.map(a => (
                <button key={a} onClick={() => setAvatar(a)} style={{
                  fontSize:'1.3rem',
                  background: avatar === a ? 'var(--bg)' : 'none',
                  border: avatar === a ? '2px solid var(--primary)' : '2px solid transparent',
                  borderRadius:6, cursor:'pointer', padding:2,
                }}>{a}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-full" onClick={() => onClose(null)}>Cancel</button>
          <button className="btn btn-primary btn-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Add Child'}
          </button>
        </div>
      </div>
    </div>
  );
}
