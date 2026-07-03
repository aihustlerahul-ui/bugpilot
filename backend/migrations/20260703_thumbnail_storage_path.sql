-- Run this in Supabase SQL Editor for the QA Reporter project.
-- Video thumbnails: adds thumbnail_storage_path column to issues table to track
-- a JPEG frame grabbed client-side from the recorded video, stored in the same
-- private 'videos' Storage bucket as video_storage_path/webcam_storage_path.
-- Idempotent — safe to re-run.

-- ── issues.thumbnail_storage_path ────────────────────────────────────────────
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS thumbnail_storage_path text;
