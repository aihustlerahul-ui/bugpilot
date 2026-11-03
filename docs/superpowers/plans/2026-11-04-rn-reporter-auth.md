# RN Reporter: Sign-in, Project Access, End-to-End Submit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tester invited to a project by an admin can sign in inside the React Native app, pick a shared project, report a bug on a tapped element, and see it in the dashboard.

**Architecture:** Add a project-access layer to the Nest backend (owner OR matched `project_members` email) and a public `/api/auth` wrapper over Supabase password login and refresh. Extend `@bugpilot/react-native` with an `AuthClient`, a secure session store, a sign-in sheet and a project picker. Adjust the platform for member users and mobile-captured issues.

**Tech Stack:** NestJS 11 + Jest (backend), Supabase JS, `@nestjs/throttler`, TypeScript + Vitest (RN package pure-logic tests), React Native / Expo, Next.js (platform).

**Spec:** `docs/superpowers/specs/2026-11-04-rn-reporter-auth-design.md`

## Global Constraints

- Token validation stays `supabase.auth.getUser(token)` in `SupabaseAuthGuard`; never `jwt.verify()`.
- Members may only **list** and **read** their member projects, **create issues** in them, and read issues in them. Project update/delete, workspace settings, integrations and member management stay owner-only. Do not widen `WorkspacesService.findByOwner`.
- Member match is by email, case-insensitive, against `workspace_members.email` linked through `project_members`.
- Login/refresh are public routes, rate limited per **email + IP**, and return a generic 401 that never reveals whether the email exists.
- No Supabase service-role key or secret in the app bundle. Backend login uses `SUPABASE_ANON_KEY` (add to `backend/.env.example`).
- Passwords and tokens are never logged. Session is stored via `expo-secure-store` when the host provides it.
- The overlay stays gated to `__DEV__`/QA builds. SDK failures must never crash the host app.
- No new native dependency may be added to Tallect-Mobile without the user's approval (`expo-secure-store` is already there).
- Mobile issue data lives in existing `browser_info`, `element_info`, `route`, `metadata` fields; `metadata.captureSource === 'rn-reporter'` marks mobile issues. No DB migration unless Task 1 proves one is needed.
- Don't commit secrets; `backend/.env` and `platform/.env.local` stay gitignored.

## Review Focus

Failure modes the spec implies that no single task's happy path covers (each has a pinned test in the owning task):

1. **Unshared project access:** a member posting to or listing issues for a project they were not added to must get 404/403 (today `IssuesService.create/findByProject` check nothing). → Task 3
2. **Owner can't see member bugs:** `findOne` filters `reporter_id = userId`, hiding member-filed bugs from the admin. → Task 3
3. **Email casing/whitespace:** `Jane@Team.com` invited, signs in as `jane@team.com`. → Task 1
4. **Invite email failure:** a failing sender or an already-registered address must not fail "add to project". → Task 4
5. **Expired/rotated refresh token and concurrent refresh:** two simultaneous 401s must trigger one refresh, and a failed refresh must sign out cleanly instead of looping. → Task 6

---

### Task 1: Project access service

**Files:**
- Create: `backend/src/access/access.service.ts`, `backend/src/access/access.module.ts`, `backend/src/access/access.service.spec.ts`
- Modify: `backend/src/app.module.ts` (import `AccessModule`)

**Interfaces:**
- Produces:
  - `type ProjectRole = 'owner' | 'member'`
  - `AccessService.listAccessibleProjects(user: AuthUser): Promise<Array<Record<string, any> & { role: ProjectRole }>>` — owned-workspace projects plus member projects, newest first, no duplicates. A user with no owned workspace returns member projects only (no throw).
  - `AccessService.getProjectRole(user: AuthUser, projectId: string): Promise<ProjectRole | null>`
  - `AccessService.assertCanAccessProject(user: AuthUser, projectId: string): Promise<ProjectRole>` — throws `NotFoundException('Project not found')` when role is null.
  - `AccessModule` exports `AccessService`; mark it `@Global()` like `SupabaseModule`.

- [ ] **Step 1: Write failing tests** in `access.service.spec.ts` with a mocked `SupabaseService`/`WorkspacesService`: `getProjectRole` returns `'owner'` for a project in the user's workspace; `'member'` when a `project_members` row links a `workspace_members` row whose email equals the user's email; `null` for an unrelated project; `'member'` when invited as `Jane@Team.com` and user email is ` jane@team.com ` (case/whitespace); `listAccessibleProjects` works for a user whose `findByOwner` throws `NotFoundException`; `assertCanAccessProject` throws `NotFoundException` for `null`.
- [ ] **Step 2: Run** `cd backend && npx jest src/access` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `AccessService`** per the interface. Member lookup: select `workspace_members` ids with `ilike('email', normalizedEmail)`, then `project_members.project_id` for those ids, then the `projects` rows. Normalize with `trim().toLowerCase()`.
- [ ] **Step 4: Run** `npx jest src/access` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add project access service for owners and members`

### Task 2: Member-enabled project routes

**Files:**
- Modify: `backend/src/projects/projects.service.ts`, `backend/src/projects/projects.controller.ts`
- Test: `backend/src/projects/projects.service.spec.ts` (create)

**Interfaces:**
- Consumes: `AccessService` (Task 1).
- Produces: `ProjectsService.findAll(user: AuthUser)` and `ProjectsService.findOne(user: AuthUser, projectId: string)` now member-aware (return the project including `role`); `create`, `update`, `remove` keep `userId` signatures and stay owner-only via a private `findOwned(userId, projectId)` (the old `findOne` body).

- [ ] **Step 1: Write failing tests**: member `findAll` returns only shared projects; member `findOne` on a shared project succeeds; member `findOne` on another project throws `NotFoundException`; member calling `update` and `remove` throws (no workspace / not owner); owner behavior unchanged.
- [ ] **Step 2: Run** `npx jest src/projects` — Expected: FAIL.
- [ ] **Step 3: Implement.** `findAll`/`findOne` delegate to `AccessService`; `update`/`remove` call `findOwned`. Controller passes `user` (not `user.id`) to `findAll`/`findOne`.
- [ ] **Step 4: Run** `npx jest src/projects` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): let project members list and read shared projects`

### Task 3: Issue access checks and dashboard metrics

**Files:**
- Modify: `backend/src/issues/issues.service.ts` (`create`, `findByProject`, `findOne`, `getDashboardMetrics`), `backend/src/issues/issues.controller.ts`
- Test: `backend/src/issues/issues.access.spec.ts` (create)

**Interfaces:**
- Consumes: `AccessService.assertCanAccessProject`, `AccessService.listAccessibleProjects`.
- Produces: `IssuesService.create(user: AuthUser, dto)`, `findByProject(user: AuthUser, projectId)`, `findOne(user: AuthUser, issueId)`, `getDashboardMetrics(user: AuthUser)`. Other methods keep their current `userId` signatures; controller passes `user` to these four and `user.id` elsewhere.

- [ ] **Step 1: Write failing tests**: `create` for an unshared `project_id` throws `NotFoundException` and inserts nothing; `create` as a member of the project succeeds with `reporter_id = user.id`; `findByProject` for an unshared project throws; `findOne` returns an issue reported by a member when the caller is the project owner (previously hidden by the `reporter_id` filter) and returns it to the reporter; `findOne` for an issue in an unrelated project throws `NotFoundException`; `getDashboardMetrics` for a member with no workspace returns metrics for shared projects instead of the empty default.
- [ ] **Step 2: Run** `npx jest src/issues/issues.access` — Expected: FAIL.
- [ ] **Step 3: Implement.** Call `assertCanAccessProject` at the top of `create`/`findByProject`. In `findOne`, load the issue by id, then require `getProjectRole(user, issue.project_id)` non-null (drop the `reporter_id` filter but keep `delete` reporter-only as is). In `getDashboardMetrics`, source projects from `listAccessibleProjects`.
- [ ] **Step 4: Run** `npx jest src/issues` — Expected: PASS, including existing issue specs (fix any that assumed the old signatures).
- [ ] **Step 5: Commit** `fix(backend): enforce project access on issue create/list/read`

### Task 4: Invite email on add-to-project

**Files:**
- Create: `backend/src/members/invite.service.ts`, `backend/src/members/invite.service.spec.ts`
- Modify: `backend/src/members/members.service.ts` (`addToProject`), `backend/src/members/members.module.ts`

**Interfaces:**
- Produces: `InviteService.sendProjectInvite(email: string, projectName: string): Promise<{ sent: boolean; reason?: 'already-registered' | 'error' }>` — never throws.

- [ ] **Step 1: Write failing tests**: new address → calls `supabase.db.auth.admin.inviteUserByEmail(email, { redirectTo: <PLATFORM_URL>/login })` and returns `{sent: true}`; Supabase "already registered" error → `{sent:false, reason:'already-registered'}`; any other error/throw → `{sent:false, reason:'error'}`; `MembersService.addToProject` still returns the member and links the project when the invite service reports failure.
- [ ] **Step 2: Run** `npx jest src/members` — Expected: FAIL.
- [ ] **Step 3: Implement** `InviteService` and call it after the `project_members` upsert in `addToProject` (fetch the project name for the message). Add `PLATFORM_URL` to `backend/.env.example`. No email is sent to already-registered users in this iteration (no sender exists in the repo); log at `warn` level.
- [ ] **Step 4: Run** `npx jest src/members` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): send invite email when adding a member to a project`

### Task 5: Auth login/refresh endpoints with rate limiting

**Files:**
- Create: `backend/src/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `dto/login.dto.ts`, `dto/refresh.dto.ts`, `auth.service.spec.ts`
- Modify: `backend/src/app.module.ts`, `backend/src/main.ts` (trust proxy via env `TRUST_PROXY`), `backend/.env.example` (`SUPABASE_ANON_KEY`, `TRUST_PROXY`), `backend/package.json` (`@nestjs/throttler`)

**Interfaces:**
- Produces:
  - `POST /api/auth/login` body `LoginDto { email: string (IsEmail); password: string (MinLength 1) }`
  - `POST /api/auth/refresh` body `RefreshDto { refresh_token: string }`
  - Both return `AuthSession { access_token: string; refresh_token: string; expires_at: number /* unix seconds */; user: { id: string; email: string } }`
  - `AuthService.login(dto): Promise<AuthSession>`, `AuthService.refresh(dto): Promise<AuthSession>`; failures throw `UnauthorizedException('Invalid credentials')`.

- [ ] **Step 1: Write failing tests** (mock the anon client): login success maps the Supabase session to `AuthSession`; wrong password and unknown email both throw `UnauthorizedException` with the same message; refresh success; refresh with an invalid token throws `UnauthorizedException`; neither method logs the password or tokens.
- [ ] **Step 2: Run** `npx jest src/auth` — Expected: FAIL.
- [ ] **Step 3: Implement** the service with a dedicated `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` (not the service-role client), `signInWithPassword` and `refreshSession`. Apply `@nestjs/throttler` to the two routes: 5 requests/minute keyed on `${ip}:${email}` (custom `getTracker`); routes are not behind `SupabaseAuthGuard`.
- [ ] **Step 4: Run** `npx jest src/auth` — Expected: PASS. Then manual check: `curl -X POST localhost:4000/api/auth/login -H 'content-type: application/json' -d '{"email":"<test>","password":"<test>"}'` returns a session; the 6th rapid attempt returns 429.
- [ ] **Step 5: Commit** `feat(backend): add rate-limited auth login and refresh endpoints`

### Task 6: SDK auth core (AuthClient, session store, token manager)

**Files:**
- Create: `packages/react-native/src/auth/AuthClient.ts`, `SessionStore.ts`, `TokenManager.ts`, `types.ts`, and `__tests__/*.test.ts`
- Modify: `packages/react-native/package.json` (add `vitest` devDependency, `"test": "vitest run"`, optional peer `expo-secure-store`), `packages/react-native/src/types.ts` (config)

**Interfaces:**
- Produces:
  - `interface StorageAdapter { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> }`
  - `createSecureStoreAdapter(secureStore: { getItemAsync; setItemAsync; deleteItemAsync }): StorageAdapter`; `createMemoryAdapter(): StorageAdapter`
  - `AuthClient(apiUrl: string, fetchImpl?: typeof fetch)` with `login(email, password): Promise<AuthSession>`, `refresh(refreshToken): Promise<AuthSession>`, `listProjects(accessToken): Promise<Array<{ id: string; name: string }>>` (calls `GET /api/projects`)
  - `TokenManager(client: AuthClient, storage: StorageAdapter, onSignedOut: () => void)` with `getAccessToken(): Promise<string | null>` (refreshes when `expires_at` is within 60s), `refreshAfter401(): Promise<string | null>`, `signIn(email, password)`, `signOut()`, `getUser()`
  - `BugPilotConfig` gains optional `storage?: StorageAdapter`, `getAccessToken` becomes an optional override, `projectId` becomes optional.

- [ ] **Step 1: Write failing tests** (fake `fetch`/storage): `login` stores the session and `getAccessToken` returns it; an expired token triggers one refresh; **two concurrent `refreshAfter401()` calls produce a single refresh request**; a failed refresh clears storage, calls `onSignedOut`, and returns `null` (no retry loop); a 401 on `login` surfaces an error with a generic message; the adapter override (`config.getAccessToken`) bypasses the manager.
- [ ] **Step 2: Run** `cd packages/react-native && npx vitest run` — Expected: FAIL.
- [ ] **Step 3: Implement** the classes (pure TS, no `react-native` imports) with an in-flight promise for refresh de-duplication.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(rn): add auth client, session store and token manager`

### Task 7: SDK UI — sign-in sheet, project bar, form project field

**Files:**
- Create: `packages/react-native/src/SignInSheet.tsx`, `ProjectBar.tsx`, `useProjects.ts`, `__tests__/projectSelection.test.ts`
- Modify: `BugPilotProvider.tsx`, `BugPilotContext.tsx`/`types.ts` (context gains `session`, `projectId`, `setProjectId`, `signOut`), `FloatingBugButton.tsx` (tap while signed out opens the sheet), `SelectorMode.tsx` (render `ProjectBar` above the banner), `ReportForm.tsx` (project field), `api/createIssue.ts` (use `TokenManager`, retry once after 401), `index.ts` (exports)

**Interfaces:**
- Consumes: `TokenManager`, `AuthClient` (Task 6).
- Produces: `resolveInitialProject(projects: Array<{id: string}>, lastProjectId: string | null, lockedProjectId?: string): { projectId: string | null; error?: string }` — pure function (tested): locked project the user can't access → falls back to the picker with `error` set; single project is preselected; otherwise last used if still present; empty list → `projectId: null`. Last project is persisted per user id via the storage adapter.

- [ ] **Step 1: Write failing tests** for `resolveInitialProject` (the four cases above plus empty list).
- [ ] **Step 2: Run** `npx vitest run projectSelection` — Expected: FAIL.
- [ ] **Step 3: Implement** the function, then the components following the confirmed mockup: sign-in sheet (email, password, error line, loading state), top bar (project picker, signed-in email, Sign out) above the "Tap a UI region" banner, project field in `ReportForm` above Title, a clear "No projects shared with you yet" state. FAB and bar stay outside the screenshot root. On submit failure the form keeps its content and shows Retry. Wrap provider-side auth calls in try/catch so a failure disables the overlay rather than throwing into the host.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit -p .` — Expected: PASS / no type errors.
- [ ] **Step 5: Commit** `feat(rn): add sign-in sheet, project switching and form project field`

### Task 8: Platform — member users and mobile issues

**Files:**
- Modify: `platform/components/WorkspaceSwitcher.tsx` (handle `/workspaces/me` 404 for member-only users: show "Shared workspace" instead of erroring), `platform/app/(dashboard)/projects/[id]/page.tsx` and `.../issues/[issueId]/page.tsx` (mobile badge, device/OS/app version, screen name, element testID/label/size when `metadata.captureSource === 'rn-reporter'`; tolerate empty `url`), `platform/lib/types.ts` (mobile fields on `Issue`)
- Modify: `platform/app/(dashboard)/projects/page.tsx` — member users with projects must not be stuck on an owner-only create flow; hide "New Project" for `role === 'member'` (add `role?: 'owner' | 'member'` to `Project`).

**Interfaces:**
- Consumes: project `role` returned by Task 2.

- [ ] **Step 1: Implement** the changes above; keep web-extension issue rendering unchanged.
- [ ] **Step 2: Verify** `cd platform && npx tsc --noEmit && npm run lint` — Expected: no errors.
- [ ] **Step 3: Verify in the browser** (`preview_start` the platform): sign in as a member user, see the shared project list, open a mobile-captured issue (seed one via Task 9's test submit) and confirm badge, device details and screenshot render with no console errors.
- [ ] **Step 4: Commit** `feat(platform): support member users and render mobile-captured issues`

### Task 9: End-to-end acceptance on the Tallect simulator

**Files:**
- Modify (in Tallect-Mobile, `/Users/rahulsarawagi/TM/Tallect-Mobile`): `src/qa/BugPilotDevRoot.tsx` (drop the env-var token; pass `storage={createSecureStoreAdapter(SecureStore)}` and `apiUrl`), `.maestro/qa_bugpilot_fab.yaml` (extend to the sign-in path), `docs/mobile-qa/TRACK_A_PHASE2.md` (update status), root `CLAUDE.md` Repo Structure/Known Items (mention `packages/react-native`, auth endpoints, member access)

- [ ] **Step 1: Prepare data.** In the platform, as admin, create a project and add a tester email to it; sign up that tester from the invite (or create it in Supabase test data). Do not paste real credentials into chat or commit them.
- [ ] **Step 2: Run backend, platform and Metro** (never `CI=1`); no native rebuild is needed (no new native dependency).
- [ ] **Step 3: Walk the flow on the simulator** (`mcp__Claude_Code_iOS_Simulator__control`): tap FAB → sign in → pick project → select an element → fill title → Submit.
- [ ] **Step 4: Verify in the dashboard** that the issue appears under the tester as reporter, with route, element info, device info and screenshot, and that the admin can open it. Also verify negatives: sign-in with a wrong password shows the error; a tester not added to a project cannot see or submit to it.
- [ ] **Step 5: Run the test suites** `cd backend && npx jest` and `cd packages/react-native && npx vitest run` — Expected: all PASS.
- [ ] **Step 6: Commit** `docs: update mobile QA status and project context for RN auth` (repo-by-repo; Tallect commits only with the user's go-ahead).
