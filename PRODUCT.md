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

### Web Platform (Next.js)
- **Auth** — Supabase email/password, ES256 JWT, token stored in `sessionStorage`
- **Projects** — list, create, view issues per project
- **Issues** — per-project issue list with detail view (screenshots via signed URLs)
- **Connectors hub** — step-by-step setup guides for Azure DevOps, Jira, Trello, Monday
- **Extension settings page** — screenshot mode selector with SVG previews, data capture toggles, connection status badge, download + install guide
- **Sticky sidebar** — persistent navigation

### Backend (NestJS)
- **Auth** — all routes validated via `supabase.auth.getUser(token)`
- **Projects** CRUD — scoped to workspace owner
- **Issues** — create with screenshot upload to Supabase Storage (private bucket, signed URLs)
- **Workspaces** — auto-created on first login; `settings` JSONB column for extension config
- **GET/PATCH /workspaces/settings** — extension pulls/pushes screenshot mode + toggles
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
| High | Side panel implementation — fully wired (built, pending test in Chrome) |
| High | Token refresh — store refresh_token, silent re-auth on expiry |
| Medium | Supabase migration: `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb` |
| Medium | Video/screen recording of bug reproduction |
| Medium | Annotation tools (draw on screenshot) |
| Low | Side-by-side diff view (expected vs actual screenshot) |
| Low | Slack / email notifications on issue submit |
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
