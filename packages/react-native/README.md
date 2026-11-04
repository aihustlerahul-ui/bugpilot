# `@bugpilot/react-native`

In-app bug reporter for React Native / Expo.

Parity target: Chrome extension UX (activate → select element → form → `POST /api/issues`), adapted for mobile:

1. **Free-floating icon** (FAB)
2. Enables **selector mode** (highlight + registry hit-test)
3. **On-device form** (Smart + Standard fields; smart defaults from selection)
4. Auto context + optional screenshot → submit

**Not** “edit only after upload.”

## Status

| Item | State |
| --- | --- |
| FAB → selector → form → `createIssue` | Phase 2 wired |
| Selector highlight + `BugPilotWatch` registry | Phase 2 |
| Screenshot adapter (`react-native-view-shot`) | Optional peer + adapter |
| Auth | In-SDK sign-in sheet (bugPilot email + password); session persisted via `storage`; `getAccessToken` override for CI |
| Projects | Picker after sign-in (last choice remembered per user); optional `projectId` lock |
| Published to npm | **No** — local path / private package |

## Screenshot approach

**Primary (recommended for Expo / expo-dev-client):** peer dependency **`react-native-view-shot`**.

- `BugPilotProvider` wraps children in a root `View` ref.
- `ViewShotScreenshotAdapter` calls `captureRef` → base64 PNG (no data-URL prefix).
- In-app UI capture is annotation-friendly (subtree, not whole OS display).

**Alternative (not implemented):** `expo-screen-capture` for full display pixels — less ideal for marking a React subtree.

**Fallback:** `noopScreenshotCapture` when the peer is missing (one `__DEV__` warning). Submit still works without a screenshot.

### Install in a host app

```bash
npx expo install react-native-view-shot expo-secure-store
npm install --save "file:<path-to-bugPilot>/packages/react-native"
npx expo run:ios   # or run:android — Metro reload is not enough
```

expo-dev-client only — not Expo Go. See `docs/mobile-qa/REACT_NATIVE_INTEGRATION.md`.

## Usage

```tsx
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { BugPilotProvider, createSecureStoreAdapter } from '@bugpilot/react-native';

// Gate with __DEV__ (or a QA build flag) so release builds never ship the overlay
<BugPilotProvider
  config={{
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
| `apiUrl` | Optional. Defaults to the hosted bugPilot API; set only to self-host or use a local backend (e.g. `http://localhost:4000`). |
| `storage` | Session persistence (`StorageAdapter`), e.g. `createSecureStoreAdapter(SecureStore)`. Default: memory. `expo-secure-store` is an optional peer; the host passes it in. |
| `appVersion` | Host app version, shown in the form and sent as `browser_info.appVersion`. |
| `projectId` | Locks the project for this build. If the signed-in user can't access it, the picker opens with an error. |
| `enabled` | Overlay gate; defaults to `__DEV__`. Pass `true` for QA builds. |
| `getAccessToken` | Override for CI / automated runs: bypasses the sign-in session (no sheet). On a 401 it is asked again. |
| `getRouteName` / `getRouteParams` | Navigation snapshot for the report. |
| `screenshotCapture` | Custom screenshot backend (tests / non-view-shot hosts). |
| `context` | Extra context attached to every report — see **Context pack** below. `false` turns it all off. |

`AuthClient`, `TokenManager` and storage are built **once** on first render;
changing `apiUrl` or `storage` later has no effect (remount the provider instead).

### Tester flow

1. Tap the bug button. Signed out → **sign-in sheet** (email + password of the bugPilot account the admin invited).
2. Signed in → top bar with **project** (tap to change), email and **Sign out**, above the "Tap a UI region" banner. No shared projects → "No projects shared with you yet".
3. Tap an element → **report form**: project, smart input, title, description, expected/actual, severity, and an auto-attached summary (screen, element, device/OS/app version, screenshot).
4. Submit uses the session token; on a 401 it refreshes once and retries. On failure the form keeps its content and shows **Retry**. A rejected refresh signs the user out and asks them to sign in again (the draft is kept).

Auth requests time out after 15 s and the issue POST after 60 s. Passwords and tokens are never logged.

Optional: wrap key controls with `BugPilotWatch` / `BugPilot.watch({ testID, name })` .

Flow: FAB → (sign-in) → `SelectorMode` + `ProjectBar` → capture root → `ReportForm` → `submitIssue`.

## Context pack (what each report carries)

Besides the screen, selected element and screenshot, each report includes
privacy-filtered context so a developer can reproduce the bug without asking:

| Group | Content | Default | Dashboard view |
| --- | --- | --- | --- |
| `device` | model, brand, OS/API level, screen size + pixel ratio, orientation, font scale, dark mode, locale/timezone, JS engine, debug vs release, bundle id + build (needs `expo-application`), connectivity (`@react-native-community/netinfo`), battery (`expo-battery`), OTA update id (`expo-updates`) | on | Mobile info card |
| `logs` | last `console.error` / `console.warn` and uncaught JS errors | on | Console tab |
| `network` | last requests: method, URL with query *values* redacted, status, duration | on | Network tab |
| `journey` | last screens visited and taps (testID / name + coordinates) | on | Flight Recorder tab |
| `filmstrip` | last few low-res screenshots (default every 2 s, 5 frames, 360 px) | **off** | Screenshots tab |
| `getExtraContext()` | host app state (flags, role, tenant…) | — | Mobile info card |

```tsx
config={{
  context: {
    filmstrip: true, // opt in: rolling screenshots
    maxRequests: 30,
    getExtraContext: () => ({ plan: user.plan, flags: flags.enabledKeys }),
  },
}}
```

Privacy: request/response **bodies and headers are never captured**; typed input
values are never captured (taps record only the matched testID/name); bearer
tokens and JWTs are scrubbed from log text; keys that look sensitive
(`password`, `token`, `secret`, `auth`, `cookie`, `key`…) are redacted from
`getExtraContext`. Requests to the BugPilot API itself are excluded. The buffers
run only while the overlay is enabled (`__DEV__` / QA builds). The optional
modules above are loaded only if the host already has them — no new native
dependency is required.

There is no DOM, so web-style rrweb session replay does not apply; the
journey + logs + network trail and the optional filmstrip are the mobile
equivalent. A real screen recording would need native recorders and is not
included.

Element crops: a screenshot of just the tapped element is attached for views
wrapped in `BugPilotWatch` (it needs the view ref). Other taps keep the
full-screen capture.

## RN context (not DOM)

Prefer: `testID`, accessibility label/`nativeID`, opt-in `bugpilotName` via `BugPilotWatch`, React Navigation route, device metadata.  
Do **not** invent CSS/XPath. Do **not** rely on private Fiber APIs for v1.

## Non-goals

- Expo Go (dev-client only)

## Docs

- `docs/mobile-qa/REACT_NATIVE_INTEGRATION.md` — **how to integrate and use this package**
- `docs/mobile-qa/AUTH_SETUP.md` — required Supabase settings for tester sign-in
- `docs/mobile-qa/REPORT_SCHEMA.md`
