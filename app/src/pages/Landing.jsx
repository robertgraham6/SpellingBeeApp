import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DB } from '../lib/db.js';
import { useApp } from '../context/AppContext.jsx';

// 'signin' | 'signup'
export default function Landing() {
  // Watch AppContext's error/loading so we can reset local loading state
  // if resolveProfile fails after a successful sign-in call.
  const { session, error: ctxError, loading: ctxLoading } = useApp();

  const navigate = useNavigate();

  const [tab,      setTab]      = useState('signin');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [info,     setInfo]     = useState('');

  // Navigate to /home the moment AppContext has a valid session.
  // Landing has no AuthGuard so without this the user stays stuck
  // on /spellingbeetest after a successful sign-in.
  useEffect(() => {
    if (session) navigate('/home', { replace: true });
  }, [session, navigate]);

  // If AppContext reports an error after we triggered sign-in,
  // surface it in Landing and re-enable the button so the user can retry.
  useEffect(() => {
    if (ctxError) {
      setError(ctxError);
      setLoading(false);
    }
  }, [ctxError]);

  // Safety net: if AppContext finishes loading without navigating away
  // (no error was set either), re-enable the button after a short delay.
  useEffect(() => {
    if (!ctxLoading && loading) {
      const t = setTimeout(() => setLoading(false), 3000);
      return () => clearTimeout(t);
    }
  }, [ctxLoading, loading]);

  function switchTab(t) { setTab(t); setError(''); setInfo(''); }

  async function handleEmailSubmit() {
    setError(''); setInfo('');
    if (!email.trim()) return setError('Please enter your email address.');
    if (!password)     return setError('Please enter a password.');
    if (tab === 'signup') {
      if (password.length < 6) return setError('Password must be at least 6 characters.');
      if (password !== confirm) return setError('Passwords do not match.');
    }
    setLoading(true);
    try {
      if (tab === 'signup') {
        const { session } = await DB.auth.signUpWithEmail(email, password);
        // When email confirmation is disabled, signUp returns a session
        // immediately and fires onAuthStateChange — do NOT also call
        // signInWithEmail or resolveProfile will run twice and race.
        // When confirmation IS enabled, session is null and the user
        // must confirm their email before they can sign in.
        if (!session) {
          setInfo('Check your email to confirm your account, then sign in.');
          setLoading(false);
          return;
        }
        setInfo('Account created! Signing you in…');
        // session exists — onAuthStateChange already fired, AppContext
        // will navigate to /home. Nothing else to do here.
      } else {
        await DB.auth.signInWithEmail(email, password);
      }
    } catch (e) {
      setError(e.message || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(''); setLoading(true);
    try {
      await DB.auth.signInWithGoogle();
    } catch (e) {
      setError(e.message || 'Could not start Google sign-in.');
      setLoading(false);
    }
  }

  const inputStyle = { marginBottom: 10 };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 24,
    }}>

      <div className="card" style={{ maxWidth: 420, width: '100%', padding: '36px 32px' }}>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: '3rem', marginBottom: 8 }}>🐝</div>
          <h1 style={{ marginBottom: 4 }}>Spelling Bee Trainer</h1>
          <p style={{ fontSize: '0.88rem' }}>
            Practice spelling bee words with audio and flashcards.
          </p>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button
            className={`btn btn-sm ${tab === 'signin' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => switchTab('signin')} style={{ flex: 1 }}>
            Sign in
          </button>
          <button
            className={`btn btn-sm ${tab === 'signup' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => switchTab('signup')} style={{ flex: 1 }}>
            Create account
          </button>
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.85rem',
            fontWeight: 600, marginBottom: 12 }}>{error}</p>
        )}
        {info && (
          <p style={{ color: 'var(--secondary)', fontSize: '0.85rem',
            fontWeight: 600, marginBottom: 12 }}>{info}</p>
        )}

        {/* Email / password form */}
        <input className="input" type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleEmailSubmit()}
          placeholder="Email" disabled={loading}
          style={inputStyle} />

        <input className="input" type="password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && tab === 'signin' && handleEmailSubmit()}
          placeholder="Password" disabled={loading}
          style={inputStyle} />

        {tab === 'signup' && (
          <>
              <input className="input" type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEmailSubmit()}
              placeholder="Confirm password" disabled={loading}
              style={inputStyle} />
          </>
        )}

        <button className="btn btn-primary btn-full" onClick={handleEmailSubmit}
          disabled={loading} style={{ marginTop: 6, marginBottom: 16 }}>
          {loading ? '…' : tab === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>or</span>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
        </div>

        {/* Google */}
        <button className="btn btn-ghost btn-full" onClick={handleGoogle} disabled={loading}>
          <GoogleIcon /> Continue with Google
        </button>

      </div>

      {/* Feature grid */}
      <div style={{
        maxWidth: 420, width: '100%', marginTop: 16,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
      }}>
        {[
          { emoji: '🐝', label: 'Spelling Bee',     desc: 'Type words from audio' },
          { emoji: '🃏', label: 'Flashcards',        desc: 'Definition → reveal' },
          { emoji: '📊', label: 'Progress tracking', desc: 'See what needs work' },
          { emoji: '👨‍👩‍👧', label: 'Family accounts', desc: 'Multiple children' },
        ].map(f => (
          <div key={f.label} className="card" style={{ padding: '12px', textAlign: 'left' }}>
            <div style={{ fontSize: '1.2rem', marginBottom: 3 }}>{f.emoji}</div>
            <p style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 1 }}>{f.label}</p>
            <p style={{ fontSize: '0.75rem', margin: 0 }}>{f.desc}</p>
          </div>
        ))}
      </div>

    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
