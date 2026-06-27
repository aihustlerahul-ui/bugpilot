# Session Replay — Design Spec
**Date:** 2026-06-27  
**Status:** Approved  
**Scope:** Chrome extension (content.js, sidepanel), NestJS backend, Next.js platform

---

## Overview

Session replay lets QA reporters attach a recording of their browser session to a bug report. The recording captures DOM mutations, clicks, scrolls, and input events using rrweb, compressed and stored in Supabase Storage. Developers can watch the exact steps that led to a bug directly from the issue detail page, or via a shareable link that requires no login.

---

## Architecture

```
background.js (on START_REPORTING, if replay enabled)
  → chrome.scripting.executeScript: inject rrweb.min.js then replay-recorder.js into tab

replay-recorder.js (injected only when toggle is on)
  → rrweb.record() → rolling event buffer (user-selected window: 30s–5min)
  → on GET_REPLAY_EVENTS message: compress with CompressionStream (gzip) → send to background.js

background.js
  → multipart POST to /api/issues (screenshot + replayBlob)

NestJS /api/issues
  → upload replayBlob to Supabase Storage (qa-replays bucket)
  → store replay_storage_path on issue row
  → generate signed URL on GET /api/issues/:id

Platform issue detail
  → fetch signed URL → decompress → rrweb Replayer
  → shareable token via POST /api/issues/:id/replay-token
  → public replay page at /replay/:token (no auth required)
```

---

## Extension

### Toggle + Window Selector (sidepanel.html / sidepanel.js)

- Toggle row added below the "Start Recording" button: `[ ● ] Record session replay  [2 min ▾]`
- Dropdown options: 30s, 1 min, 2 min, 3 min, 4 min, 5 min
- Default: 2 min
- Both values persisted in `chrome.storage.local`:
  - `qa_replay_enabled` (boolean)
  - `qa_replay_window_ms` (number, milliseconds)
- Toggle and dropdown are disabled while a recording is active (settings locked mid-session)

### Recording (replay-recorder.js — lazy injected)

- `rrweb.min.js` and `replay-recorder.js` are **separate files** in `extension/`, declared in `web_accessible_resources`
- Neither file is loaded on any page unless the user has the toggle on and starts a recording
- Zero overhead for users who don't use replay
- `background.js` injects both files via `chrome.scripting.executeScript({ target: { tabId }, files: [...] })` when `START_REPORTING` is received and `qa_replay_enabled` is true
- `replay-recorder.js` is a thin wrapper (~50 lines):
  - Calls `rrweb.record({ emit(event) { ... } })`
  - Maintains rolling buffer: drops events older than `Date.now() - windowMs` on each new event
  - Listens for `GET_REPLAY_EVENTS` message → returns current buffer
  - Listens for `STOP_REPLAY` message → calls stop function, clears buffer
- Strategy: **rolling window** — always keeps the last N milliseconds of events (N = `qa_replay_window_ms`)
  - Ensures submit always captures the most recent window regardless of session length
  - If user picks 30s window and submits quickly after the bug, early events are preserved

### Capture + Submit

- On `SUBMIT_ISSUE`: `background.js` sends `GET_REPLAY_EVENTS` to the tab's `replay-recorder.js`
- `replay-recorder.js` returns the events array
- `background.js` compresses using `CompressionStream('gzip')` before including in the multipart POST
- If `qa_replay_enabled` is false or no recorder was injected, replay fields are omitted — issue submits normally

---

## Backend (NestJS)

### POST /api/issues

- Accepts optional `replayBlob` file field in `multipart/form-data`
- If present:
  1. Upload to Supabase Storage bucket `qa-replays` at path `{workspaceId}/{issueId}.json.gz`
  2. Store path in `issues.replay_storage_path`
- Existing screenshot upload logic unchanged

### GET /api/issues/:id

- If `replay_storage_path` is non-null, generate a 1-hour signed URL for it
- Return as `replayUrl` in the response

### POST /api/issues/:id/replay-token

- Authenticated endpoint (JWT required)
- Creates a row in `replay_tokens`: `{ issue_id, expires_at: now + 7 days, created_by }`
- Returns `{ token: uuid, url: "https://yourapp.com/replay/{uuid}" }`

### GET /api/replay/:token (public)

- No JWT required
- Validates token exists and `expires_at > now`
- Returns replay events (fetches from Supabase Storage, decompresses, returns JSON)
- Returns issue title + severity for display context

### Cleanup

- When an issue is deleted, delete `replay_storage_path` file from Supabase Storage
- `replay_tokens` rows cascade-delete via `ON DELETE CASCADE` on `issue_id`

---

## Database

### Migration (already executed)

```sql
-- Add replay path to issues
ALTER TABLE issues 
ADD COLUMN IF NOT EXISTS replay_storage_path TEXT;

-- Replay share tokens
CREATE TABLE IF NOT EXISTS replay_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_replay_tokens_issue_id 
ON replay_tokens(issue_id);

-- RLS
ALTER TABLE replay_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create replay tokens for their issues"
ON replay_tokens FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Replay tokens are publicly readable"
ON replay_tokens FOR SELECT USING (true);

CREATE POLICY "Users can delete their own replay tokens"
ON replay_tokens FOR DELETE USING (auth.uid() = created_by);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('qa-replays', 'qa-replays', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload replays"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'qa-replays' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read their replays"
ON storage.objects FOR SELECT
USING (bucket_id = 'qa-replays' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete their replays"
ON storage.objects FOR DELETE
USING (bucket_id = 'qa-replays' AND auth.role() = 'authenticated');
```

---

## Platform (Next.js)

### Issue Detail Page

- New "Session Replay" tab, only rendered if `replayUrl` is present on the issue
- On tab open:
  1. Fetch signed URL via `GET /api/issues/:id` (already in response)
  2. Fetch `.json.gz` blob from signed URL
  3. Decompress with `DecompressionStream('gzip')`
  4. Pass events to `new rrweb.Replayer(events, { root: containerEl, skipInactive: true })`
- Player controls:
  - Play / Pause button
  - Scrubber (uses `replayer.goto(timeMs)`)
  - Current time / total duration display
  - Speed selector: 0.5×, 1×, 1.5×, 2× (uses `replayer.setConfig({ speed })`)
  - Fullscreen button
- "Share Replay" button: calls `POST /api/issues/:id/replay-token`, copies resulting URL to clipboard

### Shareable Replay Page (`/replay/[token]`)

- Public route — no auth required, no dashboard chrome
- Calls `GET /api/replay/:token`
- Renders: issue title, severity badge, rrweb player with same controls
- Shows token expiry notice: "This link expires in X days"
- If token expired or invalid: friendly error page ("This replay link has expired")

---

## Key Constraints

- **Max replay window:** 5 minutes (user-selectable, default 2 min)
- **Estimated compressed size:** 30s ≈ 40KB, 2min ≈ 200KB, 5min ≈ 400KB
- **rrweb bundle size:** ~80KB, loaded only when replay toggle is on (lazy-injected via `chrome.scripting.executeScript`)
- **Signed URL expiry:** 1 hour for issue detail, 24 hours for public replay page fetch
- **Share token expiry:** 7 days
- **Storage bucket:** private (`qa-replays`), access via signed URLs only

---

## Out of Scope

- Session replay for guest / magic-link reporters (no extension, no rrweb)
- Replay search or indexing
- Commenting on specific replay timestamps
- Video export
