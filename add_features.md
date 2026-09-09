-- ═══════════════════════════════════════════════════════════════
--  FEATURES MIGRATION: word overrides, descriptions, overview
--  Run this in the Supabase SQL Editor on an existing database.
--  For fresh installs use schema.sql instead.
--
--  PREREQUISITES — run these first if not already applied:
--    1. add_admin_support.sql  (defines is_admin(), app_config table,
--                               and the admin role on the users table)
--
--  This file uses is_admin() in the get_admin_overview and
--  apply_list_update RPCs. If is_admin() does not exist the RPCs
--  will fail to create and you will see a 'function does not exist'
--  error. Run add_admin_support.sql first, then re-run this file.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. description column on word_lists ────────────────────────
ALTER TABLE word_lists
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

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
