import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';

const NAV_ITEMS = [
  { path: '/home',       label: 'Home',      emoji: '🏠' },
  { path: '/word-lists', label: 'Word Lists', emoji: '📚' },
  { path: '/review',     label: 'Review',     emoji: '🔍' },
  { path: '/practice',   label: 'Practice',   emoji: '🐝' },
];

function AccountSwitcher({ profile, activeChild, childList, onSelectChild, onSwitchToParent, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const current = activeChild || profile;
  if (!current) return null;

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'none', border: '1px solid var(--border)',
        borderRadius: 50, padding: '4px 10px 4px 6px',
        cursor: 'pointer', fontFamily: 'var(--font)',
        transition: 'border-color 0.15s',
      }}>
        <span style={{ fontSize: '1.3rem' }}>{current.avatar}</span>
        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)',
          maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current.name}
        </span>
        {activeChild && profile && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            ({profile.name})
          </span>
        )}
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 2 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          minWidth: 200, zIndex: 200, overflow: 'hidden',
        }}>
          {/* Parent account */}
          {profile && (
            <button onClick={() => { onSwitchToParent(); setOpen(false); }} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '10px 14px', background: !activeChild ? 'var(--bg)' : 'none',
              border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: '1.3rem' }}>{profile.avatar}</span>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: 0, color: 'var(--text)' }}>
                  {profile.name}
                </p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>Parent</p>
              </div>
              {!activeChild && <span style={{ marginLeft: 'auto', color: 'var(--primary)', fontSize: '0.8rem' }}>✓</span>}
            </button>
          )}

          {/* Child accounts */}
          {childList.map(child => (
            <button key={child.id} onClick={() => { onSelectChild(child); setOpen(false); }} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '10px 14px', background: activeChild?.id === child.id ? 'var(--bg)' : 'none',
              border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: '1.3rem' }}>{child.avatar}</span>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: 0, color: 'var(--text)' }}>
                  {child.name}
                </p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>Child</p>
              </div>
              {activeChild?.id === child.id && <span style={{ marginLeft: 'auto', color: 'var(--primary)', fontSize: '0.8rem' }}>✓</span>}
            </button>
          ))}

          {/* Sign out */}
          <button onClick={() => { onSignOut(); setOpen(false); }} style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '10px 14px', background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font)',
            color: 'var(--text-muted)', fontSize: '0.85rem',
          }}>
            <span>↩</span> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { profile, activeChild, childList, switchToParent, selectChild, signOut } = useApp();
  const navigate  = useNavigate();
  const location  = useLocation();

  async function handleSignOut() {
    try { await signOut(); }
    catch { /* auth state listener clears session regardless */ }
    navigate('/spellingbeetest', { replace: true });
  }

  async function handleSelectChild(child) {
    await selectChild(child);
    navigate('/home');
  }

  function handleSwitchToParent() {
    switchToParent();
    navigate('/home');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      <nav style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        boxShadow: '0 2px 8px rgba(108,92,231,0.08)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{
          maxWidth: 960, margin: '0 auto', padding: '0 16px',
          display: 'flex', alignItems: 'center', gap: 4, height: 56,
        }}>
          <button onClick={() => navigate('/home')} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font)', fontWeight: 700, fontSize: '1.1rem',
            color: 'var(--primary)', marginRight: 8, padding: '4px 8px',
            borderRadius: 8, flexShrink: 0,
          }}>
            🐝 Spelling Bee
          </button>

          <div style={{ display: 'flex', gap: 2, flex: 1 }}>
            {NAV_ITEMS.map(item => {
              const active = location.pathname === item.path;
              return (
                <button key={item.path} onClick={() => navigate(item.path)} style={{
                  background: active ? 'var(--bg)' : 'none',
                  border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font)', fontWeight: active ? 700 : 600,
                  fontSize: '0.85rem',
                  color: active ? 'var(--primary)' : 'var(--text-muted)',
                  padding: '6px 10px', borderRadius: 8,
                  transition: 'color 0.15s, background 0.15s',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: '1rem' }}>{item.emoji}</span>
                  <span className="nav-label">{item.label}</span>
                </button>
              );
            })}
          </div>

          <AccountSwitcher
            profile={profile}
            activeChild={activeChild}
            childList={childList || []}
            onSelectChild={handleSelectChild}
            onSwitchToParent={handleSwitchToParent}
            onSignOut={handleSignOut}
          />
        </div>
      </nav>

      <main style={{ flex: 1 }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 16px' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
