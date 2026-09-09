-- ═══════════════════════════════════════════════════════════════
--  ADAPTIVE SPELLING BUNDLE — SUPABASE SCHEMA
--  Run this entire file in the Supabase SQL Editor once (fresh install).
--  For existing databases use add_admin_support.sql instead.
-- ═══════════════════════════════════════════════════════════════

-- ── TABLES ─────────────────────────────────────────────────────

-- Stores the designated admin email. Insert one row after deploy:
--   INSERT INTO app_config (admin_email) VALUES ('you@example.com');
CREATE TABLE app_config (
    admin_email TEXT NOT NULL
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    parent_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    avatar          TEXT NOT NULL DEFAULT '🦁',
    role            TEXT NOT NULL DEFAULT 'kid'
                         CHECK (role IN ('kid','parent','admin')),
    access_type     TEXT NOT NULL DEFAULT 'local'
                         CHECK (access_type IN ('local','email')),
    email           TEXT UNIQUE,
    last_mode       TEXT NOT NULL DEFAULT 'spelling'
                         CHECK (last_mode IN ('spelling','flashcard')),
    theme           TEXT NOT NULL DEFAULT 'space',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE word_lists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- 'admin' = shared library visible to all users, managed only by the admin.
    -- 'child' = personal list owned by one child.
    scope       TEXT NOT NULL DEFAULT 'child'
                     CHECK (scope IN ('admin','child')),
    -- For child-scope lists: the child this list belongs to. NULL for admin-scope.
    owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Master words table — each unique word exists exactly once.
CREATE TABLE words (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    word                     TEXT NOT NULL,
    normalized_word          TEXT NOT NULL,
    normalized_pronunciation TEXT NOT NULL DEFAULT '',
    pronunciation            TEXT NOT NULL DEFAULT '',
    definition               TEXT NOT NULL DEFAULT '',
    allowable_spellings      TEXT NOT NULL DEFAULT '',
    origin                   TEXT NOT NULL DEFAULT '',
    part_of_speech           TEXT NOT NULL DEFAULT '',
    sentence                 TEXT NOT NULL DEFAULT '',
    audio_link               TEXT NOT NULL DEFAULT '',
    bundle                   TEXT NOT NULL DEFAULT '',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (normalized_word, normalized_pronunciation)
);

-- Links a word to a specific list. source_id holds the original row number.
CREATE TABLE word_list_words (
    word_id      UUID NOT NULL REFERENCES words(id)      ON DELETE CASCADE,
    word_list_id UUID NOT NULL REFERENCES word_lists(id)  ON DELETE CASCADE,
    source_id    TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (word_id, word_list_id)
);

-- Which list is currently active for each user (one row per user = active list).
CREATE TABLE user_word_lists (
    user_id         UUID NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    word_list_id    UUID NOT NULL REFERENCES word_lists(id)  ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, word_list_id)
);

CREATE TABLE word_history (
    user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    word_id    UUID NOT NULL REFERENCES words(id)  ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('correct','incorrect')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, word_id)
);

CREATE TABLE word_ratings (
    user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    word_id    UUID NOT NULL REFERENCES words(id)  ON DELETE CASCADE,
    rating     SMALLINT NOT NULL CHECK (rating BETWEEN 2 AND 5),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, word_id)
);

-- ── INDEXES ────────────────────────────────────────────────────

CREATE INDEX idx_users_auth_id       ON users(auth_id);
CREATE INDEX idx_users_parent_id     ON users(parent_id);
CREATE INDEX idx_users_email         ON users(email);
CREATE INDEX idx_words_norm          ON words(normalized_word);
CREATE INDEX idx_words_norm_pair     ON words(normalized_word, normalized_pronunciation);
CREATE INDEX idx_wl_scope            ON word_lists(scope);
CREATE INDEX idx_wl_owner_id         ON word_lists(owner_id);
CREATE INDEX idx_wlw_word_id         ON word_list_words(word_id);
CREATE INDEX idx_wlw_list_id         ON word_list_words(word_list_id);
CREATE INDEX idx_uwl_user_id         ON user_word_lists(user_id);
CREATE INDEX idx_uwl_assigned_at     ON user_word_lists(user_id, assigned_at DESC);
CREATE INDEX idx_history_user_id     ON word_history(user_id);
CREATE INDEX idx_history_word_id     ON word_history(word_id);
CREATE INDEX idx_ratings_user_id     ON word_ratings(user_id);
CREATE INDEX idx_ratings_word_id     ON word_ratings(word_id);

-- ── HELPER FUNCTIONS ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION auth_user_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1
$$;

-- True if the caller's email matches the admin_email in app_config.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u, app_config c
        WHERE u.auth_id = auth.uid()
          AND lower(u.email) = lower(c.admin_email)
    )
$$;

CREATE OR REPLACE FUNCTION is_self_or_child(uid UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT uid = auth_user_id()
        OR EXISTS (SELECT 1 FROM users WHERE id = uid AND parent_id = auth_user_id())
$$;

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────

ALTER TABLE app_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_lists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE words           ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_list_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_word_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_ratings    ENABLE ROW LEVEL SECURITY;

-- APP_CONFIG — only the admin can read (is_admin() reads it internally too,
-- because it runs SECURITY DEFINER and bypasses this policy).
CREATE POLICY "app_config_select" ON app_config FOR SELECT USING (is_admin());

-- USERS
CREATE POLICY "users_select" ON users FOR SELECT USING (
    id = auth_user_id() OR parent_id = auth_user_id()
);
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (
    auth_id = auth.uid()
    OR (auth_id IS NULL AND parent_id = auth_user_id())
);
CREATE POLICY "users_update" ON users FOR UPDATE USING (
    id = auth_user_id() OR parent_id = auth_user_id()
);
CREATE POLICY "users_delete" ON users FOR DELETE USING (
    id = auth_user_id() OR parent_id = auth_user_id()
);

-- WORD_LISTS
-- SELECT: admin-scope lists are public to all authenticated users.
--         Child-scope lists are visible to the owning child and their parent.
CREATE POLICY "word_lists_select" ON word_lists FOR SELECT USING (
    scope = 'admin'
    OR created_by = auth_user_id()
    OR owner_id   = auth_user_id()
    OR owner_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
    OR id IN (
        SELECT word_list_id FROM user_word_lists
        WHERE user_id = auth_user_id()
           OR user_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
    )
);
-- Most writes go through SECURITY DEFINER RPCs; these policies are safety nets.
CREATE POLICY "word_lists_insert" ON word_lists FOR INSERT WITH CHECK (
    created_by = auth_user_id()
);
CREATE POLICY "word_lists_update" ON word_lists FOR UPDATE USING (
    (scope = 'admin' AND is_admin()) OR created_by = auth_user_id()
);
CREATE POLICY "word_lists_delete" ON word_lists FOR DELETE USING (
    (scope = 'admin' AND is_admin()) OR created_by = auth_user_id()
);

-- WORDS
CREATE POLICY "words_select" ON words FOR SELECT USING (
    id IN (
        SELECT word_id FROM word_list_words
        WHERE word_list_id IN (
            -- Words in the shared library are always readable
            SELECT id FROM word_lists WHERE scope = 'admin'
            UNION
            SELECT id FROM word_lists WHERE created_by = auth_user_id()
            UNION
            SELECT id FROM word_lists
             WHERE owner_id = auth_user_id()
                OR owner_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
            UNION
            SELECT word_list_id FROM user_word_lists
             WHERE user_id = auth_user_id()
                OR user_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
        )
    )
);
CREATE POLICY "words_insert" ON words FOR INSERT WITH CHECK (auth_user_id() IS NOT NULL);
CREATE POLICY "words_update" ON words FOR UPDATE USING (
    id IN (
        SELECT word_id FROM word_list_words
        WHERE word_list_id IN (
            SELECT id FROM word_lists WHERE created_by = auth_user_id()
        )
    )
);

-- WORD_LIST_WORDS
CREATE POLICY "wlw_select" ON word_list_words FOR SELECT USING (
    word_list_id IN (
        SELECT id FROM word_lists WHERE scope = 'admin'
        UNION
        SELECT id FROM word_lists WHERE created_by = auth_user_id()
        UNION
        SELECT id FROM word_lists
         WHERE owner_id = auth_user_id()
            OR owner_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
        UNION
        SELECT word_list_id FROM user_word_lists
         WHERE user_id = auth_user_id()
            OR user_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
    )
);
CREATE POLICY "wlw_insert" ON word_list_words FOR INSERT WITH CHECK (
    word_list_id IN (SELECT id FROM word_lists WHERE created_by = auth_user_id())
);
CREATE POLICY "wlw_delete" ON word_list_words FOR DELETE USING (
    word_list_id IN (SELECT id FROM word_lists WHERE created_by = auth_user_id())
);

-- USER_WORD_LISTS
-- SELECT: admin can read all assignments (needed for activeChildCount and
-- getUsersOnList cache invalidation). INSERT/DELETE remain restricted so
-- the admin cannot directly reassign other families' children; those writes
-- go through SECURITY DEFINER RPCs that enforce their own auth checks.
CREATE POLICY "uwl_select" ON user_word_lists FOR SELECT USING (
    is_self_or_child(user_id) OR is_admin()
);
CREATE POLICY "uwl_insert" ON user_word_lists FOR INSERT WITH CHECK (is_self_or_child(user_id));
CREATE POLICY "uwl_delete" ON user_word_lists FOR DELETE USING (is_self_or_child(user_id));

-- WORD_HISTORY
CREATE POLICY "history_select" ON word_history FOR SELECT USING (is_self_or_child(user_id));
CREATE POLICY "history_insert" ON word_history FOR INSERT WITH CHECK (is_self_or_child(user_id));
CREATE POLICY "history_update" ON word_history FOR UPDATE USING (is_self_or_child(user_id));
CREATE POLICY "history_delete" ON word_history FOR DELETE USING (is_self_or_child(user_id));

-- WORD_RATINGS
CREATE POLICY "ratings_select" ON word_ratings FOR SELECT USING (is_self_or_child(user_id));
CREATE POLICY "ratings_insert" ON word_ratings FOR INSERT WITH CHECK (is_self_or_child(user_id));
CREATE POLICY "ratings_update" ON word_ratings FOR UPDATE USING (is_self_or_child(user_id));
CREATE POLICY "ratings_delete" ON word_ratings FOR DELETE USING (is_self_or_child(user_id));

-- ── ATOMIC IMPORT FUNCTION ──────────────────────────────────────
-- Creates a word list (admin- or child-scope), upserts all words, and for
-- child-scope imports assigns the list as the child's active list.
--
-- p_scope    'admin' | 'child'
-- p_owner_id child UUID for child-scope; NULL for admin-scope
-- p_words    JSONB array of word objects (camelCase keys)
CREATE OR REPLACE FUNCTION import_word_list(
  p_created_by  UUID,
  p_list_name   TEXT,
  p_scope       TEXT,
  p_owner_id    UUID,
  p_words       JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_list_id  UUID;
  v_word_id  UUID;
  v_word     JSONB;
  v_nw       TEXT;
  v_np       TEXT;
  v_src      TEXT;
  v_idx      INT := 0;
BEGIN
  INSERT INTO word_lists (name, scope, owner_id, created_by)
  VALUES (p_list_name, p_scope, p_owner_id, p_created_by)
  RETURNING id INTO v_list_id;

  FOR v_word IN SELECT * FROM jsonb_array_elements(p_words) LOOP
    v_nw  := trim(v_word->>'normalizedWord');
    v_np  := coalesce(trim(v_word->>'normalizedPronunciation'), '');
    v_src := coalesce(v_word->>'id', (v_idx + 1)::text);
    v_idx := v_idx + 1;

    INSERT INTO words (
      word, normalized_word, normalized_pronunciation,
      pronunciation, definition, allowable_spellings,
      origin, part_of_speech, sentence, audio_link, bundle
    ) VALUES (
      trim(v_word->>'word'), v_nw, v_np,
      coalesce(trim(v_word->>'pronunciation'), ''),
      coalesce(trim(v_word->>'definition'), ''),
      coalesce(trim(v_word->>'allowableSpellings'), ''),
      coalesce(trim(v_word->>'origin'), ''),
      coalesce(trim(v_word->>'partOfSpeech'), ''),
      coalesce(trim(v_word->>'sentence'), ''),
      coalesce(trim(v_word->>'audioLink'), ''),
      coalesce(trim(v_word->>'bundle'), '')
    )
    ON CONFLICT (normalized_word, normalized_pronunciation)
    DO UPDATE SET
      word           = EXCLUDED.word,
      pronunciation  = EXCLUDED.pronunciation,
      definition     = EXCLUDED.definition,
      origin         = EXCLUDED.origin,
      part_of_speech = EXCLUDED.part_of_speech,
      sentence       = EXCLUDED.sentence,
      audio_link     = EXCLUDED.audio_link,
      bundle         = EXCLUDED.bundle
    RETURNING id INTO v_word_id;

    INSERT INTO word_list_words (word_id, word_list_id, source_id)
    VALUES (v_word_id, v_list_id, v_src)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Child-scope imports are automatically assigned as the child's active list.
  IF p_scope = 'child' AND p_owner_id IS NOT NULL THEN
    DELETE FROM user_word_lists WHERE user_id = p_owner_id;
    INSERT INTO user_word_lists (user_id, word_list_id) VALUES (p_owner_id, v_list_id);
  END IF;

  RETURN v_list_id;
END;
$$;
GRANT EXECUTE ON FUNCTION import_word_list TO authenticated;

-- ── ASSIGN LIST TO CHILD ────────────────────────────────────────
-- Replaces a child's active list. Safe to call from parent or child session.
CREATE OR REPLACE FUNCTION assign_list_to_child(p_child_id UUID, p_list_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_self_or_child(p_child_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM user_word_lists WHERE user_id = p_child_id;
  INSERT INTO user_word_lists (user_id, word_list_id, assigned_at)
  VALUES (p_child_id, p_list_id, NOW());
END;
$$;
GRANT EXECUTE ON FUNCTION assign_list_to_child TO authenticated;

-- ── GROUP-BY HISTORY COUNTS ─────────────────────────────────────
CREATE OR REPLACE FUNCTION get_history_counts(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, correct BIGINT, incorrect BIGINT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE status = 'correct')   AS correct,
    COUNT(*) FILTER (WHERE status = 'incorrect') AS incorrect
  FROM word_history
  WHERE user_id = ANY(p_user_ids)
  GROUP BY user_id;
$$;
GRANT EXECUTE ON FUNCTION get_history_counts TO authenticated;

-- ── BATCH HISTORY FLUSH ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION flush_history_batch(
  p_user_id UUID,
  p_deletes UUID[],
  p_upserts JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry  JSONB;
  v_now    TIMESTAMPTZ := NOW();
BEGIN
  IF NOT is_self_or_child(p_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF array_length(p_deletes, 1) IS NOT NULL THEN
    DELETE FROM word_history
    WHERE user_id = p_user_id AND word_id = ANY(p_deletes);
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_upserts) LOOP
    INSERT INTO word_history (user_id, word_id, status, updated_at)
    VALUES (p_user_id, (v_entry->>'wordId')::UUID, v_entry->>'status', v_now)
    ON CONFLICT (user_id, word_id) DO UPDATE
      SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION flush_history_batch TO authenticated;


-- ── 2. word_overrides table ─────────────────────────────────────
-- Per-list field overrides. Only set columns override the master word.
-- All field columns are nullable — NULL means "use the master value".
CREATE TABLE IF NOT EXISTS word_overrides (
    word_id             UUID NOT NULL REFERENCES words(id)      ON DELETE CASCADE,
    word_list_id        UUID NOT NULL REFERENCES word_lists(id)  ON DELETE CASCADE,
    word                TEXT,
    pronunciation       TEXT,
    definition          TEXT,
    allowable_spellings TEXT,
    origin              TEXT,
    part_of_speech      TEXT,
    sentence            TEXT,
    audio_link          TEXT,
    bundle              TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (word_id, word_list_id)
);

CREATE INDEX IF NOT EXISTS idx_overrides_list_id ON word_overrides(word_list_id);

-- ── 3. RLS on word_overrides ────────────────────────────────────
ALTER TABLE word_overrides ENABLE ROW LEVEL SECURITY;

-- Anyone who can see the list can read its overrides.
CREATE POLICY "overrides_select" ON word_overrides FOR SELECT USING (
    word_list_id IN (
        SELECT id FROM word_lists WHERE scope = 'admin'
        UNION
        SELECT id FROM word_lists WHERE created_by = auth_user_id()
        UNION
        SELECT id FROM word_lists
         WHERE owner_id = auth_user_id()
            OR owner_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
        UNION
        SELECT word_list_id FROM user_word_lists
         WHERE user_id = auth_user_id()
            OR user_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
    )
);

-- Write access: creator of the list OR parent of the owning child.
CREATE POLICY "overrides_insert" ON word_overrides FOR INSERT WITH CHECK (
    word_list_id IN (
        SELECT id FROM word_lists WHERE created_by = auth_user_id()
        UNION
        SELECT id FROM word_lists
         WHERE scope = 'child'
           AND owner_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
    )
);
CREATE POLICY "overrides_update" ON word_overrides FOR UPDATE USING (
    word_list_id IN (
        SELECT id FROM word_lists WHERE created_by = auth_user_id()
        UNION
        SELECT id FROM word_lists
         WHERE scope = 'child'
           AND owner_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
    )
);
CREATE POLICY "overrides_delete" ON word_overrides FOR DELETE USING (
    word_list_id IN (
        SELECT id FROM word_lists WHERE created_by = auth_user_id()
        UNION
        SELECT id FROM word_lists
         WHERE scope = 'child'
           AND owner_id IN (SELECT id FROM users WHERE parent_id = auth_user_id())
    )
);

-- ── 4. Admin overview RPC ───────────────────────────────────────
-- Returns one row per child: parent name, child name, active list
-- name, and aggregate correct / incorrect / total_words counts.
-- SECURITY DEFINER — admin-only gate enforced inside the function.
CREATE OR REPLACE FUNCTION get_admin_overview()
RETURNS TABLE (
    parent_name      TEXT,
    child_name       TEXT,
    child_id         UUID,
    active_list_id   UUID,
    active_list_name TEXT,
    correct          BIGINT,
    incorrect        BIGINT,
    total_words      BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    RETURN QUERY
    SELECT
        p.name                                                        AS parent_name,
        c.name                                                        AS child_name,
        c.id                                                          AS child_id,
        uwl_latest.word_list_id                                       AS active_list_id,
        wl.name                                                       AS active_list_name,
        COUNT(wh.word_id) FILTER (WHERE wh.status = 'correct')       AS correct,
        COUNT(wh.word_id) FILTER (WHERE wh.status = 'incorrect')     AS incorrect,
        COUNT(DISTINCT wlw.word_id)                                   AS total_words
    FROM users c
    JOIN users p ON c.parent_id = p.id
    -- most-recent active list per child
    LEFT JOIN LATERAL (
        SELECT word_list_id
        FROM user_word_lists
        WHERE user_id = c.id
        ORDER BY assigned_at DESC
        LIMIT 1
    ) uwl_latest ON true
    LEFT JOIN word_lists wl     ON wl.id  = uwl_latest.word_list_id
    LEFT JOIN word_list_words wlw ON wlw.word_list_id = uwl_latest.word_list_id
    LEFT JOIN word_history wh   ON wh.user_id = c.id
    WHERE c.role = 'kid'
    GROUP BY p.name, c.name, c.id, uwl_latest.word_list_id, wl.name
    ORDER BY p.name, c.name;
END;
$$;
GRANT EXECUTE ON FUNCTION get_admin_overview TO authenticated;

-- ── 5. apply_list_update RPC ────────────────────────────────────
-- Applies admin-approved changes from the diff review.
-- For existing words: upserts word_overrides.
-- For new words: inserts into words + word_list_words.
-- Returns the total word count for the list after applying.
CREATE OR REPLACE FUNCTION apply_list_update(
    p_list_id      UUID,
    p_changes      JSONB,   -- array of {wordId, ...fields} for existing-word overrides
    p_new_words    JSONB    -- array of full word objects for brand-new words
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_entry    JSONB;
    v_word_id  UUID;
    v_count    INT;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Apply overrides for existing words
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
        v_word_id := (v_entry->>'wordId')::UUID;
        INSERT INTO word_overrides (
            word_id, word_list_id,
            word, pronunciation, definition, allowable_spellings,
            origin, part_of_speech, sentence, audio_link, bundle, updated_at
        ) VALUES (
            v_word_id, p_list_id,
            NULLIF(trim(v_entry->>'word'), ''),
            NULLIF(trim(v_entry->>'pronunciation'), ''),
            NULLIF(trim(v_entry->>'definition'), ''),
            NULLIF(trim(v_entry->>'allowableSpellings'), ''),
            NULLIF(trim(v_entry->>'origin'), ''),
            NULLIF(trim(v_entry->>'partOfSpeech'), ''),
            NULLIF(trim(v_entry->>'sentence'), ''),
            NULLIF(trim(v_entry->>'audioLink'), ''),
            NULLIF(trim(v_entry->>'bundle'), ''),
            NOW()
        )
        ON CONFLICT (word_id, word_list_id) DO UPDATE SET
            word                = COALESCE(EXCLUDED.word,                word_overrides.word),
            pronunciation       = COALESCE(EXCLUDED.pronunciation,       word_overrides.pronunciation),
            definition          = COALESCE(EXCLUDED.definition,          word_overrides.definition),
            allowable_spellings = COALESCE(EXCLUDED.allowable_spellings, word_overrides.allowable_spellings),
            origin              = COALESCE(EXCLUDED.origin,              word_overrides.origin),
            part_of_speech      = COALESCE(EXCLUDED.part_of_speech,      word_overrides.part_of_speech),
            sentence            = COALESCE(EXCLUDED.sentence,            word_overrides.sentence),
            audio_link          = COALESCE(EXCLUDED.audio_link,          word_overrides.audio_link),
            bundle              = COALESCE(EXCLUDED.bundle,              word_overrides.bundle),
            updated_at          = NOW();
    END LOOP;

    -- Insert new words
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_new_words) LOOP
        INSERT INTO words (
            word, normalized_word, normalized_pronunciation,
            pronunciation, definition, allowable_spellings,
            origin, part_of_speech, sentence, audio_link, bundle
        ) VALUES (
            trim(v_entry->>'word'),
            trim(v_entry->>'normalizedWord'),
            coalesce(trim(v_entry->>'normalizedPronunciation'), ''),
            coalesce(trim(v_entry->>'pronunciation'), ''),
            coalesce(trim(v_entry->>'definition'), ''),
            coalesce(trim(v_entry->>'allowableSpellings'), ''),
            coalesce(trim(v_entry->>'origin'), ''),
            coalesce(trim(v_entry->>'partOfSpeech'), ''),
            coalesce(trim(v_entry->>'sentence'), ''),
            coalesce(trim(v_entry->>'audioLink'), ''),
            coalesce(trim(v_entry->>'bundle'), '')
        )
        ON CONFLICT (normalized_word, normalized_pronunciation)
        DO UPDATE SET word = EXCLUDED.word
        RETURNING id INTO v_word_id;

        INSERT INTO word_list_words (word_id, word_list_id, source_id)
        VALUES (
            v_word_id, p_list_id,
            coalesce(v_entry->>'id', gen_random_uuid()::text)
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT COUNT(*) INTO v_count
    FROM word_list_words WHERE word_list_id = p_list_id;

    RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION apply_list_update TO authenticated;



-- ═══════════════════════════════════════════════════════════════
--  MIGRATION: fix user self-registration RLS issue
--
--  Run this in the Supabase SQL Editor if you already ran schema.sql.
--  For fresh installs use schema.sql instead (already includes this).
--
--  Problem: On first sign-in, auth_user_id() returns NULL because no
--  row exists yet in the users table for this auth.uid(). This causes
--  the users_insert RLS policy to reject the new row even though the
--  user is legitimately authenticated.
--
--  Fix: Two SECURITY DEFINER functions handle self-registration and
--  auth-id linking, bypassing RLS while still validating identity.
--  The direct-insert policy is tightened to only allow child profiles.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Self-registration function ───────────────────────────────
CREATE OR REPLACE FUNCTION register_user(
    p_auth_id   UUID,
    p_email     TEXT,
    p_name      TEXT,
    p_avatar    TEXT,
    p_role      TEXT,
    p_last_mode TEXT,
    p_theme     TEXT
)
RETURNS SETOF users
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_auth_id != auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: auth_id does not match current user';
    END IF;

    RETURN QUERY
    INSERT INTO users (auth_id, email, name, avatar, role, access_type, last_mode, theme)
    VALUES (p_auth_id, lower(trim(p_email)), trim(p_name), p_avatar,
            p_role, 'email', p_last_mode, p_theme)
    ON CONFLICT (auth_id) DO UPDATE
        SET email = EXCLUDED.email,
            name  = COALESCE(NULLIF(EXCLUDED.name, ''), users.name)
    RETURNING *;
END;
$$;
GRANT EXECUTE ON FUNCTION register_user TO authenticated;

-- ── 2. Link auth ID function ─────────────────────────────────────
CREATE OR REPLACE FUNCTION link_auth_id(
    p_email   TEXT,
    p_auth_id UUID
)
RETURNS SETOF users
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_auth_id != auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: auth_id does not match current user';
    END IF;

    RETURN QUERY
    UPDATE users
       SET auth_id = p_auth_id
     WHERE email = lower(trim(p_email))
       AND auth_id IS NULL
    RETURNING *;
END;
$$;
GRANT EXECUTE ON FUNCTION link_auth_id TO authenticated;

-- ── 3. Tighten users_insert policy ──────────────────────────────
-- Direct INSERT is now only for child profiles (auth_id IS NULL,
-- parent inserts on the child's behalf). Self-registration goes
-- through register_user() above.
DROP POLICY IF EXISTS "users_insert" ON users;
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (
    auth_id IS NULL AND parent_id = auth_user_id()
);