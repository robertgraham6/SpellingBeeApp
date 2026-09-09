-- ═══════════════════════════════════════════════════════════════
--  ADMIN SUPPORT MIGRATION
--  Run this in Supabase SQL Editor on an EXISTING database.
--  For fresh installs use schema.sql instead.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. app_config table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
    admin_email TEXT NOT NULL
);

-- ── 2. users: add 'admin' to the role constraint ───────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('kid','parent','admin'));

-- ── 3. word_lists: add scope and owner_id columns ─────────────
ALTER TABLE word_lists
    ADD COLUMN IF NOT EXISTS scope    TEXT NOT NULL DEFAULT 'child'
                                           CHECK (scope IN ('admin','child')),
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Back-fill existing lists: treat all as child-scope created by the parent.
-- owner_id stays NULL for now (no way to determine the child automatically).
-- You can manually UPDATE word_lists SET owner_id = '<child-id>' as needed.

-- ── 4. New indexes ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wl_scope    ON word_lists(scope);
CREATE INDEX IF NOT EXISTS idx_wl_owner_id ON word_lists(owner_id);

-- ── 5. Enable RLS on new table ─────────────────────────────────
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- ── 6. New helper functions ────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u, app_config c
        WHERE u.auth_id = auth.uid()
          AND lower(u.email) = lower(c.admin_email)
    )
$$;

-- ── 7. Drop and recreate all affected RLS policies ─────────────

-- app_config
DROP POLICY IF EXISTS "app_config_select" ON app_config;
CREATE POLICY "app_config_select" ON app_config FOR SELECT USING (is_admin());

-- word_lists (all four policies change)
DROP POLICY IF EXISTS "word_lists_select" ON word_lists;
DROP POLICY IF EXISTS "word_lists_insert" ON word_lists;
DROP POLICY IF EXISTS "word_lists_update" ON word_lists;
DROP POLICY IF EXISTS "word_lists_delete" ON word_lists;

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
CREATE POLICY "word_lists_insert" ON word_lists FOR INSERT WITH CHECK (
    created_by = auth_user_id()
);
CREATE POLICY "word_lists_update" ON word_lists FOR UPDATE USING (
    (scope = 'admin' AND is_admin()) OR created_by = auth_user_id()
);
CREATE POLICY "word_lists_delete" ON word_lists FOR DELETE USING (
    (scope = 'admin' AND is_admin()) OR created_by = auth_user_id()
);

-- words_select (needs to include admin-scope list words)
DROP POLICY IF EXISTS "words_select" ON words;
CREATE POLICY "words_select" ON words FOR SELECT USING (
    id IN (
        SELECT word_id FROM word_list_words
        WHERE word_list_id IN (
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

-- wlw_select (needs to include admin-scope list words)
DROP POLICY IF EXISTS "wlw_select" ON word_list_words;
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

-- ── 8. Replace import_word_list (new signature) ────────────────
-- Old signature had p_user_ids UUID[]. New signature has p_scope + p_owner_id.
-- If you have existing code calling the old RPC, update it before running this.
DROP FUNCTION IF EXISTS import_word_list(UUID, TEXT, UUID[], JSONB);

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

  IF p_scope = 'child' AND p_owner_id IS NOT NULL THEN
    DELETE FROM user_word_lists WHERE user_id = p_owner_id;
    INSERT INTO user_word_lists (user_id, word_list_id) VALUES (p_owner_id, v_list_id);
  END IF;

  RETURN v_list_id;
END;
$$;
GRANT EXECUTE ON FUNCTION import_word_list TO authenticated;

-- ── 9. New assign_list_to_child RPC ───────────────────────────
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

-- ── 10. Set the admin email ────────────────────────────────────
-- Replace with your actual admin email and uncomment:
-- INSERT INTO app_config (admin_email) VALUES ('admin@example.com');

-- ── 11. Set the admin user role ────────────────────────────────
-- Replace with the admin's email and uncomment:
-- UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';

-- ── Fix user_word_lists SELECT policy for admin ───────────────────────
DROP POLICY IF EXISTS "uwl_select" ON user_word_lists;
CREATE POLICY "uwl_select" ON user_word_lists FOR SELECT USING (
    is_self_or_child(user_id) OR is_admin()
);
