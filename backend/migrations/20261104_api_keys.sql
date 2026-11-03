-- Migration: 20261104_api_keys.sql
-- Purpose: Personal API keys for the BugPilot MCP developer workflow (SHA-256 hash only stored)
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  key_prefix   text NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);

-- RLS on with no policies: only the service role (backend) can access.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
