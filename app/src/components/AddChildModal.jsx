import { useState } from 'react';
import { DB } from '../lib/db.js';
import { AVATARS } from '../lib/constants.js';
import { useApp } from '../context/AppContext.jsx';

export default function AddChildModal({ onClose }) {
  const { profile } = useApp();
  const [name,     setName]     = useState('');
  const [avatar,   setAvatar]   = useState(AVATARS[0]);
  const [email,    setEmail]    = useState('');
  const [useEmail, setUseEmail] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');

  async function handleSave() {
    if (!name.trim()) return setErr('Please enter a name.');
    if (useEmail && !email.trim()) return setErr('Please enter an email address.');
    if (useEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setErr('Please enter a valid email address.');
    }
    setSaving(true); setErr('');
    try {
      const child = await DB.users.create({
        parent_id:   profile.id,
        name:        name.trim(),
        avatar,
        role:        'kid',
        access_type: useEmail ? 'email' : 'local',
        email:       useEmail ? email.trim().toLowerCase() : null,
        last_mode:   'spelling',
        theme:       'space',
      });
      // Return the new child to Home — Home owns the list update, not this modal
      onClose(child);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Add Child</div>

        {err && <p style={{ color:'var(--danger)', marginBottom:12 }}>{err}</p>}

        <label className="field-label">Name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !useEmail && handleSave()}
          maxLength={32} autoFocus />

        <label className="field-label" style={{ marginTop:16 }}>Avatar</label>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:20 }}>
          {AVATARS.map(a => (
            <button key={a} onClick={() => setAvatar(a)} style={{
              fontSize:'1.6rem',
              background: avatar === a ? 'var(--bg)' : 'none',
              border: avatar === a ? '2px solid var(--primary)' : '2px solid transparent',
              borderRadius:8, cursor:'pointer', padding:4,
            }}>{a}</button>
          ))}
        </div>

        <label className="field-label" style={{ marginBottom:8 }}>Account type</label>
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          <button className={`btn btn-sm ${!useEmail ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setUseEmail(false)} style={{ flex:1 }}>
            🏠 Local only
          </button>
          <button className={`btn btn-sm ${useEmail ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setUseEmail(true)} style={{ flex:1 }}>
            ✉️ Invite by email
          </button>
        </div>

        {useEmail ? (
          <div style={{ marginBottom:16 }}>
            <label className="field-label">Child's email address</label>
            <input className="input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="child@example.com" />
            <p style={{ fontSize:'0.82rem', color:'var(--text-muted)', marginTop:6 }}>
              When your child signs in to <strong>spellingbeetest.online</strong> with
              this Google account for the first time, their profile will link
              automatically. No invitation email is sent.
            </p>
          </div>
        ) : (
          <p style={{ fontSize:'0.82rem', color:'var(--text-muted)', marginBottom:16 }}>
            A local profile is managed by you. Your child can practice on any
            device you are signed into but cannot sign in independently.
          </p>
        )}

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
