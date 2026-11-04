# BugPilot MCP — Developer Fix Workflow (Design)

Date: 2026-11-04 · Status: draft for approval

## Intent and why

Testers log bugs in BugPilot. Developers use Cursor (or any MCP-capable AI tool) that already
has their repo as context. The developer says "list the open bugs" or "fix bug <id>". The AI
reads the bug's full context from BugPilot through an MCP server, combines it with what it
knows about the repo, and fixes it. When done, the AI writes back: a comment explaining the
fix, the bug reassigned to the tester, and status moved to `Resolved`.

Goal: close the loop between "tester found it" and "developer fixed it" without the developer
copying data between tools.

## Goals

1. **Read**: list bugs (filterable) and get one bug with all its data: title, description,
   status, severity, assignee, reporter, route/url, browser info, element info, expected/actual
   result, steps, console errors, network errors/transactions, screenshots, replay/video links,
   external ticket id, comments.
2. **Write back**: add a comment, change status, reassign to a workspace member.
3. **Auth as the developer**: a personal API key tied to the developer's own BugPilot account;
   the MCP only sees what that account may see.
4. **Workspace scoping**: the developer supplies a workspace ID in the MCP config; the backend
   verifies the key's account is a member of that workspace.
5. Works in Cursor and any other MCP client (stdio server).

## Non-goals (v1)

- Browser-based sign-in / OAuth flow (possible later).
- Creating or deleting bugs, uploading media, editing bug content, deleting comments.
- Making the AI auto-pick bugs or auto-resolve without a developer prompting it.
- Hosted/remote MCP server; v1 is a local stdio process.

## Anti-goals (a failure even if it "works")

- An API key or JWT ending up in logs, tool output, git, or the DB in plaintext.
- A developer seeing data from a workspace they aren't a member of.
- Breaking existing owner/dashboard/extension behavior.
- Write tools silently changing things the developer did not ask for (every write tool result
  states exactly what changed).

## Current state (verified in the repo)

- `packages/mcp-server` (untracked, unverified live): read-only, tools `list_projects`,
  `get_project`, `list_issues`, `get_issue`; auth via `BUGPILOT_ACCESS_TOKEN` (Supabase JWT,
  expires ~1h). See `docs/mobile-qa/MCP_SERVER.md`. Plain JS, `@modelcontextprotocol/sdk`.
- Backend access model is **owner-only**: projects/workspaces resolve via
  `WorkspacesService.findByOwner(userId)`. `IssuesService.findOne` filters
  `reporter_id = userId`, so a non-reporter developer gets 404. `findByProject` has no user
  check. `updateStatus` has no ownership check. `SupabaseAuthGuard` validates only Supabase JWTs.
- `workspace_members` (name, email, per workspace) and `project_members` exist but are not
  linked to auth accounts.
- Assignee is free text in `issues.metadata.assignee`. No comments table or endpoint.
- Status values: Incoming, In Triage, Confirmed, In Dev, Resolved, Closed
  (`backend/src/issues/dto/update-status.dto.ts`).

## Decisions made with the user

- Developers have their own BugPilot accounts; MCP acts as that account.
- Auth v1 = personal API key created in the dashboard, pasted once into the MCP config.
- Developer provides the workspace ID in the MCP config to scope requests.
- Write-back: comment, reassign to tester, move to resolved.

## Design (calls made by the author, open to override)

### 1. Auth: personal API keys
- New table `api_keys`: `id`, `user_id`, `name`, `key_hash` (SHA-256), `key_prefix` (first
  chars for display), `last_used_at`, `revoked_at`, `created_at`.
- Key format `bp_live_<random>`; shown once at creation; only hash stored.
- Dashboard page ("Connect your AI tool") to create, list, revoke keys, and copy a ready-made
  Cursor `mcp.json` snippet including the workspace ID.
- Backend guard: extend `SupabaseAuthGuard` (or add a combined guard) so a Bearer token that
  starts with `bp_` is resolved via hash lookup to `request.user = {id, email}`; other tokens
  go through existing Supabase JWT validation. Existing routes unchanged for JWT users.
- MCP sends `Authorization: Bearer <key>` and header `X-Workspace-Id: <id>`.

### 2. Access: workspace membership
- A new helper resolves the "active workspace" for a request: if `X-Workspace-Id` is present,
  require the user to be that workspace's owner OR a `workspace_members` row whose email
  matches the account email (case-insensitive); otherwise 403. Without the header, behavior is
  today's owner lookup.
- Used by issue and project reads/writes the MCP needs. Within a workspace, a member can read and write (comment, reassign, change status) only on
  projects they belong to via `project_members` (confirmed by user). The workspace owner keeps
  access to all projects. `list_projects`, `list_issues` and every issue route filter by this.
- Fix inconsistencies: `findOne` no longer requires `reporter_id = userId`; `findByProject`
  and `updateStatus` verify the project/issue belongs to the active workspace.

### 3. Comments (new)
- Table `issue_comments`: `id`, `issue_id`, `author_user_id`, `author_name`, `body`, `source`
  (`web` | `mcp`), `created_at`.
- Endpoints: `GET /issues/:id/comments`, `POST /issues/:id/comments`.
- Comments returned as part of get-issue output; shown in the dashboard issue detail page.

### 4. Assignment (new)
- `PATCH /issues/:id/assignee` body `{ memberId | null }`; must be a member of the workspace.
- Stores `assignee_member_id` (new column on `issues`) and keeps `metadata.assignee` name in
  sync for existing UI. Reporter is exposed so the AI can reassign "back to the tester".
- A way to learn who the reporter/tester is: issue output includes reporter name/email and the
  matching workspace member id when one exists.

### 5. MCP tools (package `packages/mcp-server`)
Keep existing four (rename not required). Add/extend:
- `list_issues` filters: `status`, `assigneeMemberId`, `severity`, `limit`; compact rows.
- `get_issue`: full context; screenshots returned as MCP image content where feasible;
  large logs truncated with a note and a way to request more.
- `list_members`: workspace members (for assignment).
- `add_comment` (`issueId`, `body`).
- `update_issue_status` (`issueId`, `status` from the enum).
- `assign_issue` (`issueId`, `memberId` | null).
- Env: `BUGPILOT_API_URL`, `BUGPILOT_API_KEY`, `BUGPILOT_WORKSPACE_ID`, optional
  `BUGPILOT_PROJECT_ID`. Old `BUGPILOT_ACCESS_TOKEN` keeps working as a fallback.
- Tool descriptions tell the model the intended finish sequence (comment → assign to reporter
  → status Resolved) but never perform it unprompted.

### 6. Security
- Keys hashed, constant-time compare, never logged; MCP redacts tokens in errors (existing
  `redactToken`).
- Revocation takes effect immediately; `last_used_at` updated.
- Per-key rate limiting is left to the builder.
- Update `CLAUDE.md` security rules and `docs/mobile-qa/MCP_SERVER.md` when done.

## Constraints
- NestJS backend, Supabase Postgres; migrations are SQL files in `backend/migrations/` run
  manually in the Supabase SQL editor.
- Stdio MCP, Node >= 20, ESM JavaScript (matches the existing package unless the builder
  prefers converting to TypeScript).
- The working tree has many unrelated uncommitted changes; do not disturb them.

## Left to the builder
- Exact response shapes/truncation limits, hashing details, rate limiting, test layout,
  dashboard page layout, whether to convert the MCP package to TypeScript.

## Open assumptions to confirm
- A developer must be added to `workspace_members` by the owner (matched by email) to get access.

## Calls made after builder review (author's calls, open to override)

- **Workspace header required for keys:** API-key requests must send `X-Workspace-Id`; without it
  the backend rejects them (400). JWT/dashboard requests keep today's owner lookup.
- **Email matching hardened:** a `workspace_members` row is linked to an account only when the
  account's email is confirmed in Supabase Auth; on first match store `user_id` on the member row
  and match by `user_id` afterwards.
- **Key route allowlist:** API keys are accepted only on the issue, project (read), member (read)
  and comment routes the MCP uses. They cannot reach integrations, key management, or workspace
  settings, and cannot create other keys.
- **Reassigning to the tester:** the reporter is resolved to a `workspace_members` row by email.
  If none exists, `assign_issue` fails with a clear error listing assignable members. No
  auto-created members, no fallback to owner.
- **Old free-text assignees:** no backfill; `metadata.assignee` stays as legacy display text.
- **Status transitions:** any value in the existing enum is allowed (no ordering rules), matching
  the dashboard today.
- **Screenshots:** `GET /issues/:id` already returns signed URLs; the MCP downloads images with a
  size cap and falls back to the URL when over the cap. No new media endpoint.
- **Existing package:** extend `packages/mcp-server` in place; re-verify against a live backend
  because the existing doc claims are untested.
- **Member management UI:** the owner adds members through the existing members endpoints; any
  missing UI is out of scope.

## Confirmed by user (2026-11-04)
- Access is per project: a developer reaches only projects they were added to as project members (user wording: "projects they have edited", read as "added to"; confirm when reviewing).
- Within those projects, members may comment, reassign and change status.
