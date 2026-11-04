-- Migration: 20261104_issue_comments_compat.sql
-- Purpose: 20261104_issue_comments.sql was skipped (CREATE TABLE IF NOT EXISTS) on databases
--          that already had an older issue_comments table (author_id, author_email, updated_at).
--          Add the columns the comments service needs. Additive only; no data is dropped.
-- Idempotent — safe to re-run.

ALTER TABLE issue_comments ADD COLUMN IF NOT EXISTS author_user_id uuid;
ALTER TABLE issue_comments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'issue_comments_source_check'
  ) THEN
    ALTER TABLE issue_comments
      ADD CONSTRAINT issue_comments_source_check CHECK (source IN ('web', 'mcp'));
  END IF;
END $$;

-- The new service does not write the legacy columns; make sure they cannot reject inserts.
ALTER TABLE issue_comments ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE issue_comments ALTER COLUMN author_email DROP NOT NULL;

-- Backfill so old rows are attributed in the new column too.
UPDATE issue_comments SET author_user_id = author_id WHERE author_user_id IS NULL AND author_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_issue_comments_issue_created ON issue_comments (issue_id, created_at);
ALTER TABLE issue_comments ENABLE ROW LEVEL SECURITY;

-- Make PostgREST see the new columns immediately.
NOTIFY pgrst, 'reload schema';
