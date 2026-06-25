# Team Members & Bug Assignment — Design Spec
Date: 2026-06-25

## Overview

Lightweight contact book for workspace-level team members. Members are created globally and linked to specific projects. In the Chrome extension, a per-bug assignee dropdown is shown (sticky across bugs in a session). Assignee email is sent to Azure DevOps as `System.AssignedTo`.

No login/auth for team members — this is purely an assignment reference system.

---

## Data Model

### `workspace_members`
```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
name          text NOT NULL
email         text NOT NULL
created_at    timestamptz DEFAULT now()

UNIQUE (workspace_id, email)
UNIQUE (workspace_id, name)
```

### `project_members` (join table)
```sql
project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
member_id    uuid NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE
created_at   timestamptz DEFAULT now()

PRIMARY KEY (project_id, member_id)
```

**Notes:**
- Both name and email are unique per workspace — no duplicate members
- Deleting a workspace member cascades and removes all project links
- Removing from a project only touches `project_members`, not `workspace_members`

---

## Conflict Resolution

When adding a member (from either global Team page or project page):

| Scenario | Behavior |
|---|---|
| Email exists, same name | Silent — just link to project |
| Email exists, different name | Warn: "This email belongs to **[existing name]**. Link them instead?" → user confirms |
| Name exists, different email | Warn: "**[name]** already exists with email **[existing email]**. Link them instead?" → user confirms |
| Both name + email free | Create in `workspace_members` + link to project |

Backend returns specific error codes (`EMAIL_CONFLICT`, `NAME_CONFLICT`) so frontend renders the right message.

---

## Backend API

### Workspace Members — `/api/workspaces/members`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List all members in owner's workspace |
| POST | `/` | Create member `{ name, email }` |
| PATCH | `/:id` | Update name/email |
| DELETE | `/:id` | Delete + cascade unlink from all projects |

### Project Members — `/api/projects/:id/members`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List members linked to this project |
| POST | `/` | Upsert-by-email/name + link to project `{ name, email }` |
| DELETE | `/:memberId` | Unlink from project only (workspace record preserved) |

### Upsert Logic (`POST /projects/:id/members`)
1. Check `workspace_members` for email match → if found + different name → return `EMAIL_CONFLICT`
2. Check `workspace_members` for name match → if found + different email → return `NAME_CONFLICT`
3. If exact match (same name + email) → skip insert, go to step 5
4. If no match → insert into `workspace_members`
5. Insert into `project_members` (ON CONFLICT DO NOTHING)

---

## Platform UI

### Sidebar
```
Dashboard
Projects     (existing)
Team         (new)
Connectors   (existing)
Settings     (existing)
```

### Global Team Page (`/team`)
- Table columns: Name, Email, Projects (count of linked projects), Actions
- "Add Member" → modal with name + email fields + conflict warnings inline
- Edit → modal (name + email editable)
- Delete → confirm dialog: "This will unlink them from all N projects"

### Project Page — Members Tab
- List of linked members with "Remove" button (unlinks only)
- "Add Member" → modal with name + email
  - On conflict → show specific warning + "Link them" confirm button
  - Edit not available here — redirect to Team page for edits
- Empty state: "No members linked. Add members to enable assignment in the extension."

---

## Chrome Extension

### Project Selection Flow
When user selects a project in the sidepanel:
1. Fire `GET_PROJECT_MEMBERS` → background → `GET /api/projects/:id/members`
2. Store member list in session memory (not `chrome.storage`)
3. Prepend owner's own email as `"Me (default)"`

### Bug Submit Modal — Assignee Field
- Dropdown rendered below severity selector
- Options: `["Me (default)", ...project members by name]`
- If no members linked → show only "Me (default)", no dropdown rendered
- Default on first bug: "Me (default)"
- Sticky: last selected assignee remembered in memory for duration of session
- User can change per individual bug

### Issue Payload
```js
metadata: {
  // ...existing fields
  assignee: "email@example.com"  // selected member email, or owner email if "Me"
}
```

---

## Azure DevOps Sync

### New Azure Fields (user-mappable)
```ts
{ field: 'System.AssignedTo',              label: 'Assigned To' }
{ field: 'Microsoft.VSTS.Common.Priority', label: 'Priority' }
{ field: 'Microsoft.VSTS.Common.Severity', label: 'Severity' }
{ field: 'System.Tags',                    label: 'Tags' }
{ field: 'System.IterationPath',           label: 'Sprint / Iteration' }
```

### New QA Source Fields
```ts
{ key: 'assignee',  label: 'Assignee (team member email)' }
{ key: 'priority',  label: 'Priority' }
{ key: 'severity',  label: 'Severity' }
{ key: 'labels',    label: 'Labels (as tags)' }
{ key: 'sprint',    label: 'Sprint' }
```

### Value Resolution
| Source | Azure value |
|---|---|
| `assignee` | raw email string |
| `priority` | `Critical→1, High→2, Medium→3, Low→4` |
| `severity` | `"1 - Critical"`, `"2 - High"`, `"3 - Medium"`, `"4 - Low"` |
| `labels` | `array.join('; ')` |
| `sprint` | raw string (user enters full iteration path) |

### Default Field Mapping Update
```ts
const DEFAULT_FIELD_MAPPING = {
  'System.Title': 'description',
  'Microsoft.VSTS.TCM.ReproSteps': 'repro_steps',
  'System.Description': 'system_info',
  'System.AssignedTo': 'assignee',   // ← new default
}
```

---

## Out of Scope
- Team member login / platform access
- Role-based permissions
- Member avatars / profile photos
- Notification emails to assignees
- Bulk import of members
