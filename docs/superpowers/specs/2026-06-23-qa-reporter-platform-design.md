# QA Reporter Platform — Design Spec
**Date:** 2026-06-23  
**Status:** Approved  

---

## Overview

Transform the existing QA Reporter Chrome Extension from a JSON-export tool into a full SaaS platform. The extension becomes a data collection layer; the web platform becomes the source of truth for bug reports, with ticket synchronization to external tools (Azure DevOps first, others later).

Build order is deliberately simple: auth → issue capture → dashboard → Azure sync. No workspace invites, analytics, or multi-integration support in this phase.

---

## Scope

**In scope:**
- Supabase project setup (auth, database, storage)
- Next.js web app (signup, login, project list, issue list, issue detail)
- API endpoint to receive issues from the extension
- Extension auth layer (email/password login in popup, JWT in chrome.storage)
- Extension wired to POST issues to platform instead of exporting JSON
- Azure DevOps sync via PAT (paste PAT in dashboard → "Sync to Azure" button per issue)

**Out of scope (next phases):**
- Workspace invites / multi-user management
- Jira, Monday, Trello, ClickUp integrations
- Analytics and bug trend dashboards
- React metadata (`data-feature`, `data-component`) capture
- Console error / network log capture
- Tiered pricing / feature flags

---

## Architecture

```
Chrome Extension
    │
    │  POST /issues (JWT auth)
    ▼
Supabase Edge Function or Next.js API Route
    │
    ├── stores issue → Postgres (issues table)
    └── stores screenshot → Supabase Storage
    
Next.js Web App (Vercel)
    │
    ├── reads issues from Supabase (TanStack Query)
    └── on "Sync to Azure" → calls Azure DevOps REST API with PAT

Supabase
    ├── Auth (email/password, JWT)
    ├── Postgres (workspaces, projects, issues)
    └── Storage (screenshots)
```

The platform is always the source of truth. Azure DevOps is a sync target, not the primary store.

---

## Database Schema

### `workspaces`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. "Acme Corp" |
| owner_id | uuid FK → auth.users | |
| created_at | timestamptz | |

### `projects`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK → workspaces | |
| name | text | e.g. "Web Dashboard" |
| sync_mode | enum('auto', 'manual') | default: manual |
| created_at | timestamptz | |

### `issues`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| project_id | uuid FK → projects | |
| reporter_id | uuid FK → auth.users | |
| description | text | user-written |
| url | text | page URL where bug was found |
| route | text | path portion of URL |
| browser_info | jsonb | name, version, OS |
| element_info | jsonb | tag, selector, text, attributes |
| screenshot_url | text | Supabase Storage URL |
| element_screenshot_url | text | Supabase Storage URL |
| sync_status | enum('pending', 'synced', 'failed') | default: pending |
| external_ticket_id | text | ADO work item ID |
| external_ticket_url | text | link back to ADO ticket |
| created_at | timestamptz | |

### `integrations`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK → workspaces | |
| provider | enum('azure_devops', 'jira', 'monday') | |
| pat_encrypted | text | AES-256 encrypted PAT |
| config | jsonb | org URL, project name, etc. |
| created_at | timestamptz | |

### `issue_sync_logs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| issue_id | uuid FK → issues | |
| provider | text | |
| status | enum('success', 'failed') | |
| error | text | nullable |
| synced_at | timestamptz | |

---

## Web App — Pages & Features

### Auth
- `/signup` — email + password + workspace name (creates workspace on signup)
- `/login` — email + password
- Supabase Auth handles sessions, JWT, refresh tokens

### Dashboard
- `/` → redirect to `/projects`
- `/projects` — list of projects in the user's workspace, "New Project" button
- `/projects/[id]` — issue list for that project, status badges, "Sync to Azure" button per issue
- `/projects/[id]/issues/[issueId]` — issue detail: screenshot, element screenshot, browser info, element info, description, sync status, link to external ticket

### Settings
- `/settings/integrations` — select provider (Azure DevOps for now), paste PAT + org URL + project name, "Test Connection" button, save

---

## Extension Changes

### Auth Layer
- Popup shows email/password login form when no session exists
- On submit → call Supabase Auth `signInWithPassword`
- JWT + refresh token stored in `chrome.storage.local`
- On each API call → attach JWT as `Authorization: Bearer <token>`
- Auto-refresh token on expiry using Supabase client
- Logout button clears `chrome.storage.local`

### Project Selection
- After login → popup shows workspace name + project dropdown
- Selected project stored in `chrome.storage.local`
- Bug submissions go to the selected project

### Issue Submission
- Replace current JSON export with `POST /api/issues`
- Payload: `{ project_id, description, url, route, browser_info, element_info, screenshot (base64), element_screenshot (base64) }`
- API stores screenshots to Supabase Storage, saves issue to Postgres
- Extension shows success/error feedback in popup

---

## Azure DevOps Sync

### Setup (Settings → Integrations)
- User selects "Azure DevOps"
- Inputs: PAT, Organization URL (e.g. `https://dev.azure.com/acme`), Project name
- "Test Connection" → platform calls `GET https://dev.azure.com/{org}/_apis/projects` with PAT
- On success → save integration (PAT encrypted with AES-256 before storage)

### Syncing an Issue
- "Sync to Azure" button on issue detail page
- Platform calls Azure DevOps REST API:
  - `POST https://dev.azure.com/{org}/{project}/_apis/wit/workitems/$Bug`
  - Payload: title (from description), description (URL + browser info + element info), attachments (screenshots)
- On success → update issue: `sync_status = 'synced'`, `external_ticket_id`, `external_ticket_url`
- On failure → `sync_status = 'failed'`, log error to `issue_sync_logs`
- Issue detail shows link to ADO ticket after sync

### Auto-sync (project setting)
- If `sync_mode = 'auto'`, trigger Azure sync immediately when issue is created
- Implemented as a Supabase Edge Function triggered by Postgres insert

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web frontend | Next.js 14 (App Router), Tailwind CSS, TanStack Query |
| Backend / API | Next.js API Routes + Supabase Edge Functions |
| Auth | Supabase Auth (email/password) |
| Database | Supabase Postgres |
| File storage | Supabase Storage (screenshots) |
| Extension | Chrome MV3 (existing), + Supabase JS client for auth |
| Hosting | Vercel (web app), Supabase (everything else) |

---

## Build Order

1. **Supabase setup** — create project, run schema migrations, enable auth, create storage bucket
2. **Next.js app scaffold** — auth pages (signup/login), projects list, issue list, issue detail, settings/integrations
3. **POST /api/issues endpoint** — validate JWT, store screenshots, insert issue row
4. **Extension auth** — login form in popup, JWT storage, project selector, POST to API
5. **Azure DevOps integration** — PAT setup in settings, "Sync to Azure" button, sync logic, auto-sync edge function
6. **Polish** — sync status badges, ADO ticket link, error states, loading states

---

## Security Notes

- PAT stored encrypted (AES-256) in Postgres — never returned to frontend in plaintext
- All API routes validate Supabase JWT before processing
- Supabase Row Level Security (RLS) — users can only read/write their own workspace's data
- Screenshots stored in private Supabase Storage bucket — accessed via signed URLs only
