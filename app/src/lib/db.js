import { supabase, isSupabaseConfigured } from './supabase.js';
import { normalizeWord, normalizePronunciation } from './normalize.js';

// ── Per-user word-list caches (localStorage, survive page refresh) ────────────
// Bump this version string whenever the cache format or data shape changes.
// All existing caches with a different version will be silently dropped,
// forcing a fresh fetch from Supabase.
const WL_CACHE_VERSION = 'v2';

export function wlCacheGet(userId) {
  try {
    const raw = localStorage.getItem(`sb_wl_${userId}`);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p?.v !== WL_CACHE_VERSION) return null; // stale — force re-fetch
    if (p?.wordListId && Array.isArray(p.words)) return p;
  } catch {}
  return null;
}
export function wlCacheSet(userId, wordListId, words) {
  try { localStorage.setItem(`sb_wl_${userId}`,
    JSON.stringify({ v: WL_CACHE_VERSION, wordListId, words })); } catch {}
}
export function wlCacheInvalidate(userId) {
  try { localStorage.removeItem(`sb_wl_${userId}`); } catch {}
}
export function histCacheGet(userId) {
  try { const r = localStorage.getItem(`sb_hist_${userId}`); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
export function histCacheSet(userId, h) {
  try { localStorage.setItem(`sb_hist_${userId}`, JSON.stringify(h)); } catch {}
}
export function ratsCacheGet(userId) {
  try { const r = localStorage.getItem(`sb_rats_${userId}`); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
export function ratsCacheSet(userId, r) {
  try { localStorage.setItem(`sb_rats_${userId}`, JSON.stringify(r)); } catch {}
}
export function userCacheInvalidate(userId) {
  ['sb_wl_', 'sb_hist_', 'sb_rats_'].forEach(k => {
    try { localStorage.removeItem(`${k}${userId}`); } catch {}
  });
}

// ── Admin list metadata cache (sessionStorage, 5-min TTL) ────────────────────
// Admin lists are shared across all users so one cache key suffices per session.
const ADMIN_LIST_CACHE_KEY = 'sb_admin_lists';
const LIST_META_TTL_MS     = 5 * 60 * 1000;

function adminListCacheGet() {
  try {
    const raw = sessionStorage.getItem(ADMIN_LIST_CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > LIST_META_TTL_MS) return null;
    return data;
  } catch { return null; }
}
function adminListCacheSet(data) {
  try { sessionStorage.setItem(ADMIN_LIST_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}
function adminListCacheInvalidate() {
  try { sessionStorage.removeItem(ADMIN_LIST_CACHE_KEY); } catch {}
}

// ── Per-child list metadata cache (sessionStorage, 5-min TTL) ────────────────
function childListCacheGet(childId) {
  try {
    const raw = sessionStorage.getItem(`sb_child_lists_${childId}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > LIST_META_TTL_MS) return null;
    return data;
  } catch { return null; }
}
function childListCacheSet(childId, data) {
  try { sessionStorage.setItem(`sb_child_lists_${childId}`, JSON.stringify({ ts: Date.now(), data })); } catch {}
}
export function childListCacheInvalidate(childId) {
  try { sessionStorage.removeItem(`sb_child_lists_${childId}`); } catch {}
}

export const DB = {
  auth: {
    async signInWithGoogle() {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in settings or environment variables.');
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/login' }
      });
      if (error) throw error;
    },
    async signUpWithEmail(email, password) {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in settings or environment variables.');
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { emailRedirectTo: window.location.origin + '/login' }
      });
      if (error) throw error;
      return data;
    },
    async signInWithEmail(email, password) {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in settings or environment variables.');
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      return data;
    },
    async signOut() {
      if (!isSupabaseConfigured) return;
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  },

  users: {
    async getByAuthId(authId) {
      const { data, error } = await supabase
        .from('users').select('*').eq('auth_id', authId).maybeSingle();
      if (error) throw error;
      return data;
    },
    async getByEmail(email) {
      const { data, error } = await supabase
        .from('users').select('*').eq('email', email.toLowerCase().trim()).maybeSingle();
      if (error) throw error;
      return data;
    },
    async getChildren(parentId) {
      const { data, error } = await supabase
        .from('users').select('*').eq('parent_id', parentId).order('created_at');
      if (error) throw error;
      return data || [];
    },
    // Self-registration: called on first sign-in (Google or email/password).
    // Uses a SECURITY DEFINER RPC to bypass RLS before auth_user_id() resolves.
    // Retries up to 3 times with backoff in case the JWT hasn't fully
    // propagated to the auth server yet (common on first email sign-up).
    async register(userData) {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 600 * attempt));
        const { data, error } = await supabase.rpc('register_user', {
          p_auth_id:   userData.auth_id,
          p_email:     userData.email,
          p_name:      userData.name,
          p_avatar:    userData.avatar,
          p_role:      userData.role,
          p_last_mode: userData.last_mode,
          p_theme:     userData.theme,
        });
        if (!error) return Array.isArray(data) ? data[0] : data;
        lastError = error;
        // Only retry on auth-related errors — not on constraint violations etc.
        if (!error.message?.includes('Unauthorized') &&
            !error.message?.includes('JWT') &&
            !error.message?.includes('auth')) break;
      }
      throw lastError;
    },
    // Child creation: called by a parent adding a child profile.
    // auth_id is NULL so the direct-insert RLS policy applies:
    //   auth_id IS NULL AND parent_id = auth_user_id()
    async create(userData) {
      const { data, error } = await supabase
        .from('users').insert(userData).select().single();
      if (error) throw error;
      return data;
    },
    async update(id, updates) {
      const { data, error } = await supabase
        .from('users').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    async delete(id) {
      const { error } = await supabase.from('users').delete().eq('id', id);
      if (error) throw error;
      userCacheInvalidate(id);
    },
    async linkAuthId(email, authId) {
      // Use SECURITY DEFINER RPC — same chicken-and-egg issue as create().
      const { data, error } = await supabase.rpc('link_auth_id', {
        p_email:   email,
        p_auth_id: authId,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    // Checks whether the user's email matches app_config.admin_email.
    // If it does and the role isn't already 'admin', promotes the row and
    // returns the updated profile. Otherwise returns the profile unchanged.
    // Called on every sign-in so the first-ever admin login is handled
    // automatically without any manual DB intervention.
    async promoteToAdminIfNeeded(userId, email) {
      const { data: cfg } = await supabase
        .from('app_config').select('admin_email').limit(1).maybeSingle();
      if (!cfg?.admin_email) return null; // app_config not yet seeded
      if (cfg.admin_email.toLowerCase() !== email.toLowerCase()) return null;
      // Email matches — ensure the role is 'admin'
      const { data, error } = await supabase
        .from('users').update({ role: 'admin' })
        .eq('id', userId).select().single();
      if (error) throw error;
      return data;
    },
  },

  wordLists: {
    // ── Admin shared library ─────────────────────────────────────
    async getAdminLists() {
      const cached = adminListCacheGet();
      if (cached) return cached;
      // Fetch lists + word count + how many children currently use each list
      const { data, error } = await supabase
        .from('word_lists')
        .select('id, name, description, created_at, word_list_words(count), user_word_lists(count)')
        .eq('scope', 'admin')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const result = (data || []).map(r => ({
        id: r.id, name: r.name, description: r.description || '',
        createdAt: r.created_at, scope: 'admin',
        wordCount:        r.word_list_words?.[0]?.count ?? 0,
        activeChildCount: r.user_word_lists?.[0]?.count ?? 0,
      }));
      adminListCacheSet(result);
      return result;
    },

    // ── Child personal lists ─────────────────────────────────────
    async getChildLists(childId) {
      const cached = childListCacheGet(childId);
      if (cached) return cached;
      const { data, error } = await supabase
        .from('word_lists')
        .select('id, name, description, created_at, word_list_words(count)')
        .eq('scope', 'child')
        .eq('owner_id', childId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const result = (data || []).map(r => ({
        id: r.id, name: r.name, createdAt: r.created_at, scope: 'child',
        wordCount:   r.word_list_words?.[0]?.count ?? 0,
        description: r.description || '',
      }));
      childListCacheSet(childId, result);
      return result;
    },

    // ── Rename / delete (works for both scopes) ──────────────────
    async rename(listId, newName, scope, ownerId) {
      const { error } = await supabase
        .from('word_lists').update({ name: newName }).eq('id', listId);
      if (error) throw error;
      if (scope === 'admin') adminListCacheInvalidate();
      if (scope === 'child' && ownerId) childListCacheInvalidate(ownerId);
    },
    async updateDescription(listId, description, scope, ownerId) {
      const { error } = await supabase
        .from('word_lists').update({ description }).eq('id', listId);
      if (error) throw error;
      if (scope === 'admin') adminListCacheInvalidate();
      if (scope === 'child' && ownerId) childListCacheInvalidate(ownerId);
    },

    async delete(listId, scope, ownerId) {
      const { error } = await supabase.from('word_lists').delete().eq('id', listId);
      if (error) throw error;
      if (scope === 'admin') adminListCacheInvalidate();
      if (scope === 'child' && ownerId) {
        childListCacheInvalidate(ownerId);
        wlCacheInvalidate(ownerId);
      }
    },

    // ── Import from file ─────────────────────────────────────────
    // scope: 'admin' | 'child'
    // ownerId: child UUID for 'child' scope; null for 'admin' scope
    async import(createdByUserId, listName, wordObjects, scope, ownerId) {
      const rpcWords = wordObjects.map((w, idx) => ({
        word:                    w.word.trim(),
        normalizedWord:          w.normalizedWord || normalizeWord(w.word),
        normalizedPronunciation: normalizePronunciation(w.pronunciation || ''),
        pronunciation:           (w.pronunciation        || '').trim(),
        definition:              (w.definition           || '').trim(),
        allowableSpellings:      (w.allowableSpellings   || '').trim(),
        origin:                  (w.origin               || '').trim(),
        partOfSpeech:            (w.partOfSpeech         || '').trim(),
        sentence:                (w.sentence             || '').trim(),
        audioLink:               (w.audioLink            || '').trim(),
        bundle:                  (w.bundle               || '').trim(),
        id: w.id !== undefined ? String(w.id) : String(idx + 1)
      }));
      const { data: listId, error } = await supabase.rpc('import_word_list', {
        p_created_by: createdByUserId,
        p_list_name:  listName,
        p_scope:      scope,
        p_owner_id:   ownerId || null,
        p_words:      rpcWords
      });
      if (error) throw error;
      if (scope === 'admin') adminListCacheInvalidate();
      if (scope === 'child' && ownerId) {
        childListCacheInvalidate(ownerId);
        wlCacheInvalidate(ownerId);
      }
      return { id: listId, name: listName, scope };
    },

    // ── Manual word entry (creates a new child-scope or admin-scope list) ──
    async createManual(createdByUserId, childId, listName, words, scope = 'child') {
      const rpcWords = words.map((w, idx) => ({
        word:                    w.word.trim(),
        normalizedWord:          normalizeWord(w.word),
        normalizedPronunciation: '',
        pronunciation:           '',
        definition:              (w.definition || '').trim(),
        allowableSpellings: '', origin: '', partOfSpeech: '',
        sentence: '', audioLink: '', bundle: '',
        id: String(idx + 1)
      }));
      const { data: listId, error } = await supabase.rpc('import_word_list', {
        p_created_by: createdByUserId,
        p_list_name:  listName,
        p_scope:      scope,
        p_owner_id:   scope === 'admin' ? null : childId,
        p_words:      rpcWords
      });
      if (error) throw error;
      if (scope === 'admin') adminListCacheInvalidate();
      if (scope === 'child' && childId) {
        childListCacheInvalidate(childId);
        wlCacheInvalidate(childId);
      }
      return { id: listId, name: listName, scope };
    },

    // ── Assign an existing list as a child's active list ─────────
    async assignToChild(childId, listId) {
      const { error } = await supabase.rpc('assign_list_to_child', {
        p_child_id: childId,
        p_list_id:  listId
      });
      if (error) throw error;
      // Invalidate the child's active-list cache so the next load hits the DB
      wlCacheInvalidate(childId);
    },

    // ── Load the active word list for a given user ───────────────
    async loadForUser(userId) {
      const cached = wlCacheGet(userId);
      if (cached) return cached.words;
      const { data: assignment, error: aErr } = await supabase
        .from('user_word_lists').select('word_list_id')
        .eq('user_id', userId)
        .order('assigned_at', { ascending: false }).limit(1).maybeSingle();
      if (aErr) throw aErr;
      if (!assignment) return [];
      const wordListId = assignment.word_list_id;
      // Fetch words and overrides in parallel
      const [{ data: rows, error: wErr }, { data: ovRows, error: ovErr }] = await Promise.all([
        supabase.from('word_list_words').select('source_id, words(*)')
          .eq('word_list_id', wordListId).limit(10000),
        supabase.from('word_overrides').select('*')
          .eq('word_list_id', wordListId).limit(10000)
      ]);
      if (wErr) throw wErr;
      if (ovErr) throw ovErr;
      const overrideMap = {};
      (ovRows || []).forEach(o => { overrideMap[o.word_id] = o; });
      const sorted = (rows || []).sort((a, b) =>
        (Number(a.source_id) || 0) - (Number(b.source_id) || 0)
      );
      const words = sorted.map(r => {
        const w = r.words;
        const ov = overrideMap[w.id] || {};
        return {
          wordId: w.id, word: ov.word ?? w.word,
          normalizedWord:         w.normalized_word,
          normalizedPronunciation: w.normalized_pronunciation || '',
          bundle:             ov.bundle              ?? w.bundle,
          definition:         ov.definition          ?? w.definition,
          pronunciation:      ov.pronunciation       ?? w.pronunciation,
          allowableSpellings: ov.allowable_spellings ?? w.allowable_spellings,
          origin:             ov.origin              ?? w.origin,
          partOfSpeech:       ov.part_of_speech      ?? w.part_of_speech,
          sentence:           ov.sentence            ?? w.sentence,
          audioLink:          ov.audio_link          ?? w.audio_link,
          id: r.source_id || undefined,
          hasOverride: !!overrideMap[w.id],
        };
      });
      wlCacheSet(userId, wordListId, words);
      return words;
    },

    // Returns all words for a list with overrides merged, plus base values
    // for the word editor (so it can show 'Reset to original').
    async getListWords(listId) {
      const [{ data: rows, error: wErr }, { data: ovRows, error: ovErr }] = await Promise.all([
        supabase.from('word_list_words').select('source_id, words(*)')
          .eq('word_list_id', listId).limit(10000),
        supabase.from('word_overrides').select('*')
          .eq('word_list_id', listId).limit(10000)
      ]);
      if (wErr) throw wErr;
      if (ovErr) throw ovErr;
      const overrideMap = {};
      (ovRows || []).forEach(o => { overrideMap[o.word_id] = o; });
      const sorted = (rows || []).sort((a, b) =>
        (Number(a.source_id) || 0) - (Number(b.source_id) || 0)
      );
      return sorted.map(r => {
        const w = r.words;
        const ov = overrideMap[w.id] || null;
        return {
          wordId: w.id,
          id: r.source_id || undefined,
          // Effective (merged) values
          word:               ov?.word              ?? w.word,
          normalizedWord:          w.normalized_word,
          normalizedPronunciation: w.normalized_pronunciation || '',
          bundle:             ov?.bundle             ?? w.bundle,
          definition:         ov?.definition         ?? w.definition,
          pronunciation:      ov?.pronunciation      ?? w.pronunciation,
          allowableSpellings: ov?.allowable_spellings ?? w.allowable_spellings,
          origin:             ov?.origin             ?? w.origin,
          partOfSpeech:       ov?.part_of_speech     ?? w.part_of_speech,
          sentence:           ov?.sentence           ?? w.sentence,
          audioLink:          ov?.audio_link         ?? w.audio_link,
          // Base values (always from master, for 'Reset to original')
          baseWord:               w.word,
          basePronunciation:      w.pronunciation,
          baseDefinition:         w.definition,
          baseAllowableSpellings: w.allowable_spellings,
          baseOrigin:             w.origin,
          basePartOfSpeech:       w.part_of_speech,
          baseSentence:           w.sentence,
          baseAudioLink:          w.audio_link,
          baseBundle:             w.bundle,
          hasOverride: !!ov,
        };
      });
    },

    // Returns all user IDs currently assigned to a given list.
    // Used to invalidate their active word list caches after an override write.
    async getUsersOnList(listId) {
      const { data, error } = await supabase
        .from('user_word_lists').select('user_id').eq('word_list_id', listId);
      if (error) throw error;
      return (data || []).map(r => r.user_id);
    },

    // Write (or update) a word override for a specific list.
    // Pass only the fields that changed; others should be null/undefined.
    async upsertOverride(wordId, listId, fields) {
      const { error } = await supabase.from('word_overrides').upsert({
        word_id: wordId, word_list_id: listId,
        word:                fields.word                || null,
        pronunciation:       fields.pronunciation       || null,
        definition:          fields.definition          || null,
        allowable_spellings: fields.allowableSpellings  || null,
        origin:              fields.origin              || null,
        part_of_speech:      fields.partOfSpeech        || null,
        sentence:            fields.sentence            || null,
        audio_link:          fields.audioLink           || null,
        bundle:              fields.bundle              || null,
        updated_at:          new Date().toISOString(),
      }, { onConflict: 'word_id,word_list_id' });
      if (error) throw error;
      // Invalidate the active word list cache for every user on this list
      // so the next loadForUser call re-fetches with the new override merged in.
      const userIds = await this.getUsersOnList(listId).catch(() => []);
      userIds.forEach(id => wlCacheInvalidate(id));
    },

    // Remove all overrides for a word on a specific list (reset to master).
    async deleteOverride(wordId, listId) {
      const { error } = await supabase.from('word_overrides').delete()
        .eq('word_id', wordId).eq('word_list_id', listId);
      if (error) throw error;
      // Invalidate affected users' caches, same as upsertOverride.
      const userIds = await this.getUsersOnList(listId).catch(() => []);
      userIds.forEach(id => wlCacheInvalidate(id));
    },

    // Apply admin-approved changes from the ImportDiffModal.
    async applyUpdate(listId, changes, newWords) {
      const { data, error } = await supabase.rpc('apply_list_update', {
        p_list_id:   listId,
        p_changes:   changes,
        p_new_words: newWords,
      });
      if (error) throw error;
      adminListCacheInvalidate();
      // Invalidate every child currently on this list so their next
      // loadForUser call re-fetches with the updated overrides merged in.
      const userIds = await this.getUsersOnList(listId).catch(() => []);
      userIds.forEach(id => wlCacheInvalidate(id));
      return Number(data); // updated total word count
    },

    // Fetch the admin overview (per-family progress summary).
    async getAdminOverview() {
      const { data, error } = await supabase.rpc('get_admin_overview');
      if (error) throw error;
      return data || [];
    },

    // ── Active list name for a child (used on child cards) ───────
    async getActiveListName(childId) {
      const { data, error } = await supabase
        .from('user_word_lists')
        .select('word_list_id, word_lists(name)')
        .eq('user_id', childId)
        .order('assigned_at', { ascending: false })
        .limit(1).maybeSingle();
      if (error) throw error;
      return data?.word_lists?.name || null;
    },

    async getActiveAssignments(childIds) {
      if (!childIds || !childIds.length) return {};
      const { data, error } = await supabase
        .from('user_word_lists')
        .select('user_id, word_list_id, word_lists(name)')
        .in('user_id', childIds)
        .order('assigned_at', { ascending: false });
      if (error) return {};
      const map = {};
      (data || []).forEach(r => {
        if (!map[r.user_id]) {
          map[r.user_id] = { listId: r.word_list_id, listName: r.word_lists?.name || null };
        }
      });
      return map;
    },

    async getChildrenHistoryCounts(childIds) {
      if (!childIds.length) return {};
      const { data, error } = await supabase.rpc('get_history_counts', { p_user_ids: childIds });
      if (error) throw error;
      const counts = {};
      childIds.forEach(id => { counts[id] = { correct: 0, incorrect: 0 }; });
      (data || []).forEach(r => {
        counts[r.user_id] = { correct: Number(r.correct), incorrect: Number(r.incorrect) };
      });
      return counts;
    },

    async getChildrenWordCounts(childIds) {
      if (!childIds.length) return {};
      const result = {};
      childIds.forEach(id => { result[id] = 0; });
      const { data: assignments, error: aErr } = await supabase
        .from('user_word_lists')
        .select('user_id, word_list_id, assigned_at')
        .in('user_id', childIds)
        .order('assigned_at', { ascending: false });
      if (aErr) throw aErr;
      const latestListByChild = {};
      (assignments || []).forEach(a => {
        if (!latestListByChild[a.user_id]) latestListByChild[a.user_id] = a.word_list_id;
      });
      const uniqueListIds = [...new Set(Object.values(latestListByChild))];
      if (!uniqueListIds.length) return result;
      const { data: lists, error: lErr } = await supabase
        .from('word_lists')
        .select('id, word_list_words(count)')
        .in('id', uniqueListIds);
      if (lErr) throw lErr;
      const countByList = {};
      (lists || []).forEach(l => {
        countByList[l.id] = Number(l.word_list_words?.[0]?.count ?? 0);
      });
      Object.entries(latestListByChild).forEach(([userId, listId]) => {
        result[userId] = countByList[listId] ?? 0;
      });
      return result;
    },
  },

  history: {
    async load(userId) {
      const { data, error } = await supabase
        .from('word_history').select('word_id, status').eq('user_id', userId).limit(10000);
      if (error) throw error;
      const result = {};
      (data || []).forEach(r => { result[r.word_id] = r.status; });
      return result;
    },
    async upsert(userId, wordId, status) {
      const { error } = await supabase.from('word_history').upsert(
        { user_id: userId, word_id: wordId, status, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,word_id' }
      );
      if (error) throw error;
    },
    // Import progress (status + rating) from a word list file.
    // Entries: [{ wordId, status, rating }] — status/rating may be undefined.
    async bulkImportProgress(userId, entries) {
      if (!entries.length) return;
      const toUpsert = entries
        .filter(e => e.status)
        .map(e => ({ wordId: e.wordId, status: e.status }));
      if (toUpsert.length) {
        const { error } = await supabase.rpc('flush_history_batch', {
          p_user_id: userId,
          p_deletes: [],
          p_upserts: JSON.stringify(toUpsert),
        });
        if (error) throw error;
      }
      const ratingEntries = entries.filter(e => e.rating >= 2 && e.rating <= 5);
      for (const e of ratingEntries) {
        await supabase.from('word_ratings').upsert(
          { user_id: userId, word_id: e.wordId, rating: e.rating,
            updated_at: new Date().toISOString() },
          { onConflict: 'user_id,word_id' }
        );
      }
    },
    async batchFlush(userId, writes) {
      if (!writes.length) return;
      const toDelete = writes.filter(w => w.status === null).map(w => w.wordId);
      const toUpsert = writes.filter(w => w.status !== null);
      const { error } = await supabase.rpc('flush_history_batch', {
        p_user_id: userId,
        p_deletes: toDelete,
        p_upserts: toUpsert.map(w => ({ wordId: w.wordId, status: w.status })),
      });
      if (error) throw error;
    },
    async remove(userId, wordId) {
      const { error } = await supabase.from('word_history').delete()
        .eq('user_id', userId).eq('word_id', wordId);
      if (error) throw error;
    },
    async reset(userId) {
      const { error } = await supabase.from('word_history').delete().eq('user_id', userId);
      if (error) throw error;
      histCacheSet(userId, {});
    },
  },

  ratings: {
    async load(userId) {
      const { data, error } = await supabase
        .from('word_ratings').select('word_id, rating').eq('user_id', userId).limit(10000);
      if (error) throw error;
      const result = {};
      (data || []).forEach(r => { result[r.word_id] = r.rating; });
      return result;
    },
    async upsert(userId, wordId, rating) {
      const { error } = await supabase.from('word_ratings').upsert(
        { user_id: userId, word_id: wordId, rating, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,word_id' }
      );
      if (error) throw error;
    },
    async remove(userId, wordId) {
      const { error } = await supabase.from('word_ratings').delete()
        .eq('user_id', userId).eq('word_id', wordId);
      if (error) throw error;
    },
    async reset(userId) {
      const { error } = await supabase.from('word_ratings').delete().eq('user_id', userId);
      if (error) throw error;
      ratsCacheSet(userId, {});
    },
  },
};
