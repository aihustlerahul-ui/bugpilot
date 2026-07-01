-- Run this in Supabase SQL Editor for the QA Reporter project.
-- Video screen recording: adds video_storage_path column to issues table to track
-- screen recording videos stored in a private Storage bucket named 'videos'.
-- Idempotent — safe to re-run.
-- Note: the 'videos' Storage bucket must be created manually in Supabase dashboard
-- with private visibility (same settings as 'qa-replays' bucket).

-- ── issues.video_storage_path ────────────────────────────────────────────────
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS video_storage_path text;
