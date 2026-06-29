-- Run this in Supabase SQL Editor for the QA Reporter project.
-- Session replay: stores rrweb recordings (gzip) in a private Storage bucket and
-- exposes shareable, expiring replay tokens. Idempotent — safe to re-run.

-- ── issues.replay_storage_path ────────────────────────────────────────────────
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS replay_storage_path text;

-- ── replay share tokens ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replay_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    uuid REFERENCES issues(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_by  uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_replay_tokens_issue_id
  ON replay_tokens (issue_id);

ALTER TABLE replay_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'replay_tokens' AND policyname = 'replay_tokens_insert_own'
  ) THEN
    CREATE POLICY "replay_tokens_insert_own" ON replay_tokens
      FOR INSERT WITH CHECK (auth.uid() = created_by);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'replay_tokens' AND policyname = 'replay_tokens_select_public'
  ) THEN
    -- Public read so unauthenticated /replay/:token pages can validate the token.
    CREATE POLICY "replay_tokens_select_public" ON replay_tokens
      FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'replay_tokens' AND policyname = 'replay_tokens_delete_own'
  ) THEN
    CREATE POLICY "replay_tokens_delete_own" ON replay_tokens
      FOR DELETE USING (auth.uid() = created_by);
  END IF;
END $$;

-- ── private Storage bucket for replays ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('qa-replays', 'qa-replays', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'qa_replays_insert'
  ) THEN
    CREATE POLICY "qa_replays_insert" ON storage.objects
      FOR INSERT WITH CHECK (bucket_id = 'qa-replays' AND auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'qa_replays_select'
  ) THEN
    CREATE POLICY "qa_replays_select" ON storage.objects
      FOR SELECT USING (bucket_id = 'qa-replays' AND auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'qa_replays_delete'
  ) THEN
    CREATE POLICY "qa_replays_delete" ON storage.objects
      FOR DELETE USING (bucket_id = 'qa-replays' AND auth.role() = 'authenticated');
  END IF;
END $$;
