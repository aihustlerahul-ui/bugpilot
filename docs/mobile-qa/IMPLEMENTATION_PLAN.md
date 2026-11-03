# bugPilot — RN Reporter + MCP Implementation Plan (three-track)

**Recovery status:** 2026-11-03 ~23:55 IST — prior “complete all” agent crashed; this pass is inventory + disk recovery only (no Maestro campaign, no rebuild).  
**Track A Phase 2:** Package + Tallect host + earlier iOS rebuild evidence; FAB manual verify still open.  
**Track A Phase 1:** Done.  
**Track C (MCP):** **Implemented** read-only — `packages/mcp-server`; Cursor entry present, token empty.  
**Track B (Maestro):** Tallect-owned — harness landed; `qa:smoke` **not green**.  
**Auth v1:** Supabase JWT Bearer via env (PAT deferred).  
**Hard locks:** Auth/privacy owned here; Maestro MCP ≠ bugPilot MCP; no Jelly vendor; prefer `@bugpilot/react-native`.

## Goals

1. **Track A:** RN/Expo apps file issues via in-app overlay (floating icon → select → form) shipped as `@bugpilot/react-native`, same `POST /api/issues` family as the Chrome extension.
2. **Track C:** bugPilot MCP read-only (list/get) for Cursor — separate from Maestro MCP.
3. Keep Tallect as app under test; do not relocate Maestro ownership here.
4. Own auth + screenshot/AI privacy; Tallect only consumes.

## Three-track status (2026-11-03 night recovery)

| Track | Owner | Status | Notes |
| --- | --- | --- | --- |
| **A — RN reporter** (FAB/select/form) | bugPilot | **Partial** | Code + host + Podfile.lock view-shot; FAB/submit unverified; require-cycle broken via `BugPilotContext.tsx` |
| **B — Maestro / testIDs / journeys** | Tallect | **Blocked** for green smoke | Harness Done; last failure: post-Metro assert / prior XCTest driver timeouts — see Tallect `QA/AGENT_STATUS.md` |
| **C — bugPilot MCP** read-only | bugPilot | **Partial** | Code Done; `BUGPILOT_ACCESS_TOKEN` empty in `~/.cursor/mcp.json`; live smoke not run |

## Decisions log (2026-11-03)

| # | Topic | Decision | Status |
| --- | --- | --- | --- |
| 1 | RN capture surface | Floating entry → selector → form → auto rich context. Extension UX parity, mobile-adapted. | **Locked** |
| 2 | SDK vs script | Prefer `packages/react-native` → `@bugpilot/react-native`. | **Locked** |
| 3 | Auth for reporter + MCP | Designed here (JWT vs PAT). Do not push invention to Tallect. | **Locked** |
| 4 | Maestro MCP | Separate Cursor MCP (Tallect Track B). Official tool names only. | **Locked** |
| 5 | Screenshot / AI privacy | Owned by bugPilot. | **Locked** |
| 6 | Entra / Maestro login | Tallect: env / untracked — never commit. | **Locked** |
| 7 | Annotation / on-device | **Free-floating icon → enables selector mode → form opens the same way as the Chrome extension.** On-device capture UX matching extension — **not** “edit only after upload.” | **Locked** |
| 8 | Flow folder (Tallect) | Default `.maestro/`. | **Locked** |
| 9 | Workstream split | Track A is a **separate** code feature — not mixed into Tallect product or MCP. | **Locked** |
| 10 | MCP near-term | Separate task later; **read-only** (list/get). Do **not** implement in Track A Phase 1. | **Locked** |
| 11 | Track A Phase 2 | User chose **A = Track A Phase 2**. Screenshot peer = `react-native-view-shot` (optional); Tallect install blocked until approval. | **Locked** |

## Phases

### Phase 0 — Audit + docs — DONE

- [x] Architecture, schema, MCP proposal, Web → RN mapping
- [x] Locked decisions including **#7 Locked** + three-track split
- [x] Track A Phase 1 go

### Track A — Phase 1 — DONE

Concrete checklist: [TRACK_A_PHASE1.md](./TRACK_A_PHASE1.md)

### Track A — Phase 2 (ACTIVE)

Concrete checklist: [TRACK_A_PHASE2.md](./TRACK_A_PHASE2.md)

1. Selector highlight + registry hit-test (`BugPilotWatch`).
2. Form smart defaults + submit with device/nav metadata.
3. Screenshot adapter in package (`ViewShotScreenshotAdapter`); Tallect `npx expo install react-native-view-shot` **only after user approval** + native rebuild.
4. No Track B/C; no Tallect `App.tsx` wiring this turn.

### Track C — Deferred

Implement MCP stdio wrapping GET projects/issues — see [MCP_SERVER.md](./MCP_SERVER.md). Read-only first.

### Track B — Tallect (parallel, external)

Maestro / testIDs / journeys — see Tallect `QA/`.

## File ownership (bugPilot)

| Area | Path | Track |
| --- | --- | --- |
| Docs | `docs/mobile-qa/*` | A / C |
| Track A Phase 1 | `docs/mobile-qa/TRACK_A_PHASE1.md` | A (done) |
| Track A Phase 2 | `docs/mobile-qa/TRACK_A_PHASE2.md` | A (active) |
| REST | `backend/src/issues/*` | A (consume) |
| RN reporter | **`packages/react-native/`** | A |
| MCP server | `packages/mcp-server/` (TBD) | C — do not create this turn |

## Remaining open questions

1. JWT vs PAT concrete scheme for RN reporter (**still open**).
2. When user approves Tallect `react-native-view-shot` install + rebuild.
3. When to start Track C.
4. `__DEV__` vs QA flavor at Tallect wire-up time (package already defaults `enabled` to `__DEV__`).

## Blockers

| Blocker | Notes |
| --- | --- |
| Native screenshot dep in Tallect | Package adapter ready; host needs **user approval** then `npx expo install react-native-view-shot` + rebuild |
| Tallect package wire-up | Explicitly deferred until user asks |
| Track C | Deferred — Cursor cannot list bugs yet |
| Tallect `testID` gap | Weakens element identity until Track B |

## Exit criteria for Track A Phase 1 (scaffold)

- [x] `#7` Locked in docs (both repos)
- [x] Package scaffold + README + stubs present under `packages/react-native`
- [x] Extension → RN field parity documented (`TRACK_A_PHASE1.md`)
- [x] No MCP code; no Tallect app install; no Jelly copy
