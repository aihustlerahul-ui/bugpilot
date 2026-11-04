'use client'
import { useState } from 'react'
import { CheckIcon } from '@/components/Icons'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

const INSTALL = `# from your app root: install the package from a local path
npm install --save "file:../path/to/bugPilot/packages/react-native"

# screenshots + secure session storage (recommended)
npx expo install react-native-view-shot expo-secure-store

# both are native modules: rebuild your dev client
npx expo run:ios   # or: npx expo run:android`

const PROVIDER = `// src/qa/BugPilotRoot.tsx
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { BugPilotProvider, createSecureStoreAdapter } from '@bugpilot/react-native';
import { navigationRef } from '@/navigation/navigationRef'; // your React Navigation ref

const storage = createSecureStoreAdapter(SecureStore);

export function BugPilotRoot({ children }: { children: React.ReactNode }) {
  return (
    <BugPilotProvider
      config={{
        apiUrl: process.env.EXPO_PUBLIC_BUGPILOT_API_URL ?? '${API_URL}',
        storage,
        appVersion: Constants.expoConfig?.version,
        getRouteName: () => navigationRef.getCurrentRoute()?.name,
        enabled: __DEV__, // or a QA-build flag; never ship to end users
      }}
    >
      {children}
    </BugPilotProvider>
  );
}`

const APP = `// App.tsx
const Root = __DEV__ ? BugPilotRoot : React.Fragment;
export default function App() {
  return <Root><AppNavigator /></Root>;
}`

const WATCH = `import { BugPilotWatch } from '@bugpilot/react-native';

<BugPilotWatch testID="checkout-pay" name="Pay button">
  <Pressable onPress={pay}><Text>Pay</Text></Pressable>
</BugPilotWatch>`

const TROUBLE: Array<[string, string]> = [
  ['Button doesn’t appear', 'The overlay is off (release build, or __DEV__ is false), or the provider isn’t mounted above your screens.'],
  ['Sign-in failed', 'Wrong password, or the tester hasn’t accepted their invite yet. Use “Forgot password” on the login page.'],
  ['No projects shared with you yet', 'The tester’s confirmed email isn’t on any project. Add that exact address on the project’s Members tab.'],
  ['Network error on a phone', 'apiUrl points to localhost. A physical device needs your computer’s LAN IP or a tunnel. The iOS simulator can use localhost.'],
  ['No screenshot on the report', 'react-native-view-shot isn’t installed, or the dev client wasn’t rebuilt after installing it.'],
  ['Report shows only coordinates', 'The tapped control has no testID or BugPilotWatch. Add one so the element is named in the report.'],
]

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(children)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            /* clipboard unavailable */
          }
        }}
        className="absolute right-2 top-2 rounded-md bg-gray-700 px-2 py-1 text-[11px] font-medium text-gray-100 hover:bg-gray-600"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-4 pr-16 overflow-x-auto">{children}</pre>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <h2 className="flex items-center gap-2.5 text-base font-semibold text-gray-900">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
          {n}
        </span>
        {title}
      </h2>
      <div className="space-y-3 text-sm text-gray-600 leading-relaxed">{children}</div>
    </section>
  )
}

export default function MobilePage() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mobile bug reporter</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add an in-app reporter to a React Native / Expo app. Testers tap a floating bug button, sign in, tap any
          element, fill a short form, and the bug (screen, element, device and screenshot) appears in this dashboard
          next to bugs from the Chrome extension.
        </p>
      </div>

      <Step n={1} title="Before you start">
        <ul className="list-disc pl-5 space-y-1">
          <li>The BugPilot backend is running and reachable from the phone (default <code>{API_URL}</code>).</li>
          <li>
            Each tester has a BugPilot account and is <b>added to a project</b>: open the project, go to the{' '}
            <b>Members</b> tab and add their email. They get an invite email, set a password, then sign in from the app.
          </li>
          <li>React Native 0.73+ and React 18+. Use an Expo dev client or a bare app (not Expo Go) if you want screenshots.</li>
        </ul>
      </Step>

      <Step n={2} title="Install the package">
        <p>The package is private, so install it from a local path, git URL or packed tarball.</p>
        <Code>{INSTALL}</Code>
        <p>
          Without <code>react-native-view-shot</code> there are no screenshots; without <code>expo-secure-store</code>{' '}
          testers sign in on every launch.
        </p>
      </Step>

      <Step n={3} title="Add the provider">
        <p>Wrap your app once, near the root, and keep it out of release builds.</p>
        <Code>{PROVIDER}</Code>
        <Code>{APP}</Code>
        <p>
          On a physical phone, <code>apiUrl</code> must be an address the phone can reach (your computer&apos;s LAN IP),
          not <code>localhost</code>.
        </p>
      </Step>

      <Step n={4} title="What testers do">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Tap the floating bug button. If signed out, sign in with their BugPilot email and password.</li>
          <li>Pick a project from the bar at the top, then tap the part of the screen with the problem.</li>
          <li>Fill in the title, description, expected and actual result, and severity. Screen, device, OS, app version and screenshot attach automatically.</li>
          <li>Submit. The bug shows up in that project here with a <b>Mobile</b> badge.</li>
        </ol>
        <p>If the network drops, the form keeps what was typed and offers Retry.</p>
      </Step>

      <Step n={5} title="Make elements easy to identify">
        <p>Give controls a stable <code>testID</code> and an <code>accessibilityLabel</code>. To register one explicitly:</p>
        <Code>{WATCH}</Code>
      </Step>

      <Step n={6} title="Check it works">
        <ul className="space-y-1.5">
          {[
            'Open the app, tap the bug button and sign in as a tester.',
            'Pick the project, tap an element and submit.',
            'Open that project in this dashboard: the issue shows the Mobile badge, screen, element, device and screenshot.',
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Step>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Troubleshooting</h2>
        <dl className="mt-3 divide-y divide-gray-100 text-sm">
          {TROUBLE.map(([problem, fix]) => (
            <div key={problem} className="py-2.5">
              <dt className="font-medium text-gray-900">{problem}</dt>
              <dd className="mt-0.5 text-gray-600">{fix}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-xs text-gray-400">
        Security: the app never holds server keys, and login goes through the backend. Screenshots can contain personal
        data shown on screen, so use test data in QA builds.
      </p>
    </div>
  )
}
