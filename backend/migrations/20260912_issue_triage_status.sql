-- Migration: 20260912_issue_triage_status.sql
-- Purpose: Add explicit issue triage lifecycle status separate from sync_status
-- Idempotent — safe to re-run.

-- 1. Add status column with default 'Incoming'
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Incoming';

-- 2. Add check constraint ensuring status is one of the valid triage lifecycle states
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'issues_status_check'
  ) THEN
    ALTER TABLE issues
      ADD CONSTRAINT issues_status_check
      CHECK (status IN ('Incoming', 'In Triage', 'Confirmed', 'In Dev', 'Resolved', 'Closed'));
  END IF;
END $$;

-- 3. Create performance indexes for project/status filtering and sorting
CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues (project_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues (status);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues (created_at DESC);
