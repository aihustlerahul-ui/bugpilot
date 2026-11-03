-- Migration: 20261104_issue_comments.sql
-- Purpose: Comments on issues (web + MCP) for the BugPilot developer workflow
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS issue_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id       uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_user_id uuid,
  author_name    text NOT NULL,
  body           text NOT NULL,
  source         text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'mcp')),
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_comments_issue_created ON issue_comments (issue_id, created_at);

-- RLS on with no policies: only the service role (backend) can access.
ALTER TABLE issue_comments ENABLE ROW LEVEL SECURITY;
