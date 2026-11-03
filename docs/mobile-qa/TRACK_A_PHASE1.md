# Track A Phase 1 — RN Reporter Checklist

**Track:** A — `@bugpilot/react-native` (FAB / select / form)  
**Owner:** bugPilot  
**Started:** 2026-11-03  
**Status:** Phase 1 scaffold **DONE** — continue in [TRACK_A_PHASE2.md](./TRACK_A_PHASE2.md)  
**Out of scope this phase:** Maestro (Track B), MCP (Track C), Tallect app install, npm publish, Jelly code, new native modules without approval.

## Locked UX (#7)

1. Free-floating icon (FAB)
2. Enables **selector mode**
3. Form opens **on device** the same way as the Chrome extension modal (Smart / Standard concepts)
4. Submit with auto context → `POST /api/issues`
5. **Not** “edit only after upload”

## Extension parity target (field-for-field)

Audited: `extension/content.js` (modal + `buildIssue`), `extension/background.js` (`submitIssue` → `POST /api/issues`), `extension/sidepanel` (“Capture Now” / ⌥⇧Q). Confidence: **[Certain]** unless noted.

### Entry → select → form

| Step | Extension (web) | RN Phase 1 target |
| --- | --- | --- |
| Activate | Side panel “Capture Now” or Alt+Shift+Q | `FloatingBugButton` FAB |
| Selector | Hover highlight + click | `SelectorMode` tap overlay |
| Form | Modal: Smart Mode + Standard Form | `ReportForm` sheet/modal |
| Cancel / continue | Cancel, Save & Continue, Save & Submit | Stub actions; submit path first |

### Form fields (Standard + Smart)

| Extension UI | Issue / API mapping | RN stub |
| --- | --- | --- |
| Smart: “What’s wrong?” textarea | Synthesizes title/description (AI optional later) | Optional single-input stub |
| Title * | `title` | Required |
| Description | `description` (API concatenates title + desc) | Optional |
| Expected Result | `metadata.expectedResult` | Optional |
| Actual Result | `metadata.actualResult` | Optional |
| Priority (settings) | `metadata.priority` | Optional stub |
| Environment (settings) | `metadata.environment` | Optional stub |
| Labels (settings) | `metadata.labels` | Optional stub |
| Sprint (settings) | `metadata.sprint` | Optional stub |
| Severity | `severity` (Low/Medium/High/Critical; default Medium) | Required select |
| Assignee | `metadata.assignee` | Defer or stub |
| Screenshots slider + annotate | `screenshot`, `element_screenshot`, `metadata.screenshots` | **TODO** via `ScreenshotCapture` interface |
| Element details panel | `element_info` | RN shape (below) |
| Console / network collapsibles | `metadata.consoleErrors` / network | **Later** |

### `POST /api/issues` body (extension → API)

| API field | Source | RN Phase 1 |
| --- | --- | --- |
| `project_id` | Selected project | Config prop on provider |
| `title` | Form | Yes |
| `description` | title + `\n\n` + description | Yes |
| `severity` | Form | Yes |
| `url` | `location.href` | Deep link or omit / app scheme [Likely] |
| `route` | `location.pathname` | React Navigation route name |
| `browser_info` | UA / env object | Device / Expo env object (same slot) |
| `element_info` | DOM element bag | RN: `testID`, a11y, opt-in name, bounds, route — **not** CSS/XPath |
| `screenshot` | Base64 (no data-URL prefix) | Interface stub — real capture needs approval |
| `element_screenshot` | Full-page base64 | Same |
| `metadata` | pageContext, expected/actual, etc. | `captureSource: rn-reporter` + `metadata.mobile` |
| `replay_data` | rrweb | N/A on RN |

Auth today: Bearer Supabase JWT from extension storage **[Certain]**. RN auth contract still open (JWT vs PAT) — stub accepts `getAccessToken` callback.

## Package checklist

| # | Item | Status |
| --- | --- | --- |
| A1 | Create `packages/react-native/` with `package.json` name `@bugpilot/react-native` | ☑ |
| A2 | README: install (local path), `__DEV__` gate, no Jelly, Track A scope | ☑ |
| A3 | TS stubs: `BugPilotProvider`, `FloatingBugButton`, `SelectorMode`, `ReportForm` | ☑ |
| A4 | Types for config, selected element, create-issue payload | ☑ |
| A5 | JS-only `createIssue` fetch helper (no new native deps) | ☑ |
| A6 | `ScreenshotCapture` interface + TODO / needs-approval note | ☑ |
| A7 | Document extension → RN parity in this file (done above) | ☑ |
| A8 | Do **not** publish to npm | ☑ policy |
| A9 | Do **not** modify Tallect app to install | ☑ policy |
| A10 | Do **not** implement MCP | ☑ policy |

## Needs user approval (blocked)

| Item | Why |
| --- | --- |
| Native screenshot library (e.g. view-shot style) | Tallect / consumer native rebuild; bugPilot package peerDep |
| Install `@bugpilot/react-native` into Tallect-Mobile | Explicit product wire-up |
| Start Track B (Maestro / testIDs) | Separate track |
| Start Track C (MCP read-only) | Separate deferred task |
| Auth scheme (JWT vs PAT) implementation | Design still open |

## Definition of done (Phase 1 scaffold)

- Package folder exists with stubs that compile conceptually (peer React / RN).
- Parity table above is the contract for Phase 2 implementation.
- No MCP, no Tallect install, no Jelly source, no unapproved native modules.

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Web → RN mapping
- [REPORT_SCHEMA.md](./REPORT_SCHEMA.md)
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
- Package: `../../packages/react-native/`
