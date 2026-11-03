# `@bugpilot/react-native`

**Track A Phase 2** — in-app bug reporter for React Native / Expo.

Parity target: Chrome extension UX (activate → select element → form → `POST /api/issues`), adapted for mobile:

1. **Free-floating icon** (FAB)
2. Enables **selector mode** (highlight + registry hit-test)
3. **On-device form** (Smart + Standard fields; smart defaults from selection)
4. Auto context + optional screenshot → submit

**Not** “edit only after upload.” See `docs/mobile-qa/TRACK_A_PHASE2.md`.

## Status

| Item | State |
| --- | --- |
| FAB → selector → form → `createIssue` | Phase 2 wired |
| Selector highlight + `BugPilotWatch` registry | Phase 2 |
| Screenshot adapter (`react-native-view-shot`) | Peer + adapter; Tallect installed `5.1.0` |
| Auth | Consumer supplies `getAccessToken`; **JWT vs PAT still open** |
| Published to npm | **No** — local path / private package |
| Installed in Tallect-Mobile | **Yes** (`file:../../Work/bugPilot/packages/react-native`, `__DEV__` only) |
| Native rebuild in Tallect | **Pending user** — `expo run:ios` / `expo run:android` |
| MCP | **Out of scope** (Track C deferred) |

## Screenshot approach

**Primary (recommended for Expo / expo-dev-client):** peer dependency **`react-native-view-shot`**.

- `BugPilotProvider` wraps children in a root `View` ref.
- `ViewShotScreenshotAdapter` calls `captureRef` → base64 PNG (no data-URL prefix).
- In-app UI capture is annotation-friendly (subtree, not whole OS display).

**Alternative (not implemented):** `expo-screen-capture` for full display pixels — less ideal for marking a React subtree.

**Fallback:** `noopScreenshotCapture` when the peer is missing (one `__DEV__` warning). Submit still works without a screenshot.

### Tallect (this machine)

```bash
# Already run (approved):
npx expo install react-native-view-shot
npm install --save "file:../../Work/bugPilot/packages/react-native"
```

**Rebuild required** (user; agent does not run unless asked):

```bash
npx expo run:ios
# or
npx expo run:android
```

Metro reload is **not** enough. **expo-dev-client only** — not Expo Go.

Path on this machine: `/Users/rahulsarawagi/Work/bugPilot/packages/react-native`  
Relative from Tallect-Mobile: `../../Work/bugPilot/packages/react-native`

## Usage (Tallect host pattern)

```tsx
import {
  BugPilotProvider,
  FloatingBugButton,
} from '@bugpilot/react-native';

// See Tallect: src/qa/BugPilotDevRoot.tsx — gated from App.tsx with __DEV__ only
<BugPilotProvider
  config={{
    apiUrl: process.env.EXPO_PUBLIC_BUGPILOT_API_URL ?? 'http://localhost:4000',
    projectId: process.env.EXPO_PUBLIC_BUGPILOT_PROJECT_ID ?? '<uuid>',
    getAccessToken: async () =>
      process.env.EXPO_PUBLIC_BUGPILOT_ACCESS_TOKEN?.trim() || null,
    enabled: __DEV__,
  }}
>
  {children}
  <FloatingBugButton />
</BugPilotProvider>
```

Optional: wrap key controls with `BugPilotWatch` / `BugPilot.watch({ testID, name })` (Track B testIDs later).

Flow: FAB → `SelectorMode` → capture root → `ReportForm` → `createIssue`.

## RN context (not DOM)

Prefer: `testID`, accessibility label/`nativeID`, opt-in `bugpilotName` via `BugPilotWatch`, React Navigation route, device metadata.  
Do **not** invent CSS/XPath. Do **not** rely on private Fiber APIs for v1.

## Non-goals

- Jelly install / vendor / source copy (PolyForm Shield)
- Maestro flows (Tallect Track B)
- bugPilot MCP server (Track C)
- Expo Go as the Tallect path (dev-client)

## Docs

- `docs/mobile-qa/TRACK_A_PHASE2.md` (this phase)
- `docs/mobile-qa/TRACK_A_PHASE1.md` (scaffold)
- `docs/mobile-qa/ARCHITECTURE.md`
- `docs/mobile-qa/REPORT_SCHEMA.md`
