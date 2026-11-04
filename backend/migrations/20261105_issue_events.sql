-- Migration: 20261105_issue_events.sql
-- Purpose: History of status and assignee changes per issue (shown on the issue detail page)
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS issue_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id       uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  event_type     text NOT NULL CHECK (event_type IN ('status', 'assignee')),
  from_value     text,
  to_value       text,
  actor_user_id  uuid,
  actor_name     text NOT NULL,
  source         text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'mcp')),
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_events_issue_created ON issue_events (issue_id, created_at);

-- RLS on with no policies: only the service role (backend) can access.
ALTER TABLE issue_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
