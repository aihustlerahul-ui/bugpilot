# QA Reporter — Claude Context

This file gives Claude instant context about this project so every session starts informed.
Update this file whenever the architecture, conventions, or key decisions change.

---

## Project at a Glance

**QA Reporter** — Chrome extension + NestJS API + Next.js dashboard for QA teams to capture UI bugs in-context.

| Layer | Tech | Port |
|-------|------|------|
| Chrome Extension | MV3, vanilla JS | — |
| Web Platform | Next.js 14, TypeScript, TailwindCSS | 3000 |
| Backend API | NestJS, TypeScript | 4000 (global prefix `/api`) |
| Database / Auth | Supabase (PostgreSQL + Auth + Storage) | — |

---

## Repo Structure

```
project-3/
├── extension/          # Chrome MV3 extension
│   ├── manifest.json   # v2.1 — sidePanel permission, no default_popup
│   ├── background.js   # service worker: screenshots, submit, settings sync, token refresh
│   ├── content.js      # injected into pages: hover highlight, in-page modal
│   ├── content-styles.css  # all qa- prefixed, !important, design tokens as :root vars
│   ├── sidepanel.html/js   # THE main UI: auth, recording controls, buffer list
│   ├── popup.html/js   # legacy — no longer used (action has no default_popup)
│   └── sidepanel.html  # side panel UI
├── platform/           # Next.js web app
│   ├── app/(dashboard)/
│   │   ├── projects/   # project list + issue list + issue detail
│   │   ├── connectors/ # Azure/Jira/Trello/Monday setup guides
│   │   ├── extension/  # extension settings page (screenshot mode, toggles)
│   │   └── settings/   # workspace settings
│   ├── components/     # ConnectorPanel, etc.
│   └── lib/api/client.ts  # typed fetch wrapper (get/post/patch)
├── backend/src/
│   ├── issues/         # POST /issues (screenshot upload to Supabase Storage)
│   ├── projects/       # CRUD /projects
│   ├── workspaces/     # /workspaces/settings (GET + PATCH, JSONB)
│   ├── integrations/   # Azure DevOps PAT encrypt/decrypt, work item creation
│   └── supabase/       # @Global() SupabaseModule, SupabaseService
├── PRODUCT.md          # Product overview — keep updated as features land
└── CLAUDE.md           # This file — technical context for Claude
```

---

## Architecture Patterns

### Auth Flow
- Supabase email/password → ES256 JWT (`access_token` + `refresh_token`)
- Extension stores both in `chrome.storage.local` (`qa_token`, `qa_refresh_token`)
- Platform stores `access_token` in `sessionStorage`
- Backend validates every request: `supabase.auth.getUser(token)` — NOT `jwt.verify()`
- Refresh: on 401, `background.js` calls `/auth/v1/token?grant_type=refresh_token` silently

### Extension Message Flow
```
sidepanel.js  ──sendMessage──►  background.js  (CAPTURE_SCREENSHOT, GET_PROJECTS, SUBMIT_ALL, SYNC_SETTINGS)
content.js    ──sendMessage──►  background.js  (CAPTURE_SCREENSHOT, SUBMIT_ISSUE)
sidepanel.js  ──tabs.sendMessage──►  content.js  (START_REPORTING, STOP_REPORTING, IS_RECORDING)
chrome.storage.onChanged  ──►  sidepanel.js  (live buffer + recording state updates)
```

### Screenshot Pipeline (content.js)
1. Hide QA UI elements
2. `chrome.tabs.captureVisibleTab` in background
3. Canvas crop/draw based on `qa_ext_settings.screenshotMode`:
   - `full` → raw dataUrl
   - `element_crop` → `cropToElement(url, rect, 0, cb)`
   - `element_context` → `cropToElement(url, rect, 80, cb)` (default)
   - `full_highlighted` → `drawHighlight(url, rect, cb)`
   - `both` → element_context + full as backup
4. `cropToElement` uses `window.devicePixelRatio` for retina scaling

### Backend Data Flow
```
POST /api/issues
  → validate JWT (supabase.auth.getUser)
  → upload screenshot to Supabase Storage (private bucket)
  → insert issue row with storage_path
  → optionally push to Azure DevOps / Jira via integrations service
```

### Workspace Settings
- `settings` JSONB column on `workspaces` table (migration must be run manually if not present)
- `GET /api/workspaces/settings` → returns `{ screenshotMode, captureConsole, captureNetwork, ... }`
- `PATCH /api/workspaces/settings` → merges patch into existing settings
- Extension syncs on recording start via `SYNC_SETTINGS` message → caches as `qa_ext_settings`

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `extension/sidepanel.js` | Primary extension UI logic — auth, recording, buffer |
| `extension/content.js` | Page injection — hover highlight, modal near element, screenshot capture |
| `extension/background.js` | Service worker — message routing, API calls, token refresh, keyboard shortcut |
| `backend/src/supabase/supabase.service.ts` | Shared Supabase client, `@Global()` module |
| `backend/src/workspaces/workspaces.service.ts` | `getSettings()` / `updateSettings()` |
| `backend/src/integrations/encryption.service.ts` | AES-256-GCM encrypt/decrypt for PATs |
| `platform/lib/api/client.ts` | `get<T>()`, `post<T>()`, `patch<T>()` typed fetch wrappers |
| `platform/app/(dashboard)/extension/page.tsx` | Extension settings page — screenshot mode + toggles |

---

## Security Rules (non-negotiable)

1. `backend/.env` and `platform/.env.local` are gitignored — never commit secrets
2. PAT stored encrypted (AES-256-GCM) in DB — never returned to frontend in plaintext
3. Screenshots in **private** Supabase Storage bucket — accessed via signed URLs only
4. All API routes validate Supabase JWT via `supabase.auth.getUser(token)` before processing
5. Content script uses `!important` on all styles and `qa-` prefix on all class names to avoid conflicts

---

## Design System

### Extension (content-styles.css + sidepanel.html)
```css
--qa-brand: #5b5fc7   /* indigo */
--qa-surface: #fff
--qa-bg: #f4f5fb
--qa-border: #e2e4f0
--qa-text-hi: #0f1124
--qa-text-mid: #4b5066
--qa-text-lo: #9097b3
--qa-red: #ef4444
--qa-green: #22c55e
```
- Dark header (`#0f1124`) on all panels
- Gradient record button (green), stop button (red)
- All content.js styles prefixed `qa-` with `!important`

### Platform
- Tailwind CSS utility classes
- Supabase Auth UI for login
- shadcn/ui components where applicable

---

## Common Commands

```bash
# Backend
cd backend && npm run start:dev

# Platform
cd platform && npm run dev

# Extension
# Load unpacked from extension/ in chrome://extensions
# Reload after any JS/CSS/manifest change
```

---

## Known Pending Items

- [ ] Run Supabase migration: `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb`
- [ ] Side panel fully built — test end-to-end in Chrome after reload
- [ ] `popup.html/js` kept for reference but no longer launched (action has no `default_popup`)
- [ ] `graphify-out/` — knowledge graph of this codebase (see below)

---

## Graphify Knowledge Graph

This project uses [graphify](https://github.com/safishamsi/graphify) to maintain a queryable knowledge graph of the codebase.

```bash
# Query the graph (fast — no rebuild needed)
graphify query "how does screenshot capture work"
graphify query "what handles token refresh"
graphify query "trace issue submission from extension to database"

# Rebuild after major changes
cd "/Users/rahulsarawagi/Desktop/project 3"
graphify --update     # incremental — only changed files

# Full rebuild (rarely needed)
/graphify .
```

Graph outputs live in `graphify-out/`:
- `graph.html` — interactive visualization
- `graph.json` — raw graph data for queries
- `GRAPH_REPORT.md` — audit report with god nodes + community map
