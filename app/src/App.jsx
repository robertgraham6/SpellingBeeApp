import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import AuthGuard from './components/AuthGuard.jsx';

// Lazy-load each page so only the code needed for the current
// route is downloaded — reduces initial bundle by ~60%
const Landing   = lazy(() => import('./pages/Landing.jsx'));
const Login     = lazy(() => import('./pages/Login.jsx'));
const Home      = lazy(() => import('./pages/Home.jsx'));
const WordLists = lazy(() => import('./pages/WordLists.jsx'));
const Review    = lazy(() => import('./pages/Review.jsx'));
const Practice       = lazy(() => import('./pages/Practice.jsx'));
const ImportProgress = lazy(() => import('./pages/ImportProgress.jsx'));

function PageSpinner() {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <p>Loading…</p>
    </div>
  );
}

// Sends authenticated users to /home and unauthenticated users to the
// landing page. Used as the wildcard catch-all so stale links and typos
// don't always drop logged-in users back on the public landing page.
function DefaultRedirect() {
  const { session, loading } = useApp();
  if (session === undefined || loading) return <PageSpinner />;
  return <Navigate to={session ? '/home' : '/spellingbeetest'} replace />;
}

export default function App() {
  return (
    <ToastProvider>
    <AppProvider>
      <BrowserRouter>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            {/* Public */}
            <Route path="/spellingbeetest" element={<Landing />} />
            <Route path="/login"           element={<Login />} />

            {/* Protected */}
            <Route path="/home"       element={<AuthGuard><Home /></AuthGuard>} />
            <Route path="/word-lists" element={<AuthGuard><WordLists /></AuthGuard>} />
            <Route path="/review"     element={<AuthGuard><Review /></AuthGuard>} />
            <Route path="/practice"        element={<AuthGuard><Practice /></AuthGuard>} />
            <Route path="/import-progress" element={<AuthGuard><ImportProgress /></AuthGuard>} />

            {/* Default */}
            <Route path="/" element={<DefaultRedirect />} />
            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppProvider>
    </ToastProvider>
  );
}
