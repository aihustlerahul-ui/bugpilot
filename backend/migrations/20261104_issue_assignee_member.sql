-- Migration: 20261104_issue_assignee_member.sql
-- Purpose: Structured issue assignment to a workspace member (BugPilot developer workflow)
-- Idempotent — safe to re-run.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS assignee_member_id uuid REFERENCES workspace_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issues_assignee_member ON issues (assignee_member_id);
