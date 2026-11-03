# Jelly → bugPilot parity matrix (RN)

**Purpose:** Map Jelly capabilities to bugPilot **web today** and **planned RN**, with v1 / later / won’t-do.  
**Sources:** [jelly-android](https://github.com/rajanndube/jelly-android) (primary technical), addjelly.com + RN page, jelly-local-sync, bugPilot `extension/` + Phase 0 docs.  
**Rule:** Inspired UX only. **Do not** install Jelly, vendor their code, or copy assets. See license note below.  
**Updated:** 2026-11-03.

Confidence: **[Certain]** / **[Likely]** / **[Guessing]** per cell evidence.

---

## License note (blocking for copy)

| Item | Detail |
| --- | --- |
| License | PolyForm Shield 1.0.0 ([Certain] jelly-android `LICENSE.md`) |
| Risk | Explicit **noncompete**: using their software to ship a competing product is forbidden; competition includes “practical substitutes” across platforms |
| bugPilot policy | **Independent implementation** of capture → Nest `/api/issues` → dashboard → **bugPilot MCP**. Read public docs for behavior; **never** copy/vendor Jelly source into this repo |
| Branding | No Jelly marks/copy in UI |

---

## Capture surface recommendation (behavior only)

Inspired by jelly-android’s **preferred** pattern (`Jelly.install` + FAB + annotate mode + long-press + form + baked image), **not** their Compose semantics engine:

| Jelly Android | Recommended bugPilot RN package design |
| --- | --- |
| `Jelly.install` once at Application | Thin Expo-compatible package: root provider gated `__DEV__`, optional install from Tallect with user approval |
| Dual overlay (decor + panel window) | Single RN absolute overlay + high zIndex; document modal/sheet conflicts (same class as Jelly dialog limitation) |
| Annotate mode toggle on FAB | Explicit **bug mode** (FAB or header) — avoid hijacking all long-presses while navigating |
| Compose/View hit-test | **Mimic outcome** (named element + path), not Compose/Jelly engines. Prefer `testID` / a11y / opt-in `displayName` wrappers ([Certain] Phase 0 Web→RN mapping). Jelly RN marketing fiber walk = aspirational; treat private Fiber as **later / best-effort only** (brittle on Hermes/RN upgrades) |
| `Modifier.jellySource` | Optional opt-in source/name tags — don’t require per-screen tags for v1 |
| Baked PNG + markdown | Map into existing issue: screenshots + `element_info` + `description` / `metadata`; dashboard remains SoT |
| `JellyApi` `/sessions` HTTP | **Do not** clone Jelly’s sessions protocol. Reuse `POST /api/issues` + proposed **bugPilot MCP** for Cursor |
| DataStore 7-day local | Optional offline queue; system of record = Supabase (already web) |
| local-sync + ClickUp | Later / won’t-do for v1 — bugPilot platform + integrations already exist |

---

## Parity matrix

| Jelly feature | Evidence | bugPilot web today | Planned RN | Decision |
| --- | --- | --- | --- | --- |
| Debug-only in-app toolbar / FAB | [Certain] Android README | N/A (Chrome extension) | Dev overlay in reporter SDK | **v1** |
| Annotate / bug mode toggle | [Certain] | Extension picker modes | Bug mode before select | **v1** |
| Long-press / click element select | [Certain] | Hover/click DOM | Tap/long-press fiber or a11y | **v1** |
| Live bounds highlight | [Certain] | Element highlight | Highlight rect | **v1** |
| Comment + severity | [Certain] | Modal form + severity | Form → `POST /api/issues` | **v1** |
| Intent (fix/change/question/approve) | [Certain] Annotation enum | Labels / description fields | Map to metadata or description tags | **v1** (lightweight) |
| Numbered on-screen markers + review list | [Certain] | Multi-annotation canvas tools | Markers + review sheet | **v1** (simple list OK) |
| Auto element name + hierarchy path | [Certain] CapturedElement | `element_info` / DOM path | testID + a11y + opt-in names; Fiber **optional later** | **v1** (safe props); Fiber **later** |
| Source file:line | [Certain] jellySource / tooling | Limited / DOM | Optional tags / best-effort maps | **v1** optional tags; auto source **later** |
| Baked caption strip on screenshot | [Certain] BakedImage | Canvas annotate then upload | Annotated PNG (bounds + caption or draw tools) | **v1** bounds+label; full bake polish **later** |
| Freehand rect/arrow/blur/pen/text | Absent on Android SDK [Certain]; web Jelly may differ | **Yes** — `annotate.js` TOOLS | Port subset of web tools | **v1** rect/arrow/blur; pen/text **later** |
| Console buffer | Not in Jelly SDKs [Certain] | Yes — content.js | Metro / LogBox hook | **later** |
| Network buffer (+ redact secrets) | Not in Jelly [Certain] | Yes | Fetch/XHR interceptor | **later** |
| rrweb DOM replay | N/A mobile; web Jelly unknown | Yes — `replay_data` | N/A | **won’t do** on RN |
| Screen / session video | Not in Jelly Android [Certain] | Yes — video path | Optional | **later** |
| Desktop local-sync SSE viewer | [Certain] jelly-local-sync | Platform dashboard | Use bugPilot platform | **won’t do** (duplicate) |
| ClickUp one-click from sync UI | [Certain] local-sync | Integrations exist | Via platform | **later** / reuse web |
| HTTP `/sessions` “MCP endpoint” | [Certain] JellyApi | Nest REST | — | **won’t do** Jelly wire format |
| Cursor MCP list/get bugs | Jelly ≠ Cursor MCP [Certain] | Missing → proposed | bugPilot MCP | **Track C deferred** (read-only when started) |
| Maestro verify | Out of Jelly scope | N/A | Tallect + Maestro MCP | Separate — **not** bugPilot capture |
| Compose/Android View hit-test in RN app | Android only; **RN invisible** [Certain] | N/A | RN overlay + testID/a11y (not jelly-android) | **v1** |
| Expo Go support | Unstated [Guessing] | N/A | **expo-dev-client** only for Tallect | **won’t do** Expo Go |
| Shake to report | Not in Jelly sources [Certain] | N/A | Optional gesture | **later** / optional |
| Placement / rearrange annotation kinds | Schema [Certain]; rich on web | Partial | Skip | **won’t do** v1 |
| Cross-app SYSTEM_ALERT_WINDOW | Roadmap [Certain] | N/A | — | **won’t do** |
| Auth/privacy ownership | Local-first Jelly | Supabase JWT | bugPilot-owned auth | **v1** (locked) |

---

## Must-have for bugPilot RN v1

1. `__DEV__` / debug-gated in-app overlay (installable package from bugPilot).  
2. Bug mode → select element → form (title/description/severity + intent tag).  
3. Auto context: component/display name, hierarchy path, bounds, route, device/app metadata → same `POST /api/issues` family as extension.  
4. Screenshot with selection highlight (annotated PNG).  
5. Auth via bugPilot (not Jelly local-only).  
6. Cursor consumes via **bugPilot MCP** (read path); Maestro MCP stays separate for verify.

---

## Explicit non-goals / later

| Item | Bucket |
| --- | --- |
| Installing or depending on Jelly packages | **won’t do** |
| Copying Jelly source / PolyForm-covered code | **won’t do** |
| Jelly `/sessions` wire protocol + jelly-local-sync clone | **won’t do** |
| rrweb on RN | **won’t do** |
| Console + network capture | **later** |
| Video recording | **later** |
| Full freehand annotate parity with web | **later** (subset in v1) |
| Rewards/tour product UI in Tallect | **won’t do** (annotation is bugPilot-owned) |
| Expo Go | **won’t do** for Tallect path |

---

## Web-only vs “same as web, for mobile”

| Web (bugPilot extension) | Mobile analogue |
| --- | --- |
| DOM hover/click, CSS, computed styles | Fiber component + a11y + testID; no CSS |
| rrweb | Step log / optional video — not DOM replay |
| Console + network | Later Metro/fetch hooks |
| Canvas annotate tools | Subset on device or annotate in platform after upload |
| Page URL / route | React Navigation route + deep link if any |
| `browser_info` | Device / Expo / build in `metadata.mobile` |

---

## Contradictions with Phase 0 dual-repo plan?

| Phase 0 lock | Jelly research impact |
| --- | --- |
| Annotation owned by bugPilot; Tallect = app under test | **Reinforced** — jelly-android is a host-app SDK pattern; we still own the package in bugPilot |
| Capture = in-app overlay; #7 Locked (FAB → select → on-device form) | Jelly validates Option A; bugPilot entry chrome = free-floating icon (not Jelly code) |
| bugPilot MCP ≠ Maestro MCP | **Reinforced** — Jelly’s “MCP” is HTTP sessions, not Cursor; do not conflate |
| Same REST issues API | Prefer mapping Jelly-like fields into existing DTO/`metadata`, not a parallel sessions API |
| No installs in Phase 0 | Unchanged |

**Tensions (resolved in docs, not code):**

1. Jelly’s strongest pitch is **source:line + component tree**. Phase 0 Web→RN mapping correctly flags **private Fiber as risky** — v1 ships hierarchy via **testID / a11y / opt-in names**; auto Fiber/source is later.
2. Jelly validates locked Option A (in-app overlay); no conflict with dual-repo ownership.
3. Do not adopt Jelly `/sessions` — keep Nest issues + bugPilot MCP.

---

## Related

- Tallect reference: `/Users/rahulsarawagi/TM/Tallect-Mobile/QA/JELLY_REFERENCE.md`
- Architecture: `./ARCHITECTURE.md`
- Schema: `./REPORT_SCHEMA.md`
