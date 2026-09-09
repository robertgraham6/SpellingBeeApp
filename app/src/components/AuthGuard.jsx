import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';

export default function AuthGuard({ children }) {
  const { session, loading, error } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    if (session === undefined || loading) return;
    if (!session) navigate('/login', { replace: true });
  }, [session, loading, navigate]);

  if (error) {
    return (
      <div className="loading-screen">
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    );
  }

  if (session === undefined || loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  return children;
}
