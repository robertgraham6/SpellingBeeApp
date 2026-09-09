import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { DB, wlCacheGet, wlCacheInvalidate, childListCacheInvalidate, histCacheGet, histCacheSet, ratsCacheGet, ratsCacheSet } from '../lib/db.js';
import { useToast } from '../components/Toast.jsx';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const showToast = useToast();

  const [session,        setSession]        = useState(undefined);
  const [profile,        setProfile]        = useState(null);
  const [childList,      setChildList]      = useState([]);
  const [activeChild,    setActiveChild]    = useState(null);
  const [wordList,       setWordList]       = useState([]);
  const [history,        setHistory]        = useState({});
  const [initialHistory, setInitialHistory] = useState({});
  const [ratings,        setRatings]        = useState({});
  const [loading,        setLoading]        = useState(false);
  const [childLoading,   setChildLoading]   = useState(false);
  const [error,          setError]          = useState(null);
  const [histCounts,       setHistCounts]       = useState({});
  const [childWordCounts,  setChildWordCounts]  = useState({});

  const activeChildRef    = useRef(null);
  const settingsTimerRef  = useRef(null);
  const histCacheTimerRef = useRef(null);
  const ratsCacheTimerRef = useRef(null);
  const ratingTimerRef    = useRef({});

  // ── Auth ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // TOKEN_REFRESHED fires whenever the tab regains focus — skip resolveProfile
      // for these events to avoid the 'Loading…' flash during normal app use.
      // We still update the session object so requests use the fresh token.
      if (event === 'TOKEN_REFRESHED') {
        setSession(prev => prev ? { ...prev, access_token: s?.access_token,
          refresh_token: s?.refresh_token } : s);
        return;
      }
      if (s) s._event = event;
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setProfile(null); setChildList([]); setActiveChild(null);
      setWordList([]); setHistory({}); setInitialHistory({}); setRatings({});
      setHistCounts({});
      setChildWordCounts({});
      activeChildRef.current = null;
      return;
    }
    // Skip resolveProfile if we already have a profile for this auth user.
    // This prevents the Loading flash when TOKEN_REFRESHED updates session state.
    if (profile && profile.auth_id === session.user.id) return;
    resolveProfile(session);
  }, [session, profile]);

  async function resolveProfile(session) {
    setLoading(true); setError(null);
    try {
      // On a fresh sign-up the JWT may not have fully propagated to the
      // Supabase auth server yet. A short delay ensures auth.uid() resolves
      // correctly inside the register_user SECURITY DEFINER function.
      if (session._event === 'SIGNED_IN' || session._event === 'SIGNED_UP') {
        await new Promise(r => setTimeout(r, 800));
      }
      const authId = session.user.id;
      const email  = (session.user.email || '').trim();
      let p = await DB.users.getByAuthId(authId);

      if (!p) {
        const existing = await DB.users.getByEmail(email);
        if (existing && existing.auth_id === null) {
          p = await DB.users.linkAuthId(email, authId);
        } else if (!existing) {
          p = await DB.users.register({
            auth_id: authId,
            name: (session.user.user_metadata?.full_name || email.split('@')[0]).trim(),
            avatar: '\u{1F46A}', role: 'parent', access_type: 'email',
            email, last_mode: 'spelling', theme: 'space'
          });
        } else if (existing.auth_id !== null && existing.auth_id !== authId) {
          throw new Error(
            'This email address is already linked to a different account. ' +
            'Please sign in with the original Google account or contact support.'
          );
        } else { p = existing; }
      }

      // Auto-promote on every sign-in: if this email matches app_config.admin_email
      // and the role isn't already 'admin', elevate it now. This means the admin
      // never needs a manual DB UPDATE — the first sign-in after seeding app_config
      // promotes them automatically.
      if (p.role !== 'admin') {
        const promoted = await DB.users.promoteToAdminIfNeeded(p.id, email);
        if (promoted) p = promoted;
      }

      if (p.role === 'admin') {
        // Admin has no children and no active word list — they manage the shared library.
        setProfile(p);
      } else if (p.role === 'parent') {
        setProfile(p);
        const kids = await DB.users.getChildren(p.id);
        setChildList(kids);
        // Don't auto-select a child — parent starts on their own home screen
        if (kids.length > 0) {
          DB.wordLists.getChildrenHistoryCounts(kids.map(k => k.id))
            .then(setHistCounts).catch(() => {});
          DB.wordLists.getChildrenWordCounts(kids.map(k => k.id))
            .then(setChildWordCounts).catch(() => {});
        }
      } else {
        setProfile(p);
        await _loadChild(p);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // useCallback gives _loadChild a stable, trackable identity so selectChild
  // can declare it as a dependency and always call the current version.
  // The dep array is safely [] because everything _loadChild closes over is
  // either a ref (activeChildRef) or a React state setter — both guaranteed
  // stable across renders by React.
  const _loadChild = useCallback(async (child) => {
    activeChildRef.current = child.id;
    setActiveChild(child);

    const cachedWl   = wlCacheGet(child.id);
    const cachedHist = histCacheGet(child.id);
    const cachedRats = ratsCacheGet(child.id);

    if (cachedHist) { setHistory(cachedHist); setInitialHistory(cachedHist); }
    if (cachedRats) setRatings(cachedRats);
    if (cachedWl)   setWordList(cachedWl.words);

    if (cachedWl && cachedHist && cachedRats) return;

    // Note: DB.wordLists.loadForUser handles wlCacheSet internally
    const [wl, hist, rats] = await Promise.all([
      cachedWl   ? Promise.resolve(cachedWl.words) : DB.wordLists.loadForUser(child.id).catch(() => []),
      cachedHist ? Promise.resolve(cachedHist)     : DB.history.load(child.id).catch(() => ({})),
      cachedRats ? Promise.resolve(cachedRats)     : DB.ratings.load(child.id).catch(() => ({}))
    ]);

    if (activeChildRef.current !== child.id) return;

    setWordList(wl);
    setHistory(hist);
    setInitialHistory(hist);
    setRatings(rats);
    histCacheSet(child.id, hist);
    ratsCacheSet(child.id, rats);
  }, []);

  const selectChild = useCallback(async (child) => {
    setActiveChild(child);
    setChildLoading(true);
    try { await _loadChild(child); }
    finally { setChildLoading(false); }
  }, [_loadChild]);

  // ── Debounced cache sync ──────────────────────────────────────
  useEffect(() => {
    const id = activeChildRef.current;
    if (!id) return;
    if (histCacheTimerRef.current) clearTimeout(histCacheTimerRef.current);
    histCacheTimerRef.current = setTimeout(() => {
      histCacheSet(id, history);
      histCacheTimerRef.current = null;
    }, 500);
  }, [history]);

  useEffect(() => {
    const id = activeChildRef.current;
    if (!id) return;
    if (ratsCacheTimerRef.current) clearTimeout(ratsCacheTimerRef.current);
    ratsCacheTimerRef.current = setTimeout(() => {
      ratsCacheSet(id, ratings);
      ratsCacheTimerRef.current = null;
    }, 500);
  }, [ratings]);

  function _updateHistCount(childId, _prev, newWordId, newStatus, oldStatus) {
    setHistCounts(prev => {
      const cur = prev[childId] || { correct: 0, incorrect: 0 };
      let { correct, incorrect } = cur;
      if (oldStatus === 'correct')   correct--;
      if (oldStatus === 'incorrect') incorrect--;
      if (newStatus === 'correct')   correct++;
      if (newStatus === 'incorrect') incorrect++;
      return { ...prev, [childId]: { correct: Math.max(0, correct), incorrect: Math.max(0, incorrect) } };
    });
  }

  const recordHistory = useCallback(async (wordId, status) => {
    const childId = activeChildRef.current;
    let oldStatus;
    setHistory(prev => {
      oldStatus = prev[wordId];
      if (status === null) { const n = { ...prev }; delete n[wordId]; return n; }
      return { ...prev, [wordId]: status };
    });
    if (!childId || status === undefined) return;
    _updateHistCount(childId, null, wordId, status, oldStatus);
    try {
      if (status === null) await DB.history.remove(childId, wordId);
      else                 await DB.history.upsert(childId, wordId, status);
    } catch (e) {
      console.warn('history sync:', e.message);
      showToast?.('Progress may not have saved — check your connection.', 'warning');
    }
  }, [showToast]);

  // Like recordHistory but skips the DB write entirely.
  // Used by Practice during a session: in-memory state stays responsive while
  // all writes are accumulated in pendingWritesRef and flushed once as a batch
  // at session end via flushHistoryBatch. Calling recordHistory on every word
  // AND flushing a batch would double-write every entry to the DB.
  const recordHistoryLocal = useCallback((wordId, status) => {
    const childId = activeChildRef.current;
    let oldStatus;
    setHistory(prev => {
      oldStatus = prev[wordId];
      if (status === null) { const n = { ...prev }; delete n[wordId]; return n; }
      return { ...prev, [wordId]: status };
    });
    if (!childId || status === undefined) return;
    _updateHistCount(childId, null, wordId, status, oldStatus);
  }, []);

  const recordRating = useCallback((wordId, rating) => {
    setRatings(prev => {
      if (rating === 0) { const n = { ...prev }; delete n[wordId]; return n; }
      return { ...prev, [wordId]: rating };
    });
    const childId = activeChildRef.current;
    if (!childId) return;
    if (ratingTimerRef.current[wordId]) clearTimeout(ratingTimerRef.current[wordId]);
    ratingTimerRef.current[wordId] = setTimeout(async () => {
      try {
        if (rating === 0) await DB.ratings.remove(childId, wordId);
        else              await DB.ratings.upsert(childId, wordId, rating);
      } catch (e) {
        console.warn('ratings sync:', e.message);
        showToast?.('Rating may not have saved — check your connection.', 'warning');
      }
      delete ratingTimerRef.current[wordId];
    }, 2000);
  }, [showToast]);

  const flushHistoryBatch = useCallback(async (writes) => {
    const childId = activeChildRef.current;
    if (!childId || !writes.length) return;
    try {
      await DB.history.batchFlush(childId, writes);
    } catch (e) {
      console.warn('Batch flush failed:', e.message);
      showToast?.('Some progress may not have saved — check your connection.', 'warning');
    }
  }, [showToast]);

  const saveSettings = useCallback((userId, lastMode, theme) => {
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = setTimeout(async () => {
      try { await DB.users.update(userId, { last_mode: lastMode, theme }); }
      catch (e) { console.warn('Settings save failed:', e.message); }
      settingsTimerRef.current = null;
    }, 2000);
  }, []);

  const addChildToList      = useCallback((child) => setChildList(prev => [...prev, child]), []);
  const removeChildFromList = useCallback((childId) => {
    setChildList(prev => prev.filter(c => c.id !== childId));
    setHistCounts(prev => { const n = { ...prev }; delete n[childId]; return n; });
    setChildWordCounts(prev => { const n = { ...prev }; delete n[childId]; return n; });
  }, []);
  const updateChildInList   = useCallback((updated) => {
    setChildList(prev => prev.map(c => c.id === updated.id ? updated : c));
    if (activeChildRef.current === updated.id) setActiveChild(updated);
  }, []);
  const refreshChildren = useCallback(async () => {
    if (!profile) return;
    try { setChildList(await DB.users.getChildren(profile.id)); }
    catch (e) { console.warn('refreshChildren failed:', e.message); }
  }, [profile]);

  const resetChildProgress = useCallback(async (childId) => {
    await DB.history.reset(childId);
    await DB.ratings.reset(childId);
    setHistCounts(prev => ({ ...prev, [childId]: { correct: 0, incorrect: 0 } }));
    if (childId === activeChildRef.current) {
      setHistory({}); setInitialHistory({}); setRatings({});
    }
  }, []);

  // Assigns a list to a child and reloads their word list if currently active.
  const assignChildList = useCallback(async (childId, listId) => {
    await DB.wordLists.assignToChild(childId, listId);
    // Update the word count shown on the child card
    DB.wordLists.getChildrenWordCounts([childId])
      .then(counts => setChildWordCounts(prev => ({ ...prev, ...counts })))
      .catch(() => {});
    // If this child is the active one, reload their word list from DB
    if (childId === activeChildRef.current) {
      const wl = await DB.wordLists.loadForUser(childId).catch(() => []);
      if (activeChildRef.current === childId) setWordList(wl);
    }
  }, []);

  // Called after override writes to refresh the in-context wordList if the
  // active child is currently assigned to the affected list.
  const refreshWordListIfOnList = useCallback(async (listId) => {
    const childId = activeChildRef.current;
    if (!childId) return;
    // Check the child's current assignment before hitting the DB.
    // wlCacheGet returns { wordListId, words } when the cache is warm,
    // or null when it was just invalidated. In both cases we can compare:
    // - Cache warm: check wordListId directly (zero extra queries).
    // - Cache cold (just invalidated): the child IS on this list (that's
    //   why the cache was invalidated), so always re-fetch.
    const cached = wlCacheGet(childId);
    if (cached && cached.wordListId !== listId) return;
    const wl = await DB.wordLists.loadForUser(childId).catch(() => null);
    if (wl && activeChildRef.current === childId) setWordList(wl);
  }, []);

  // Deselect the active child and return to the parent's view.
  const switchToParent = useCallback(() => {
    setActiveChild(null);
    setWordList([]);
    setHistory({});
    setInitialHistory({});
    setRatings({});
  }, []);

  const signOut = useCallback(async () => { await DB.auth.signOut(); }, []);

  // Called by WordLists after a successful child-scope import.
  // Updates in-memory word list if the child is active and clears their cache.
  // Admin-scope imports don't call this (they don't affect any child's active list).
  const applyImportedWordList = useCallback((words, childId) => {
    if (!childId) return;
    setChildWordCounts(prev => ({ ...prev, [childId]: words.length }));
    childListCacheInvalidate(childId);
    const activeId = activeChildRef.current;
    if (activeId === childId) {
      setWordList(words);
      wlCacheInvalidate(childId);
    }
    // If the imported words contain progress columns (status/rating),
    // write them to the DB keyed by normalizedWord + normalizedPron.
    const progressEntries = words.filter(w => w.importStatus || w.importRating);
    if (progressEntries.length > 0) {
      // Map normalizedWord_normalizedPron → wordId from the loaded word list
      const keyMap = {};
      words.forEach(w => {
        const key = w.normalizedPronunciation
          ? `${w.normalizedWord}_${w.normalizedPronunciation}`
          : w.normalizedWord;
        keyMap[key] = w.wordId;
      });
      const entries = progressEntries.map(w => {
        const key = (w.normalizedPron || w.normalizedWord)
          ? (w.normalizedPron
              ? `${w.normalizedWord || w.word}_${w.normalizedPron}`
              : w.normalizedWord || w.word)
          : w.word;
        const wordId = keyMap[key] || w.wordId;
        return { wordId, status: w.importStatus, rating: w.importRating };
      }).filter(e => e.wordId);
      if (entries.length) {
        DB.history.bulkImportProgress(childId, entries).catch(e =>
          console.warn('Progress import failed:', e.message)
        );
      }
    }
  }, []);

  return (
    <AppContext.Provider value={{
      session, profile, childList, activeChild, wordList,
      history, initialHistory, ratings, loading, childLoading,
      error, histCounts, childWordCounts, selectChild, recordHistory, recordHistoryLocal, recordRating,
      flushHistoryBatch, saveSettings, addChildToList, removeChildFromList,
      updateChildInList, refreshChildren, resetChildProgress, assignChildList,
      switchToParent, refreshWordListIfOnList, signOut,
      applyImportedWordList,
    }}>
      {children}
    </AppContext.Provider>
  );
}
