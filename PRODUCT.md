# QA Reporter — Product Overview

## What We're Building

QA Reporter is a **bug-capture platform for QA teams** that lets testers report UI issues directly from any web page without switching context. It combines a Chrome extension (the capture tool) with a web dashboard (the management hub) and integrates with external trackers like Azure DevOps, Jira, and Trello.

The core insight: QA engineers lose time switching between the broken page, a bug tracker, and screenshots. QA Reporter collapses that into a single click on the element.

---

## Target Users

- QA engineers and testers on product teams
- Developers doing self-review before shipping
- Product managers doing acceptance testing

---

## Product Architecture

```
Chrome Extension  ──►  NestJS Backend (port 4000)  ──►  Supabase (DB + Auth + Storage)
(capture tool)              /api/*                          PostgreSQL + Row-Level Security
                                                        ──►  Azure DevOps / Jira / Trello / Monday
Web Platform      ──►  Same backend
(Next.js, port 3000)
```

---

## What Has Been Built

### Chrome Extension (v2.1)
- **MV3 Side Panel** — opens on icon click; replaces the old popup. Stays open across navigation.
- **Element capture** — hover highlight (blue outline, no page pollution), click to capture. Modal form appears near the clicked element.
- **Screenshot modes** (5 options, selectable from web app):
  - `full` — full viewport
  - `element_crop` — tight crop to element
  - `element_context` — crop with 80px padding (default)
  - `full_highlighted` — full page with red highlight rect
  - `both` — context crop + full as backup
- **Screenshot annotation canvas** — full-screen overlay for drawing on any captured screenshot before submitting:
  - **7 tools**: Rectangle (R), Arrow (A), Circle (C), Freehand pen (P), Text (T), Blur/Redact (B), Select (V) — keyboard shortcuts in parentheses
  - **Select tool** — click to select a shape (dashed border + 8 white handle dots appear); drag body to move; drag a handle to resize; Delete/Backspace removes the selected shape; clicking empty canvas deselects
  - **Resize handles** — 8 handles (4 corners + 4 edge midpoints) per selected shape, each showing a directional resize cursor:
    - *Rect / Circle / Blur*: drag any handle to move that corner/edge; opposite corner/edge stays anchored
    - *Arrow*: NW handle moves tail, SE handle moves tip; other handles adjust proportionally
    - *Pen stroke*: all points scale proportionally relative to the bounding box
    - *Text*: top/bottom handles scale font size vertically; left/right handles scale horizontally; corner handles scale diagonally; baseline position updates automatically so the text stays inside the dragged bounds
  - **Stroke width slider** — 1–12px range slider in the toolbar; applies to new shapes and updates live on any selected shape; stored per-shape so undo restores prior width
  - **Text font size** — derived from the stroke width slider at draw time (`max(10, strokeWidth × 4)px`); resizable after placement via resize handles
  - **Color picker** — applies to new shapes and updates live on the selected shape; stored per-shape
  - **Inline text input** — floating `<input>` at the click position (no `window.prompt()` — works in all injection contexts); focused after the originating click settles (setTimeout 0); blur listener added 200ms later to avoid instant dismissal; committed on Enter or blur, cancelled on Escape; `e.stopPropagation()` prevents tool shortcuts from firing while typing
  - **Undo** — object-model history (`shapes[]` snapshots); each draw / move / resize / color change / delete is a discrete undo step; stack initialised with empty state so undo cannot go past the base screenshot
  - **Keyboard shortcuts** — V/R/A/C/P/T/B switch tools; Delete or Backspace removes selected shape; Escape closes the annotator without saving
  - **Done flow** — clears selection handles before capture so they don't appear in the exported image; toolbar hides, footer shows two options:
    - *Replace original* — overwrites the slider image at the edited index
    - *Keep both* — inserts the annotated version immediately after the original in the slider
  - All slider images (original + any annotated versions) are sent as `metadata.screenshots: [{label, url}]` — no 2-image cap; the platform issue detail page and Azure DevOps sync both read this array, falling back to `screenshot_url` / `element_screenshot_url` columns for older issues
- **Image slider in submit modal** — scrolls through all captured screenshots; each has an Edit button to open the annotation canvas
- **Bug report form** — Title, Description (primary), Severity collapsible. Draggable modal, positioned near clicked element.
- **Save & Continue** — buffers issue locally, keeps recording
- **Save & Submit** — buffers + immediately POSTs to backend
- **Buffer list** — side panel shows all captured issues with severity badges, Submit All / Clear
- **Console error capture** — intercepts `console.error` / `console.warn`
- **Network error capture** — intercepts `fetch` and XHR for 4xx/5xx responses
- **React component detection** — reads `__reactFiber$` to extract component name + tree + props; on localhost dev builds also captures exact source file path + line number via React's `_debugSource` (works automatically with any React/Next.js/Vite app in dev mode — no extra setup)
- **CSS selector + XPath generation** — stable selectors that survive React re-renders
- **Semantic context** — column headers, nearest labels, ARIA attributes
- **Keyboard shortcut** — `⌥⇧Q` toggles recording from any page
- **Session persistence** — auth token + refresh token stored in `chrome.storage.local`; auto-refreshes on expiry (no forced sign-out)
- **Settings sync** — pulls screenshot mode + data capture toggles from backend on recording start
- **Session replay (rrweb)** — independent screen recording via "Start Recording Screen":
  - Rolling buffer (30s–5min window), saved to `qa_saved_replay` on stop (manual, timer, or tab hidden)
  - Sidepanel chip shows saved replay duration; auto-attaches to next bug on matching URL (origin + pathname)
  - gzip-compressed payload uploaded with issue; stored in private `qa-replays` bucket
  - Privacy: `maskAllInputs`, optional `data-qa-mask` / `data-qa-block` selectors
- **Multi-tab recording** — opt-in workspace setting; rrweb auto-injected into each new tab on switch:
  - Multi-stream format `{ version: 2, streams: [{tabId, url, events[]}], switches: [{at, toTabId}] }`
  - Tab-count badge in sidepanel; separate start/stop path (`START_MULTITAB_RECORDING`)
  - `AUTO_STOP_RECORDING` (visibilitychange) suppressed in multi-tab mode — only manual stop ends session
  - Re-inject on refresh and back/forward navigation: events flushed to buffer before re-inject, merged on save
  - `<all_urls>` host permission enables non-gesture `executeScript` on tab switch
- **Attach replay to bug during recording** — when a bug is captured while recording is active, the modal shows a recording indicator with two options:
  - *Attach clip & continue* — snapshots rrweb events up to that moment, attaches to bug; recording keeps going
  - *Stop & attach* — stops recorder at that point, saves full clip, attaches to bug; works for both single and multi-tab
  - Ignoring the section submits the bug without video; recording is never interrupted by default
- **Real video screen recording** — opt-in workspace setting (`videoRecordingEnabled`), independent of rrweb replay; captures actual pixels for pages replay can't render faithfully (spreadsheets, canvas apps):
  - Single-tab: `chrome.tabCapture` (seamless, no picker) · Multi-tab mode: `getDisplayMedia` (native screen/window/tab picker, follows tab switches)
  - Attach at issue creation (checkbox in the bug modal when a recording is pending) or to an existing issue via a dropdown of the 10 most recent issues in the project
  - Uploaded as WebM, stored in the private `videos` Storage bucket, signed URL on read
- **Mic + tab audio capture** — opt-in (`captureAudioEnabled`); mic and tab audio mixed into the video's single audio track via a Web Audio `AudioContext` graph
- **Webcam capture** — opt-in (`captureWebcamEnabled`); records a separate silent 320×240 WebM clip in lockstep with the screen recording, uploaded and attached alongside it (`webcam_storage_path` column)
- **Mic mute + live level meter, webcam live preview** — while video recording is active, the sidepanel shows a mute toggle (routed through a Web Audio `GainNode`, not `track.enabled`, so the level meter keeps reading real input even while muted) and an animated 8-bar level meter, plus a small live camera preview thumbnail
- **Media permission status row** — mic/camera chips (grey "Not yet granted" / green "Ready" / red "Blocked") shown next to Record Video whenever audio or webcam capture is enabled; clicking a chip re-triggers the browser permission prompt or opens `chrome://settings/content/...` when blocked; live-updates via `navigator.permissions.query(...).onchange`, no manual refresh needed
- **Media setup page** (`setup.html`) — Chrome's side panel does not reliably show native `getUserMedia` permission prompts (a confirmed Side Panel API limitation — the identical page works fine as a normal tab). When a permission request fails from the side panel, a persistent inline banner links to this dedicated setup tab: mic and camera test cards with device pickers, a live level meter / camera preview to confirm each device actually works, then a "Return to side panel" button — becomes "All set" with a 5-second countdown once everything needed is granted. Granting here works because it's a real tab, and the permission decision is per-origin so it carries back to the side panel automatically.

### Web Platform (Next.js)
- **Auth** — Supabase email/password, ES256 JWT, token stored in `sessionStorage`
- **Projects** — list, create, view issues per project
- **Issues** — per-project issue list with detail view (screenshots via signed URLs)
- **Session replay player** — rrweb-based `ReplayPlayer` on issue detail: play/pause, scrub, ±10s, speed, fullscreen overlay; shareable public link via replay token (`/replay/:token`)
  - Multi-tab replays render a tab strip above the viewport; player auto-switches the visible Replayer instance as playback crosses tab-switch timestamps; per-stream seek offsets keep all streams in sync
- **Video player** — custom `VideoPlayer` component for real screen recordings on issue detail (replaces the native `<video controls>`): play/pause, scrub bar with hover-preview timestamp tooltip, volume + mute, playback speed (0.5×–4×), CSS-overlay fullscreen (not the native Fullscreen API, so the synced webcam circle stays visible while fullscreen)
  - Webcam overlay is draggable — snaps to the nearest of 4 corners on release, position persisted to `localStorage` across every video viewed in the browser
- **Connectors hub** — step-by-step setup guides for Azure DevOps, Jira, Trello, Monday
- **Extension settings page** — screenshot mode selector with SVG previews, data capture toggles, connection status badge, download + install guide
- **Sticky sidebar** — persistent navigation

### Backend (NestJS)
- **Auth** — all routes validated via `supabase.auth.getUser(token)`
- **Projects** CRUD — scoped to workspace owner
- **Issues** — create with screenshot + optional replay upload; signed replay URL on GET; `DELETE /api/issues/:id` removes replay file from Storage then row (`replay_tokens` cascade via FK)
- **Video/webcam uploads** — `POST /api/issues/upload-video` uploads a WebM blob to the private `videos` bucket, returns its storage path; `PATCH /api/issues/:id/video` links a `videoStoragePath`/`webcamStoragePath` to an issue; both signed into `videoUrl`/`webcamUrl` on `GET /api/issues/:id`
- **Workspaces** — auto-created on first login; `settings` JSONB column for extension config
- **GET/PATCH /workspaces/settings** — extension pulls/pushes screenshot mode + toggles; `multiTabRecording`, `videoRecordingEnabled`, `captureAudioEnabled`, `captureWebcamEnabled` booleans in settings schema
- **CORS** — configurable via `CORS_ORIGINS` env var (comma-separated); `PLATFORM_URL` for replay link generation
- **Azure DevOps integration** — PAT encrypted at rest (AES-256-GCM), creates work items, syncs issues
- **Jira integration** — OAuth, create issues
- **Trello / Monday** — setup guides (connectors page), integration hooks ready

### Security
- PAT stored encrypted (AES-256-GCM), never returned to frontend in plaintext
- Screenshots in private Supabase Storage bucket, accessed via signed URLs only
- All API routes validate Supabase JWT before processing
- `backend/.env` and `platform/.env.local` are gitignored

---

## Roadmap / What's Next

| Priority | Feature |
|----------|---------|
| High | GitHub Issues + Linear connectors |
| High | AI auto-fill (title, steps) from captured context |
| Medium | Guest / magic-link reporting (no extension) |
| Medium | Duplicate detection (URL + selector hash) |
| Medium | Slack / Teams webhook on issue submit |
| ✅ Done | Session replay — record, buffer, attach, platform player, share links |
| ✅ Done | Annotation canvas — draw, resize, stroke width, inline text, keep both/replace |
| ✅ Done | Multi-tab recording — auto-inject rrweb on tab switch, tab-strip player, multi-stream format |
| ✅ Done | Attach replay clip to bug mid-recording — snapshot without stopping, or stop & attach |
| ✅ Done | Re-inject rrweb after refresh and back/forward navigation during recording |
| ✅ Done | Real video screen recording — single/multi-tab capture, attach at creation or after |
| ✅ Done | Mic + tab audio capture, webcam capture, mute + live level meter, webcam live preview |
| ✅ Done | Media permission status row + dedicated setup page (Side Panel getUserMedia workaround) |
| ✅ Done | Enhanced video player — scrub/volume/speed/fullscreen, draggable corner-snapping webcam overlay |
| Low | Side-by-side diff view (expected vs actual screenshot) |
| Low | Team workspaces (multi-user) |

---

## Dev-Mode Source Linking (localhost)

When the extension is used on a **localhost dev build** (React, Next.js, Vite, CRA — anything using Babel in dev mode), bug reports automatically include:

- **Exact component name** — e.g. `<UserMenu>`
- **Source file path** — e.g. `src/components/Header/UserMenu.tsx`
- **Line number** — e.g. `:42`

This works because Babel's `babel-plugin-transform-react-jsx-source` (included automatically in all dev builds) injects `_debugSource` into each fiber node. The extension reads this with zero setup from the developer.

The file path and line are shown as a clickable-style chip in the issue detail view, turning bug reports from "top-right button" into "open `src/components/Header/UserMenu.tsx:42`".

---

## Key Product Decisions Made

| Decision | Rationale |
|----------|-----------|
| Side panel instead of popup | Popup closes on any click; side panel stays open while tester navigates |
| Form near element (in-page modal) | Context — tester sees exactly what they clicked while filling the form |
| Buffer-first submit | Lets tester capture many issues in one session, submit in batch |
| No banner / no page DOM pollution | Banner blocked navbar; side panel shows recording status |
| 5 screenshot modes | Different teams need different fidelity; configurable per workspace |
| Refresh token storage | Supabase JWTs expire in 1h; refresh tokens last 60 days |
| Separate setup tab for mic/camera permission | Chrome's Side Panel API doesn't reliably show native `getUserMedia` prompts — confirmed via live testing (identical page works fine as a normal tab); granting once in a tab carries back to the side panel since the permission is per-origin |
| Webcam mute via Web Audio `GainNode`, not `track.enabled` | `track.enabled = false` silences the track for every consumer, including the level meter's `AnalyserNode` — would make "muted" indistinguishable from "mic not working" |
| CSS-overlay fullscreen, not the native Fullscreen API | Native fullscreen only fullscreens the `<video>` element itself; the webcam overlay (a DOM sibling) would disappear. A `fixed inset-0` state-driven overlay keeps everything in the DOM and visible |
