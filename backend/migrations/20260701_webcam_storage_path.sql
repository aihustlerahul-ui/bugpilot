-- Run this in Supabase SQL Editor for the QA Reporter project.
-- Webcam recording: adds webcam_storage_path column to issues table to track
-- the silent webcam video recorded alongside the screen recording, stored in
-- the same private 'videos' Storage bucket as video_storage_path.
-- Idempotent — safe to re-run.

-- ── issues.webcam_storage_path ───────────────────────────────────────────────
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS webcam_storage_path text;
