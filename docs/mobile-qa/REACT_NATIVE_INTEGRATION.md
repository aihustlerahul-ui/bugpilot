# Using `@bugpilot/react-native` — integration guide

Add an in-app bug reporter to a React Native / Expo app. Testers tap a floating bug button, sign in
with their bugPilot account, tap any element, fill a short form, and the bug (with screen, element,
device and screenshot) lands in the bugPilot dashboard next to the issues reported from the Chrome
extension.

This guide covers: what you need first, installing the package, wiring the provider, the tester
flow, optional features, security notes, and troubleshooting. Reference for individual options is in
[`packages/react-native/README.md`](../../packages/react-native/README.md).

---

## 1. What you need first

| Requirement | Why |
| --- | --- |
| A running bugPilot backend (`backend/`, default `http://localhost:4000`) | The SDK talks to `/api/auth/login`, `/api/auth/refresh`, `/api/projects` and `/api/issues`. |
| `SUPABASE_ANON_KEY` set in the backend `.env` | Used by the backend's login endpoint (not shipped in the app). See `backend/.env.example`. |
| A bugPilot account for each tester, **added to a project by the project owner** | Owner: Projects → project → Members → add the tester's email. The tester gets an invite email, sets a password at `/accept-invite`, and then signs in from the app. Required Supabase settings: [AUTH_SETUP.md](./AUTH_SETUP.md). |
| React Native ≥ 0.73, React ≥ 18 | Peer dependencies. |
| Expo dev client or a bare RN app (not Expo Go) if you want screenshots | `react-native-view-shot` is a native module. |

Members can list their projects and file/read issues in them. Everything else (project settings,
integrations, changing issue status, managing the team) stays with the project owner.

## 2. Install

The package is private (not on npm). Install from a local path, a git URL or a packed tarball.

```bash
# from your app root — local path example
npm install --save "file:../path/to/bugPilot/packages/react-native"

# screenshots (recommended) and secure session storage (recommended)
npx expo install react-native-view-shot expo-secure-store
```

`react-native-view-shot` and `expo-secure-store` are **optional peers**: without the first there are
no screenshots (submit still works); without the second the session is kept in memory only (testers
sign in on every app launch). Both are native modules, so **rebuild your dev client** after adding
them (`npx expo run:ios` / `npx expo run:android`). A Metro reload is not enough.

### Metro with a `file:` link

When the package is linked from a path outside your app, Metro must watch that folder and resolve
the peers from your app. In `metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const bugpilotRoot = path.resolve(projectRoot, '../path/to/bugPilot/packages/react-native');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), bugpilotRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), ...(config.resolver.nodeModulesPaths ?? [])];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'react-native-view-shot': path.resolve(projectRoot, 'node_modules/react-native-view-shot'),
};
module.exports = config;
```

The package ships TypeScript source (`main: src/index.ts`); your app's Babel/Metro setup compiles it.

## 3. Wire the provider

Wrap your app tree once, near the root, **inside** your navigation container if you want the route
name in reports. Gate it so it never ships to end users.

```tsx
// src/qa/BugPilotRoot.tsx
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { BugPilotProvider, createSecureStoreAdapter } from '@bugpilot/react-native';
import { navigationRef } from '@/navigation/navigationRef'; // your React Navigation ref

const storage = createSecureStoreAdapter(SecureStore);

export function BugPilotRoot({ children }: { children: React.ReactNode }) {
  return (
    <BugPilotProvider
      config={{
        apiUrl: process.env.EXPO_PUBLIC_BUGPILOT_API_URL ?? 'http://localhost:4000',
        storage,                                   // omit → memory only
        appVersion: Constants.expoConfig?.version, // shown in the form, sent to the dashboard
        getRouteName: () => navigationRef.getCurrentRoute()?.name,
        getRouteParams: () => navigationRef.getCurrentRoute()?.params as Record<string, unknown> | undefined,
        enabled: __DEV__,                          // or a QA-flavour flag
      }}
    >
      {children}
    </BugPilotProvider>
  );
}
```

```tsx
// App.tsx
const Root = __DEV__ ? BugPilotRoot : React.Fragment; // or your own QA-build flag
export default function App() {
  return <Root><AppNavigator /></Root>;
}
```

Notes:
- `apiUrl` on a physical device must be reachable from the phone (use your machine's LAN IP, not
  `localhost`). The iOS simulator reaches the host's `localhost` directly.
- The provider wraps your children in a capturable view for screenshots and renders the floating
  button, sign-in sheet, project bar and report form itself, **outside** the screenshot root, so they
  never appear in screenshots.
- The auth client and storage are created once at first render. To change `apiUrl` or `storage`,
  remount the provider.

### Config reference

| Key | Required | Meaning |
| --- | --- | --- |
| `apiUrl` | yes | Backend origin. |
| `storage` | no | Session persistence. `createSecureStoreAdapter(SecureStore)` or any `{ getItem, setItem, removeItem }`. Default: memory. |
| `appVersion` | no | Shown in the form; sent as `browser_info.appVersion`. |
| `projectId` | no | Lock the build to one project (skips the picker). If the signed-in user cannot access it, the picker opens with an error. |
| `enabled` | no | Overlay gate; defaults to `__DEV__`. |
| `getAccessToken` | no | CI/automation override that bypasses the sign-in sheet. Return a valid user access token; it is asked again after a 401. Never ship a real token. |
| `getRouteName`, `getRouteParams` | no | Navigation snapshot attached to the report. |
| `screenshotCapture` | no | Custom screenshot backend (tests or hosts without view-shot). |

## 4. What the tester sees

1. **Tap the bug button** → if signed out, a sign-in sheet asks for the email and password of their
   bugPilot account.
2. **Signed in** → a top bar shows the current project (tap to switch), the signed-in email and
   *Sign out*, above the banner "Tap a UI region to report a bug". If the tester has no projects:
   "No projects shared with you yet" (ask the project owner to add them).
3. **Tap an element** → the report form opens with the project, a smart input, title, description,
   expected/actual result and severity, plus an auto-attached summary: screen/route, element
   (`testID` / label / size), device, OS, app version and screenshot status.
4. **Submit** → the bug appears in the dashboard under the chosen project, marked *Mobile*, with
   device, screen and element details. On a network error the form keeps what was typed and shows
   *Retry*. An expired session refreshes silently; if refresh is rejected the tester is asked to sign
   in again and the draft is kept.

Sessions persist across launches when `storage` is a secure store. *Sign out* clears the session.

## 5. Making elements easy to identify

The selector finds the element under the tap from registered bounds, not from React internals.
Reports are only as good as the identifiers your app exposes:

- Give interactive controls a stable **`testID`** (also used by Maestro/Detox) and an
  **`accessibilityLabel`**.
- Optionally wrap a control with **`BugPilotWatch`** to register it for hit-testing and give it a
  human-readable name:

```tsx
import { BugPilotWatch } from '@bugpilot/react-native';

<BugPilotWatch testID="checkout-pay" name="Pay button">
  <Pressable onPress={pay}><Text>Pay</Text></Pressable>
</BugPilotWatch>
```

If a tap hits nothing registered, the report falls back to the tap coordinates and the current
screen, so a bug can always be filed.

## 6. Own button / manual trigger

Pass `floatingButton={false}` to the provider and call the hook from your own control:

```tsx
const { startCapture, signOut, session } = useBugPilot();
<Button title="Report a bug" onPress={startCapture} />   // sign-in sheet if signed out, else selector
```

`openSelector()` is an alias of `startCapture()`.

## 7. CI / automation

For Maestro or CI runs where nobody can type a password, set `getAccessToken` to return a valid
access token from your environment (for example `EXPO_PUBLIC_BUGPILOT_ACCESS_TOKEN`, gitignored,
never committed) and lock a project with `projectId`. The sign-in sheet is bypassed. Use a test
account, not a personal one.

## 8. Security notes

- The app never holds the Supabase service-role key, and does not need the Supabase URL or anon key:
  login goes through the backend (`/api/auth/login`, rate limited).
- Passwords and tokens are never logged by the SDK. The session is stored in secure storage if you
  pass it; memory otherwise.
- Keep the overlay out of release builds: gate on `__DEV__` or a QA flavour. The SDK itself only
  renders when `enabled` is true.
- Screenshots may contain personal data shown on screen. Use test data on QA builds.
- Behind a proxy, set `TRUST_PROXY` on the backend so login rate limits apply per client (see
  `backend/.env.example`).

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Button doesn't appear | `enabled` is false (release build / `__DEV__` off), or the provider isn't mounted above the screens. |
| "Sign-in failed" / invalid credentials | Wrong password, tester not invited/confirmed yet (check the invite email or use *Forgot password* on the platform login page), or the backend lacks `SUPABASE_ANON_KEY`. |
| "Too many attempts. Try again in a minute." | Login rate limit (5/min per email+IP, 30/min per IP). |
| "No projects shared with you yet" | The tester's confirmed email isn't on any project's member list. The owner must add the exact address. |
| Network error on a device | `apiUrl` points to `localhost`; use a LAN IP or tunnel. iOS App Transport Security / Android cleartext rules apply to plain `http://` in non-dev builds. |
| No screenshot in the report | `react-native-view-shot` not installed or the dev client wasn't rebuilt after installing it. |
| Hit on the wrong element / only coordinates | The control has no `testID` or `BugPilotWatch` registration. |
| Type errors from `node_modules/@bugpilot/...` | Your tsconfig is stricter than the package expects; open an issue — the package already compiles under `strict`, `noImplicitOverride` and `noUncheckedIndexedAccess`. |
| Session lost every launch | No `storage` given (memory only) or secure store unavailable. |

## 10. Verifying an integration

1. Backend and platform running; an owner account has a project with the tester's email as a member.
2. Open the app (dev client), tap the bug button, sign in as the tester.
3. Pick the project, tap an element, submit.
4. In the dashboard open that project: the issue should show the *Mobile* badge, screen, element,
   device/OS/app version and the screenshot. The owner can open it; the tester can see it in the
   same project.
