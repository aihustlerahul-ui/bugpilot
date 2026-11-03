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
| Auth | In-SDK sign-in sheet (bugPilot email + password); session persisted via `storage`; `getAccessToken` override for CI |
| Projects | Picker after sign-in (last choice remembered per user); optional `projectId` lock |
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
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { BugPilotProvider, createSecureStoreAdapter } from '@bugpilot/react-native';

// See Tallect: src/qa/BugPilotDevRoot.tsx — gated from App.tsx with __DEV__ only
<BugPilotProvider
  config={{
    apiUrl: process.env.EXPO_PUBLIC_BUGPILOT_API_URL ?? 'http://localhost:4000',
    storage: createSecureStoreAdapter(SecureStore), // omit → memory (sign in each launch)
    appVersion: Constants.expoConfig?.version,
    enabled: __DEV__,
  }}
>
  {children}
</BugPilotProvider>
```

The provider renders the floating bug button itself (outside the screenshot root).
Pass `floatingButton={false}` to use your own button and call
`useBugPilot().openSelector()` (same as `startCapture()`): it opens the sign-in
sheet when signed out, otherwise selector mode, and loads the project list.

### Config keys

| Key | Meaning |
| --- | --- |
| `apiUrl` | Nest API origin (required). Login/refresh go through `POST /api/auth/login` and `/api/auth/refresh`. |
| `storage` | Session persistence (`StorageAdapter`), e.g. `createSecureStoreAdapter(SecureStore)`. Default: memory. `expo-secure-store` is an optional peer; the host passes it in. |
| `appVersion` | Host app version, shown in the form and sent as `browser_info.appVersion`. |
| `projectId` | Locks the project for this build. If the signed-in user can't access it, the picker opens with an error. |
| `enabled` | Overlay gate; defaults to `__DEV__`. Pass `true` for QA builds. |
| `getAccessToken` | Override for CI / Maestro: bypasses the sign-in session (no sheet). On a 401 it is asked again. |
| `getRouteName` / `getRouteParams` | Navigation snapshot for the report. |
| `screenshotCapture` | Custom screenshot backend (tests / non-view-shot hosts). |

`AuthClient`, `TokenManager` and storage are built **once** on first render;
changing `apiUrl` or `storage` later has no effect (remount the provider instead).

### Tester flow

1. Tap the bug button. Signed out → **sign-in sheet** (email + password of the bugPilot account the admin invited).
2. Signed in → top bar with **project** (tap to change), email and **Sign out**, above the "Tap a UI region" banner. No shared projects → "No projects shared with you yet".
3. Tap an element → **report form**: project, smart input, title, description, expected/actual, severity, and an auto-attached summary (screen, element, device/OS/app version, screenshot).
4. Submit uses the session token; on a 401 it refreshes once and retries. On failure the form keeps its content and shows **Retry**. A rejected refresh signs the user out and asks them to sign in again (the draft is kept).

Auth requests time out after 15 s and the issue POST after 60 s. Passwords and tokens are never logged.

Optional: wrap key controls with `BugPilotWatch` / `BugPilot.watch({ testID, name })` (Track B testIDs later).

Flow: FAB → (sign-in) → `SelectorMode` + `ProjectBar` → capture root → `ReportForm` → `submitIssue`.

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
