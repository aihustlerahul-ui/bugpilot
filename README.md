# QA Reporter

A Chrome extension + NestJS API + Next.js dashboard for QA teams to capture UI bugs in-context — without leaving the page.

## What it does

Click any element on any web page → instant bug report with screenshot, console errors, network errors, React component tree, CSS selector, XPath, and optional screen recording attached. Issues sync to Azure DevOps, Jira, Trello, or Monday.

## Stack

| Layer | Tech | Port |
|-------|------|------|
| Chrome Extension | MV3, vanilla JS | — |
| Web Platform | Next.js 14, TypeScript, Tailwind | 3000 |
| Backend API | NestJS, TypeScript | 4000 (`/api` prefix) |
| Database / Auth | Supabase (PostgreSQL + Auth + Storage) | — |

## Getting started

### Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- Chrome browser

### Backend

```bash
cd backend
cp .env.example .env          # fill in Supabase keys + ENCRYPTION_SECRET
npm install
npm run start:dev
```

### Platform

```bash
cd platform
cp .env.example .env.local    # fill in Supabase keys + NEXT_PUBLIC_API_URL
npm install
npm run dev
```

### Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Click the QA Reporter icon → side panel opens

## Key features

### Chrome Extension (v2.1)
- **Side panel** — stays open while navigating; hover highlight + click to capture
- **5 screenshot modes** — full, element crop, element context (default), full highlighted, both
- **Annotation canvas** — 7 tools (rect, arrow, circle, freehand, text, blur, select); resize handles; undo; keep both/replace
- **Screen recording** — rrweb-powered rolling buffer (30s–5min); auto-attaches to bug on matching URL
- **Multi-tab recording** — enable in Extension Settings; rrweb injected into each tab on switch; re-injects after refresh or back/forward navigation
- **Attach clip to bug mid-recording** — "Attach clip & continue" snapshots events without stopping; "Stop & attach" ends session and attaches; recording never interrupted by default
- **Context capture** — console errors, network errors, React component tree, CSS selector, XPath, semantic labels, performance metrics
- **Buffer-first** — capture many issues, submit in batch; Save & Continue / Save & Submit / Submit All

### Web Platform
- Projects + issue list with detail view
- Session replay player — play/pause, scrub, speed, fullscreen; tab strip for multi-tab replays
- Shareable public replay links (`/replay/:token`)
- Extension settings page — screenshot mode, data capture toggles, multi-tab recording toggle
- Connectors hub — Azure DevOps, Jira, Trello, Monday setup guides

### Backend
- JWT auth via Supabase on every route
- Screenshots + replays in private Supabase Storage (signed URLs)
- Azure DevOps PAT encrypted at rest (AES-256-GCM)
- `GET/PATCH /api/workspaces/settings` — workspace-level extension config
- Configurable CORS via `CORS_ORIGINS` env var

## Environment variables

### Backend (`backend/.env`)

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
ENCRYPTION_SECRET=          # 32-char random string for PAT encryption
PORT=4000
CORS_ORIGINS=http://localhost:3000
PLATFORM_URL=http://localhost:3000
```

### Platform (`platform/.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Repo structure

```
project-3/
├── extension/          # Chrome MV3 extension
│   ├── manifest.json
│   ├── background.js   # service worker: screenshots, submit, recording, token refresh
│   ├── content.js      # injected: hover highlight, bug capture modal
│   ├── sidepanel.html/js   # main UI: auth, recording controls, buffer list
│   ├── replay-recorder.js  # rrweb recording shim (injected per-tab)
│   └── annotate.js     # annotation canvas overlay
├── platform/           # Next.js web app
│   ├── app/(dashboard)/
│   │   ├── projects/   # project + issue list + issue detail
│   │   ├── extension/  # extension settings page
│   │   └── connectors/ # Azure/Jira/Trello/Monday setup guides
│   └── components/ReplayPlayer.tsx
├── backend/src/
│   ├── issues/         # POST /issues (screenshot + replay upload)
│   ├── projects/       # CRUD /projects
│   ├── workspaces/     # /workspaces/settings (GET + PATCH, JSONB)
│   └── integrations/   # Azure DevOps PAT encrypt/decrypt
├── PRODUCT.md          # Full product overview
└── CLAUDE.md           # Technical context for Claude Code sessions
```
