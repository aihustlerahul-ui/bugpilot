# Track A Phase 2 — RN Reporter Overlay MVP

**Track:** A — `@bugpilot/react-native`  
**Owner:** bugPilot  
**Updated:** 2026-11-04 ~00:37 IST — FAB + selector verified on sim; live API submit still blocked on env.

## Decision

| Date | Choice |
| --- | --- |
| 2026-11-03 | Track A Phase 2 + Tallect install of view-shot + local package |
| 2026-11-03 | User authorized agent to run native rebuild |
| 2026-11-03 | Auth v1: **Supabase JWT Bearer** via `EXPO_PUBLIC_BUGPILOT_ACCESS_TOKEN` (PAT deferred) |

## Tallect host wiring

| Item | Detail |
| --- | --- |
| Peer | `react-native-view-shot@5.1.0` (Podfile.lock + node_modules) |
| Package | `file:../../Work/bugPilot/packages/react-native` |
| Metro | watchFolders + extraNodeModules — **do not start with `CI=1`** (disables reload) |
| Host | `src/qa/BugPilotDevRoot.tsx` + `__DEV__` gate in `App.tsx` |
| Route | `getRouteName` / `getRouteParams` from `navigationRef` |
| FAB | Provider renders `FloatingBugButton` **outside** screenshot root (`testID=bugpilot-fab`) |

## Rebuild log

| Attempt | Platform | Result |
| --- | --- | --- |
| 1–2 | iOS | Prior day: fail ENOSPC then succeed on iPhone 17 |
| 3 | iOS | **Skipped** 2026-11-04 — disk ~23–24 GB (&lt;30 GB). JS-only via Metro. |

## Require-cycle

- Context module: `BugPilotContext.tsx`.
- Overlays lazy-`require`d inside Provider so Metro static graph is Provider ↛ Form.
- **2026-11-04 Metro (no CI):** no require-cycle WARN after restart; only project-id unset warn.

## Screenshot path

Provider root View (children only; FAB outside) → `createScreenshotCapture` → view-shot when peer resolves.

- `isViewShotAvailable()` — JS require ok (not native-link guarantee).
- `getLastViewShotFailure()` — `js-missing` / `native-unlinked` / `root-unmounted` / `capture-failed`.
- Pods include view-shot — native link **[Likely]**; no uploaded issue this pass to prove bytes on Nest.

## Selector / context (no Fiber)

- `BugPilotWatch` + remasure-before-hit-test.
- Miss → coordinate-capture + route.
- Form meta: route, bounds, testID, a11y, nativeID.
- `createIssue` fails fast if token missing (no blind unauth POST).

## Verify results (2026-11-04)

| Check | Result | Evidence |
| --- | --- | --- |
| FAB `__DEV__` | **Pass** | Maestro `bugpilot-fab` + screenshots |
| FAB → selector | **Pass** | Banner “Tap a UI region…”; form also seen with `coordinate-capture` |
| Optional Maestro | **Pass** | `maestro test .maestro/qa_bugpilot_fab.yaml` exit 0 (`~/.maestro/tests/2026-11-04_0036*`) |
| Live Nest submit | **Blocked** | No `EXPO_PUBLIC_BUGPILOT_ACCESS_TOKEN` / real `PROJECT_ID` in `.env` |
| Native rebuild | **Not run** | Disk &lt;30 GB |

## Env for real submit

```bash
EXPO_PUBLIC_BUGPILOT_API_URL=http://localhost:4000   # or LAN IP for device
EXPO_PUBLIC_BUGPILOT_PROJECT_ID=<uuid from platform>
EXPO_PUBLIC_BUGPILOT_ACCESS_TOKEN=<Supabase JWT access_token>
```

Nest must be up. Placeholder project UUID is rejected.

## Related

- [TRACK_A_PHASE1.md](./TRACK_A_PHASE1.md)
- [MCP_SERVER.md](./MCP_SERVER.md) — Track C untouched
- Tallect `QA/AGENT_STATUS.md` / `QA/ANNOTATION_TOOL.md`
