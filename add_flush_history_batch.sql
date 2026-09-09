-- ── BATCH HISTORY FLUSH ─────────────────────────────────────────────────────
-- Applies a mixed set of deletes and upserts to word_history in one round-trip.
--
-- Called from db.js → DB.history.batchFlush() at the end of a practice session
-- instead of firing N individual upsert/delete RPCs.
--
-- Parameters
--   p_user_id  — the child (or self) whose history is being written
--   p_deletes  — word_ids to remove (words whose status was reset to null)
--   p_upserts  — JSONB array of {wordId, status} pairs to upsert
--
-- Security
--   SECURITY DEFINER so the function runs with owner privileges and can bypass
--   RLS, but it first verifies the caller is allowed to write to p_user_id via
--   the same is_self_or_child() helper used by the RLS policies themselves.
--   This matches the pattern used by import_word_list and get_history_counts.
--
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Auth guard: caller must be p_user_id themselves, or the parent of p_user_id.
  -- Mirrors the is_self_or_child() check used by the word_history RLS policies.
  IF NOT is_self_or_child(p_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 1. Deletes — words whose in-app status was reset to null
  IF array_length(p_deletes, 1) IS NOT NULL THEN
    DELETE FROM word_history
    WHERE user_id = p_user_id
      AND word_id = ANY(p_deletes);
  END IF;

  -- 2. Upserts — insert or update each {wordId, status} pair atomically.
  --    The client sends camelCase keys (wordId / status) to match the rest of
  --    the app's JSONB conventions (see import_word_list).
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_upserts) LOOP
    INSERT INTO word_history (user_id, word_id, status, updated_at)
    VALUES (
      p_user_id,
      (v_entry->>'wordId')::UUID,
      v_entry->>'status',
      v_now
    )
    ON CONFLICT (user_id, word_id) DO UPDATE
      SET status     = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION flush_history_batch TO authenticated;
