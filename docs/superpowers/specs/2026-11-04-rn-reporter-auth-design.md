# RN Reporter: In-App Sign-in, Project Switching, End-to-End Submit — Design

**Date:** 2026-11-04
**Status:** Awaiting user approval
**Builds on:** existing `packages/react-native` (`@bugpilot/react-native`)

## Intent and why

Testers use a React Native app and tap a floating bug icon, tap any element, fill a short form, and the bug lands in the bugPilot dashboard with the element, screen and device attached. The overlay, selector, form and screenshot capture already exist. What is missing is the part that makes it usable by real testers:

1. Today auth is a hand-pasted Supabase JWT in an env var (`EXPO_PUBLIC_BUGPILOT_ACCESS_TOKEN`) and a fixed project ID in env. It expires within about an hour and nobody can switch projects. Because of this, **a real submit has never reached the backend.**
2. Nobody has seen a mobile bug in the dashboard, so mobile-specific data (device, screen, element) may not render well.

This design closes both gaps.

## Decisions made with the user

- Testers **must have a bugPilot account**; there is no anonymous reporting.
- Auth is an **in-SDK login sheet**, same identity as the Chrome extension (email + password), not a project API key.
- The SDK does **not** talk to Supabase directly. The Nest backend **wraps** login/refresh in its own endpoints.
- Project switching works like the extension: pick a project after signing in, remember the last choice, change it from the sheet and from the form.
- **Access model (minimal, interim):** the admin (workspace owner) adds people to a project from the platform, using the existing project-members feature. An email is sent to the person. If they have no bugPilot account they sign up with that same email; if they do, they just sign in. Once added to a project, a member can see that project and **create bugs in it** (in addition to being assignable). Full RBAC and team features are a separate, later project.
- All testers sign in with **email and password**. SSO/Entra is not needed.
- UX confirmed via mockup: (1) first tap while signed out opens a sign-in sheet; (2) signed in shows a top bar with project picker, user and sign-out, plus the "tap a UI region" banner; (3) the report form shows a project field, title, severity, and an auto-attached summary (screen, element, device, screenshot).

## Goals

- A tester invited by an admin can sign in inside the app, pick a shared project, report a bug, and see it in the dashboard, with no env-var tokens.
- Session persists across app restarts and refreshes silently when the access token expires.
- Token validation stays the same: every request carries the user's access token and goes through the existing `SupabaseAuthGuard`. Only the *which projects can this user touch* check changes (section 1b).
- Mobile bugs render usefully in the platform issue list and detail (device, screen, element, screenshot).

## Non-goals

- Project-scoped API keys / PATs (deferred; relevant later for MCP and CI).
- Sign-up, password reset, SSO/Entra in the SDK (testers sign up on the platform via the invite email).
- Full RBAC, roles, and team management (later project). Members get only list/read/create-issue on their projects for now.
- The bugPilot MCP server.
- Video / step-log recording, console and network capture on device.
- Release-store builds: the overlay stays gated to dev/QA builds.

## Anti-goals

- Shipping Supabase service-role keys or any secret in the app bundle.
- Logging passwords or tokens, or storing them in plain AsyncStorage when a secure store is available.
- A login flow that blocks the host app or can crash it. SDK failures must degrade to "overlay unavailable", never break the host.

## Design

### 1. Backend: auth wrapper (new `auth` module)

- `POST /api/auth/login` `{email, password}` → `{access_token, refresh_token, expires_at, user: {id, email}}`. Calls Supabase password grant server-side.
- `POST /api/auth/refresh` `{refresh_token}` → same shape.
- Both are public routes (no guard) and must be **rate limited** per IP/email. Errors map to 401 with a generic message; never reveal whether the email exists.
- Needs the Supabase anon (publishable) key in backend config (`SUPABASE_ANON_KEY`), added to `.env.example`. The service-role key is not used for this.
- Everything else keeps `supabase.auth.getUser(token)` as the single validation path.

### 1b. Backend: member access (new, minimal)

Today every project/issue route resolves the workspace via `findByOwner(userId)`, so only the owner has access. The existing `project_members` rows (name + email, no account link) only support assignment.

- **Invite email:** when the admin adds a person to a project, send them an email naming the project and telling them to sign up or sign in with that address. No email sender exists in the repo yet. *(My call: use Supabase's built-in invite email for new addresses and a plain notification for existing users; the builder may choose a different sender.)*
- **Access resolution:** a signed-in user's accessible projects = projects in the workspace they own **plus** projects where a `project_members.email` matches their verified Supabase email (case-insensitive). Matching is by email, so no new account-link column is required; the builder may add a `user_id` link if it simplifies.
- **Scope of member permissions:** members may **list** their member projects (`GET /projects`), **read** a member project, and **create** issues in it (`POST /issues`). Everything else (project update/delete, settings, integrations, member management, other workspace data) stays owner-only. Members can see issues in a project they belong to only to the extent the platform already lists them per project; the builder should confirm what is exposed and keep it to that project.
- The owner path is unchanged. Do not widen `findByOwner` itself; add an explicit access-check helper used by the member-enabled routes.
- The platform dashboard for a member user shows the shared projects (a signed-in member with no own workspace must not hit "Workspace not found" there).

### 2. SDK: session and auth

- New `AuthClient` in `packages/react-native` calling the two endpoints above.
- Session store with an injectable storage adapter. Default tries `expo-secure-store` / Keychain-style storage if the host provides it; falls back to AsyncStorage if the host passes it; otherwise memory only (user signs in each launch). The host app chooses, SDK declares optional peers. *(My call: optional peer deps, no new hard native dependency.)*
- `getAccessToken()` becomes internal: returns the stored token, refreshes when expired or on a 401, retries once, and on refresh failure signs the user out and reopens the sheet. The `getAccessToken` prop and env-var token remain as an optional override for CI runs.
- Config shrinks to `apiUrl` plus optional `storage`, `enabled`, route helpers; `projectId` becomes optional (preselect/lock a project for a given host build).

### 3. SDK: UI changes (extends existing `FloatingBugButton`, `SelectorMode`, `ReportForm`, `BugPilotProvider`)

- **Sign-in sheet:** email, password, error line, loading state. Shown on first tap when no valid session.
- **Top bar in selector mode:** current project (tap to change), signed-in email, Sign out. Shown above the existing "Tap a UI region" banner.
- **Project picker:** `GET /api/projects`; remembers the last project per user; if a single project exists it is preselected; if none, shows a clear "no projects, create one on the platform" state.
- **Report form:** project field (changeable), title, severity, auto-attached summary (screen/route, element id/label/size, device/OS/app version, screenshot status). Existing smart/standard field concepts stay as they are.
- Floating button and top bar stay outside the screenshot root, as today.

### 4. Submit and offline behavior

- `createIssue` uses the session token and chosen project; on 401, refresh once and retry.
- *(My call: no offline queue in this iteration.)* On network failure the form keeps its content and shows a retry; a persistent queue like the extension's is a follow-up.

### 5. Platform: mobile issue rendering

- Issue list/detail show a mobile badge, device/OS/app version, screen name and element details when `metadata.captureSource === 'rn-reporter'`.
- Screenshot appears through the existing signed-URL path. No schema migration: mobile data lives in existing `browser_info`, `element_info`, `route` and `metadata` fields.
- Fix whatever breaks when `url` is empty, since mobile issues have no page URL.

### 6. Verification

- Backend: unit tests for login/refresh (success, bad credentials, rate limit) and for member access (member can list/create in a shared project; cannot access an unshared project, nor owner-only routes).
- SDK: tests for session store, token refresh/retry, and payload building.
- End to end on the host app simulator: sign in → pick project → select element → submit → confirm the issue and screenshot in the dashboard. This is the acceptance test, since it has never run.

## Constraints

- Existing locked decisions hold: independent implementation, `__DEV__`/QA-build gating, no component-tree internals, native dependencies need the user's approval before being added to host app.
- Extension and platform behavior must not regress; the backend auth guard is unchanged.
- The repo is not an npm workspace; the package stays consumed via `file:` link.
- Project conventions in `CLAUDE.md` apply (no secrets committed, JWT validated via `getUser`).

## Findings from the builder check (answered from the code)

- **Issue payload:** `CreateIssueDto` already has optional `url`, free-form `metadata`/`element_info`/`browser_info`, and screenshots as base64 strings, which is what the SDK sends. No DTO change is expected; the end-to-end test confirms it.
- **Storage:** the host app already depends on `expo-secure-store`, so persistence needs no new native dependency there. *(My call: use it as the default adapter when the host provides it.)*
- **Locked `projectId` vs. picker:** *(My call)* if the host locks a project the user can't access, fall back to the picker with an error line.
- **Rate limiting:** *(My call)* key on email plus IP, and configure Nest's trust-proxy setting for the deployment in front of the API, so testers behind one proxy don't lock each other out.
- **Resolved with the user:** testers get access through admin-added project membership (section 1b); all testers use email + password.
- **Final review (fix wave):** invited testers set their password on the platform's `/accept-invite` page (also the target of "Forgot password"); member access requires a confirmed email that matches exactly. The hosted Supabase settings this depends on (redirect allow-list, Confirm email and Secure email change ON, custom SMTP) are listed in `docs/mobile-qa/AUTH_SETUP.md` and were not verifiable from the repo.

## Left to the builder

- Rate-limit mechanism (e.g. Nest throttler) and thresholds.
- Exact storage-adapter interface and sheet visual polish within the confirmed layout.
- Test framework for the package.
- Whether the token expiry margin refreshes proactively or only on 401.

## Open items

None blocking. Items marked "My call" above are assumptions to confirm or change.
