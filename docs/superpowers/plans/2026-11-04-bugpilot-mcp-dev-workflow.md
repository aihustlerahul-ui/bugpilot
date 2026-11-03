# BugPilot MCP — Developer Fix Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A developer's Cursor (or any MCP client) can list a project's bugs, read one with full context, comment on it, reassign it to the reporting tester and move it to `Resolved`, authenticated by a personal API key.

**Architecture:** Add hashed personal API keys and a guard path for them in the NestJS backend, scoped by an `X-Workspace-Id` header and the existing `AccessService` project-membership checks. Add comments and assignee endpoints. Extend the existing stdio MCP package (`packages/mcp-server`) with the new tools. Add a dashboard page for creating keys and comments on the issue page.

**Tech Stack:** NestJS 10 + Supabase (service-role client) + Jest; Next.js 14 dashboard; Node >=20 ESM MCP server on `@modelcontextprotocol/sdk` tested with `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-04-bugpilot-mcp-dev-workflow-design.md`

**Deviations from the spec (found while planning, flag to the user):**
- Spec §2 said "new access helper". `AccessService` (`backend/src/access/access.service.ts`) already does project-scoped owner/member access matched by email and `IssuesService.findOne/findByProject/create` already use it. This plan extends it (workspace narrowing) instead of adding a helper.
- Spec said to store `user_id` on `workspace_members` on first match. Dropped: the existing email match plus the new "email must be confirmed" check for key users gives the same protection with no schema change.

## Global Constraints

- API key format `bp_live_<random>`; shown once at creation; only a SHA-256 hash is stored; compared in constant time; never logged.
- Key requests must send `X-Workspace-Id`; missing → 400; not owner/member of that workspace → 403.
- Key users must have a confirmed email, else 401.
- Keys are accepted only on routes marked `@ApiKeyAllowed()`; they cannot create keys or reach integrations, workspace settings or key management (403).
- Status values: `Incoming`, `In Triage`, `Confirmed`, `In Dev`, `Resolved`, `Closed`. Project owners may set any value. Non-owner project members may set only `Resolved` (ruling: `main` made triage owner-only; the spec requires developers to resolve bugs).
- Members act only on projects they belong to via `project_members`; the workspace owner has all projects. Existing JWT/dashboard/extension behavior must not change.
- Migrations are idempotent SQL files in `backend/migrations/`, run manually in the Supabase SQL editor.
- MCP env: `BUGPILOT_API_URL` (default `http://localhost:4000`), `BUGPILOT_API_KEY`, `BUGPILOT_WORKSPACE_ID`, optional `BUGPILOT_PROJECT_ID`; legacy `BUGPILOT_ACCESS_TOKEN` keeps working as a fallback.
- Node >=20, ESM JavaScript for the MCP package. MCP tokens are redacted in errors via existing `redactToken`.
- Do not touch unrelated uncommitted changes in the working tree; stage only the files named in each task.

## Review Focus

1. Revoked key used again → 401 on the very next request.
2. Key with no `X-Workspace-Id`, or a workspace the account isn't in → 400 / 403 (never data).
3. Member of project A reads or updates an issue in project B of the same workspace → 404.
4. Issue with huge console/network logs or an oversize screenshot → MCP returns truncated output with a note and does not crash.
5. `assign_issue` to the reporter when the reporter has no `workspace_members` row → clear error listing assignable members.
6. Empty or overlong comment body → 400.

Each line has its pinning test in the task named in brackets: 1 → Task 2, 2 → Task 2, 3 → Task 3, 4 → Task 8, 5 → Task 5, 6 → Task 4.

---

### Task 1: API key storage and management endpoints

**Files:**
- Create: `backend/migrations/20261104_api_keys.sql`, `backend/src/api-keys/api-keys.module.ts`, `api-keys.service.ts`, `api-keys.controller.ts`, `api-keys.service.spec.ts`, `dto/create-api-key.dto.ts`
- Modify: `backend/src/app.module.ts` (import `ApiKeysModule`)

**Interfaces:**
- Produces (`ApiKeysService`):
  - `create(userId: string, name: string): Promise<{ id: string; name: string; keyPrefix: string; key: string }>` (`key` is the only time plaintext exists)
  - `list(userId: string): Promise<Array<{ id; name; keyPrefix; lastUsedAt; revokedAt; createdAt }>>`
  - `revoke(userId: string, id: string): Promise<{ ok: true }>`
  - `verify(rawKey: string): Promise<{ userId: string; keyId: string } | null>` (null if unknown or revoked; updates `last_used_at`)
- Module is `@Global()` and exports `ApiKeysService`.
- Endpoints (JWT only, no `@ApiKeyAllowed`): `POST /api-keys` `{name}`, `GET /api-keys`, `POST /api-keys/:id/revoke`.

- [ ] **Step 1: Write failing tests in `api-keys.service.spec.ts`** (in-memory supabase fake like `issues.access.spec.ts`): `create returns a bp_live_ key and stores only its sha256 hash`, `verify returns userId for a valid key`, `verify returns null for an unknown key`, `verify returns null after revoke`, `list never exposes key or hash`, `revoke only affects keys owned by the caller`.
- [ ] **Step 2: Run** `cd backend && npx jest src/api-keys` — Expected: FAIL (module missing).
- [ ] **Step 3: Write `20261104_api_keys.sql`**: table `api_keys(id uuid pk default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name text not null, key_hash text not null unique, key_prefix text not null, last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz default now())`, index on `user_id`, RLS enabled with no policies (service role only). Idempotent (`IF NOT EXISTS`).
- [ ] **Step 4: Implement service/controller/module/DTO** (`name`: string, 1–60 chars). Key = `bp_live_` + `crypto.randomBytes(32).toString('base64url')`; `key_prefix` = first 12 chars; hash with `crypto.createHash('sha256')`; look up by hash (unique index) and confirm with `crypto.timingSafeEqual`.
- [ ] **Step 5: Run** `npx jest src/api-keys` — Expected: PASS.
- [ ] **Step 6: Commit** `git add backend/migrations/20261104_api_keys.sql backend/src/api-keys backend/src/app.module.ts && git commit -m "feat(backend): personal API keys"`

### Task 2: Guard accepts API keys, workspace-scoped

**Files:**
- Create: `backend/src/common/decorators/api-key-allowed.decorator.ts`, `backend/src/common/guards/supabase-auth.guard.spec.ts`
- Modify: `backend/src/common/guards/supabase-auth.guard.ts`, `backend/src/common/interfaces/auth-user.interface.ts`, `backend/src/access/access.service.ts`, `backend/src/access/access.service.spec.ts`

**Interfaces:**
- Consumes: `ApiKeysService.verify` (Task 1). `AuthUser.emailVerified?: boolean` already exists on `main` and the JWT path already sets it; the key path must set it from `email_confirmed_at` too.
- Produces:
  - `export const ApiKeyAllowed = () => SetMetadata('apiKeyAllowed', true)`
  - `AuthUser` gains `workspaceId?: string` and `authMethod?: 'jwt' | 'api_key'` (keep the existing `emailVerified`).
  - `AccessService.assertWorkspaceAccess(user: AuthUser, workspaceId: string): Promise<void>` (owner of that workspace OR email in its `workspace_members`; else `ForbiddenException`).
  - When `user.workspaceId` is set, `listAccessibleProjects` and `getProjectRole` only consider projects whose `workspace_id` equals it (others → empty / `null`).

- [ ] **Step 1: Write failing guard tests** (mock `ApiKeysService`, `AccessService`, `SupabaseService`, `Reflector`): `bearer bp_ key resolves user and sets authMethod api_key`; `revoked key → 401` (Review Focus 1); `key without X-Workspace-Id → 400` (RF 2); `key for workspace the user is not in → 403` (RF 2); `unconfirmed email → 401`; `key on route without @ApiKeyAllowed → 403`; `normal Supabase JWT path unchanged`.
- [ ] **Step 2: Write failing access tests**: `listAccessibleProjects with workspaceId excludes other workspaces`; `getProjectRole returns null for a project outside user.workspaceId`; `assertWorkspaceAccess allows owner and email-matched member, rejects others`.
- [ ] **Step 3: Run** `npx jest src/common src/access` — Expected: FAIL.
- [ ] **Step 4: Implement.** In the guard: token starting `bp_` → `verify`; load the account with `supabase.db.auth.admin.getUserById` (require `email_confirmed_at`); require `ApiKeyAllowed` via `Reflector.getAllAndOverride`; read `x-workspace-id`; call `assertWorkspaceAccess`; set `request.user = {id, email, workspaceId, authMethod: 'api_key'}`. Other tokens follow the existing path. `ApiKeysService` is resolvable because Task 1's module is global.
- [ ] **Step 5: Run** `npx jest src/common src/access` — Expected: PASS.
- [ ] **Step 6: Commit** the touched files: `feat(backend): API key auth with workspace scoping`

### Task 3: Allow keys on read routes; protect `updateStatus`

**Files:**
- Modify: `backend/src/issues/issues.controller.ts`, `issues.service.ts`, `backend/src/projects/projects.controller.ts`, `backend/src/issues/issues.access.spec.ts`

**Interfaces:**
- Consumes: `ApiKeyAllowed` (Task 2).
- Produces: `IssuesService.updateStatus(user: AuthUser, issueId: string, status: string)` already takes `AuthUser` and is owner-only on `main`. Change it: role `null` → `NotFoundException('Issue not found')`; role `owner` → any status; role `member` → only `Resolved`, otherwise `ForbiddenException`. Update the comment above it and any existing test that asserts members cannot change status.
- `@ApiKeyAllowed()` on exactly: `GET issues/project/:projectId`, `GET issues/:id`, `PATCH issues/:id/status`, `GET projects`, `GET projects/:id`. Do NOT mark `GET workspaces/members` (it resolves the workspace via `findByOwner` and ignores `user.workspaceId`; assignable members come from Task 5's project-scoped route). Before marking any route, confirm its service path authorizes through `AccessService`; a route that doesn't must not get the decorator — report it instead.

- [ ] **Step 1: Write failing tests in `issues.access.spec.ts`**: `member of project A cannot read or update status of an issue in project B` (RF 3); `member can set Resolved on its project's issue`; `member setting In Dev or Closed gets Forbidden`; `owner can set any status`; `stranger gets Issue not found on updateStatus`.
- [ ] **Step 2: Run** `npx jest src/issues/issues.access` — Expected: FAIL.
- [ ] **Step 3: Implement.** Add the decorators and change the role rule; other callers (`grep -rn "updateStatus(" backend/src`) must keep compiling.
- [ ] **Step 4: Run** `npx jest` — Expected: full backend suite PASS.
- [ ] **Step 5: Commit** `feat(backend): project-scoped status updates; allow API keys on read routes`

### Task 4: Issue comments

**Files:**
- Create: `backend/migrations/20261104_issue_comments.sql`, `backend/src/issues/comments.service.ts`, `comments.service.spec.ts`, `dto/create-comment.dto.ts`
- Modify: `backend/src/issues/issues.controller.ts`, `issues.module.ts`

**Interfaces:**
- Consumes: `AccessService.getProjectRole`.
- Produces (`CommentsService`): `list(user: AuthUser, issueId: string): Promise<IssueComment[]>` (oldest first), `add(user: AuthUser, issueId: string, body: string, source: 'web' | 'mcp'): Promise<IssueComment>`; `IssueComment = { id; issue_id; author_user_id; author_name; body; source; created_at }`.
- Endpoints (both `@ApiKeyAllowed()`): `GET issues/:id/comments`, `POST issues/:id/comments` body `{body: string}` (1–5000 chars). `source` is `'mcp'` when `user.authMethod === 'api_key'` else `'web'`. `author_name` = account email local part when no better name exists.

- [ ] **Step 1: Write failing tests**: `add stores comment with author and source`, `list returns oldest first`, `non-member gets NotFound`, `empty body rejected`, `body over 5000 chars rejected` (RF 6, DTO validation via `ValidationPipe`).
- [ ] **Step 2: Run** `npx jest src/issues/comments` — Expected: FAIL.
- [ ] **Step 3: Write migration**: `issue_comments(id uuid pk, issue_id uuid references issues(id) on delete cascade, author_user_id uuid, author_name text not null, body text not null, source text not null default 'web' check (source in ('web','mcp')), created_at timestamptz default now())`, index `(issue_id, created_at)`, RLS enabled, no policies.
- [ ] **Step 4: Implement service, DTO (`@IsString @MinLength(1) @MaxLength(5000)`), controller routes, module provider.**
- [ ] **Step 5: Run** `npx jest src/issues` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(backend): issue comments`

### Task 5: Assignment, reporter info, assignable members

**Files:**
- Create: `backend/migrations/20261104_issue_assignee_member.sql`, `backend/src/issues/assignment.spec.ts`, `dto/assign-issue.dto.ts`
- Modify: `backend/src/issues/issues.service.ts`, `issues.controller.ts`

**Interfaces:**
- Produces:
  - `IssuesService.assign(user: AuthUser, issueId: string, memberId: string | null): Promise<Issue>` — member must belong to the issue's project workspace (else `BadRequestException` whose message lists assignable names); sets `assignee_member_id` and `metadata.assignee` to the member's name (null clears both).
  - `IssuesService.listAssignableMembers(user: AuthUser, projectId: string): Promise<Array<{ id; name; email }>>` — all `workspace_members` of the project's workspace.
  - `GET issues/:id` now also returns `reporter: { userId; email: string | null; name: string | null; memberId: string | null }` (email via `supabase.db.auth.admin.getUserById`; `memberId` by case-insensitive email match in the workspace's `workspace_members`).
- Endpoints (`@ApiKeyAllowed()`): `PATCH issues/:id/assignee` body `{memberId: string | null}`, `GET issues/project/:projectId/members`.
- Migration: `ALTER TABLE issues ADD COLUMN IF NOT EXISTS assignee_member_id uuid REFERENCES workspace_members(id) ON DELETE SET NULL`.

- [ ] **Step 1: Write failing tests**: `assign sets assignee_member_id and mirrors name into metadata.assignee`, `assign null clears both`, `assign rejects a member from another workspace`, `reporter.memberId resolves by email case-insensitively`, `reporter.memberId is null with no workspace_members row, and assign error lists assignable members` (RF 5), `listAssignableMembers requires project access`.
- [ ] **Step 2: Run** `npx jest src/issues/assignment` — Expected: FAIL.
- [ ] **Step 3: Write migration, implement service methods, DTO (`@IsOptional @IsUUID`, null allowed), controller routes, extend `findOne` with `reporter`.**
- [ ] **Step 4: Run** `npx jest` — Expected: PASS (whole backend suite, existing `findOne` tests updated for the new field if they assert exact shape).
- [ ] **Step 5: Commit** `feat(backend): issue assignment and reporter info`

### Task 6: Dashboard "Connect your AI tool" page

**Files:**
- Create: `platform/app/(dashboard)/ai-tools/page.tsx`
- Modify: `platform/app/(dashboard)/layout.tsx` (nav link), `platform/lib/types.ts` (`ApiKeyRow`)

**Interfaces:**
- Consumes: `POST /api-keys`, `GET /api-keys`, `POST /api-keys/:id/revoke` (Task 1) via `platform/lib/api/client.ts`.
- Page: create key by name; plaintext shown once with copy button; list rows (name, prefix, last used, revoked) with Revoke; read-only `mcp.json` snippet with `command: "node"`, args path placeholder, env `BUGPILOT_API_URL`, `BUGPILOT_API_KEY` (placeholder), `BUGPILOT_WORKSPACE_ID` (the current workspace id from the existing workspace context/switcher). Follow existing page styling (Tailwind, `Icons.tsx`).

- [ ] **Step 1: Implement page and nav entry.**
- [ ] **Step 2: Verify** with the platform preview (`platform` launch config): create a key, confirm plaintext appears once and not after reload, revoke it, check no console errors. Expected: works; screenshot for the user.
- [ ] **Step 3: Commit** `feat(platform): API key management page`

### Task 7: Comments in the dashboard issue detail

**Files:**
- Modify: `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`, `platform/lib/types.ts`

**Interfaces:**
- Consumes: `GET/POST issues/:id/comments` (Task 4). Show comments with author, time and an "AI" badge when `source === 'mcp'`; add-comment textarea with submit.

- [ ] **Step 1: Implement** the comments section on the issue detail page.
- [ ] **Step 2: Verify** in the platform preview: post a comment, see it listed, reload to confirm persistence. Expected: PASS; screenshot.
- [ ] **Step 3: Commit** `feat(platform): show and post issue comments`

### Task 8: MCP server — client, config and read tools

**Files:**
- Create: `packages/mcp-server/src/tools/read.js`, `packages/mcp-server/test/read.test.js`, `packages/mcp-server/test/client.test.js`
- Modify: `packages/mcp-server/src/client.js`, `src/index.js`, `package.json` (`"test": "node --test"`)

**Interfaces:**
- `getConfig(): { apiUrl; credential; workspaceId?; defaultProjectId? }` — prefers `BUGPILOT_API_KEY` (then requires `BUGPILOT_WORKSPACE_ID`), falls back to `BUGPILOT_ACCESS_TOKEN`.
- `apiRequest(method: 'GET' | 'POST' | 'PATCH', path: string, opts?: { query?: Record<string,string>; body?: unknown }): Promise<any>` — adds `Authorization: Bearer` and `X-Workspace-Id`; errors pass through `redactToken`. `apiGet` stays as a wrapper.
- `read.js` exports `tools` (definitions) and `handlers`:
  - `list_issues({ projectId?, status?, assigneeMemberId?, severity?, limit? })` → compact rows `{id,title,status,severity,assignee,reporter?,route,createdAt}`, default limit 50.
  - `get_issue({ issueId })` → issue JSON plus `comments` (from the comments endpoint); `console`/`network` arrays truncated to the first 50 entries and each string field to 2000 chars with a `truncated: true` note; screenshot(s) returned as MCP `image` content when ≤ 1.5 MB, else just the signed URL.
  - `list_members({ projectId? })` → `GET issues/project/:id/members`.
  - `list_projects`, `get_project` unchanged.

- [ ] **Step 1: Write failing tests** with a stubbed `globalThis.fetch`: `api key sends Authorization and X-Workspace-Id headers`, `falls back to BUGPILOT_ACCESS_TOKEN without workspace header`, `missing workspace id with API key throws a clear error`, `list_issues filters by status and assignee and applies limit`, `get_issue merges comments`, `get_issue truncates 500 console entries and flags truncated` (RF 4), `oversize screenshot falls back to URL` (RF 4), `errors never contain the key` (RF).
- [ ] **Step 2: Run** `cd packages/mcp-server && npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** client changes, `read.js`, wire `index.js` to merge tool lists/handlers.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcp): API key auth, filtered list and full-context get_issue`

### Task 9: MCP server — write tools

**Files:**
- Create: `packages/mcp-server/src/tools/write.js`, `packages/mcp-server/test/write.test.js`
- Modify: `packages/mcp-server/src/index.js`

**Interfaces:**
- Consumes: `apiRequest` (Task 8).
- `write.js` tools; each result states exactly what changed (e.g. `{ ok: true, issueId, status: 'Resolved' }`):
  - `add_comment({ issueId, body })` → `POST issues/:id/comments`
  - `update_issue_status({ issueId, status })` — `status` enum is the six values; invalid → error before any request
  - `assign_issue({ issueId, memberId | null })` → `PATCH issues/:id/assignee`
  - `assign_to_reporter({ issueId })` — convenience: reads the issue's `reporter.memberId`, errors with the assignable-member list when null, else assigns.
- Tool descriptions state the intended finish sequence (comment → assign to reporter → status `Resolved`) and that the tool must only run when the developer asked.

- [ ] **Step 1: Write failing tests**: `add_comment posts body and reports comment id`, `update_issue_status rejects values outside the enum without calling the API`, `assign_issue sends memberId null to clear`, `assign_to_reporter errors with member list when reporter has no member row` (RF 5), `assign_to_reporter assigns reporter.memberId`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** `write.js` and register in `index.js`; update the startup log and header comment (no longer read-only).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcp): comment, status and assignment tools`

### Task 10: Live verification and docs

**Files:**
- Modify: `docs/mobile-qa/MCP_SERVER.md`, `packages/mcp-server/README.md`, `CLAUDE.md` (security rules: keys hashed, header required, allowlist; "Key Files" row)

- [ ] **Step 1: Apply the three migrations** in the Supabase SQL editor (user action; report to the user and wait).
- [ ] **Step 2: Start the backend** (`cd backend && npm run start:dev`), create a key through the dashboard page, run `BUGPILOT_API_KEY=… BUGPILOT_WORKSPACE_ID=… npm run smoke` after updating `smoke-check.js` to use `apiRequest` and also call `list_members`. Expected: `OK projects=N`.
- [ ] **Step 3: End-to-end through Cursor:** with the `mcp.json` snippet, ask Cursor to list bugs, read one, comment, assign to the reporter and resolve it; confirm in the dashboard that the comment shows with the AI badge, assignee and status changed. Then revoke the key and confirm the next MCP call fails with 401.
- [ ] **Step 4: Update the three docs** to match what shipped (tool list, env vars, auth, verification checklist ticked only for what was actually verified).
- [ ] **Step 5: Commit** `docs: BugPilot MCP developer workflow`
