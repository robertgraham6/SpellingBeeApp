import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';

// Supabase redirects the browser back to /login after Google OAuth completes.
// The Supabase client library picks up the access token from the URL hash
// automatically and fires an onAuthStateChange event, which AppContext handles
// by calling resolveProfile and setting the session.
//
// This page's only job is to:
//   1. Show a loading spinner while that handshake completes.
//   2. Redirect to /home once the session is established.
//   3. Show an error if something went wrong.

export default function Login() {
  const { session, loading, error } = useApp();
  const navigate = useNavigate();
  const [timedOut, setTimedOut] = useState(false);

  // Redirect once the session is confirmed
  useEffect(() => {
    if (session) navigate('/home', { replace: true });
  }, [session, navigate]);

  // Safety timeout — if nothing happens in 15 seconds, show a helpful message
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 15_000);
    return () => clearTimeout(t);
  }, []);

  const showError = error || timedOut;

  return (
    <div className="loading-screen">
      {showError ? (
        <div className="card" style={{ maxWidth: 440, textAlign: 'center', padding: '36px 28px' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>⚠️</div>
          <h2 style={{ marginBottom: 12 }}>Sign-in problem</h2>
          <p style={{ marginBottom: 24 }}>
            {error
              ? error
              : 'Sign-in is taking longer than expected. This can happen if the ' +
                'browser blocked the redirect. Please try again.'}
          </p>
          <button
            className="btn btn-primary btn-full"
            onClick={() => navigate('/spellingbeetest', { replace: true })}
          >
            Back to home page
          </button>
        </div>
      ) : (
        <>
          <div className="spinner" />
          <p>{loading ? 'Setting up your account…' : 'Signing you in…'}</p>
        </>
      )}
    </div>
  );
}
