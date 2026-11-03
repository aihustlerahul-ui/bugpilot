import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const host = (name: string) => name;
  return {
    View: host('View'),
    Text: host('Text'),
    TextInput: host('TextInput'),
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    Modal: host('Modal'),
    ActivityIndicator: host('ActivityIndicator'),
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    StyleSheet: { create: <T,>(s: T) => s, hairlineWidth: 1 },
    Platform: { OS: 'ios', Version: '17.4' },
  };
});

import { BugPilotProvider } from '../BugPilotProvider';
import { useBugPilot } from '../BugPilotContext';
import { createMemoryAdapter } from '../auth/SessionStore';
import { noopScreenshotCapture } from '../screenshot/ScreenshotCapture';
import type { BugPilotConfig, BugPilotContextValue } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECTS = [
  { id: 'p1', name: 'One' },
  { id: 'p2', name: 'Two' },
];

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let ctx: BugPilotContextValue | null = null;

function Probe() {
  ctx = useBugPilot();
  return null;
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(() => r(), 0));
    });
  }
}

async function renderProvider(over: Partial<BugPilotConfig>, signedIn: boolean) {
  const storage = createMemoryAdapter();
  if (signedIn) {
    await storage.setItem(
      'bugpilot.session',
      JSON.stringify({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'u1', email: 'qa@example.com' },
      }),
    );
  }
  const config: BugPilotConfig = {
    apiUrl: 'http://api.test',
    enabled: true,
    storage,
    screenshotCapture: noopScreenshotCapture,
    ...over,
  };
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(
      <BugPilotProvider config={config} floatingButton={false}>
        <Probe />
      </BugPilotProvider>,
    );
  });
  await flush();
  return renderer!;
}

const projectCalls = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/projects'));

describe('BugPilotProvider openSelector (host-owned button)', () => {
  beforeEach(() => {
    ctx = null;
    fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/api/projects') ? json(200, PROJECTS) : json(404, {}),
    );
    vi.stubGlobal('fetch', fetchMock);
    // Overlay render noise (lazy require / host strings) is not under test.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('signed in: enters selector mode and loads projects', async () => {
    const r = await renderProvider({}, true);
    expect(projectCalls()).toHaveLength(0); // lazy: nothing before first use
    await act(async () => ctx!.openSelector());
    await flush();
    expect(ctx!.mode).toBe('selecting');
    expect(projectCalls()).toHaveLength(1);
    expect(projectCalls()[0][1].headers.Authorization).toBe('Bearer tok');
    expect(ctx!.projects.status).toBe('ready');
    expect(ctx!.projects.projects).toEqual(PROJECTS);
    act(() => r.unmount());
  });

  it('signed in with a locked projectId: selects and locks it', async () => {
    const r = await renderProvider({ projectId: 'p2' }, true);
    await act(async () => ctx!.openSelector());
    await flush();
    expect(ctx!.projectId).toBe('p2');
    expect(ctx!.projectLocked).toBe(true);
    act(() => r.unmount());
  });

  it('signed out: opens the sign-in sheet and loads nothing', async () => {
    const r = await renderProvider({}, false);
    await act(async () => ctx!.openSelector());
    await flush();
    expect(ctx!.mode).toBe('signin');
    expect(projectCalls()).toHaveLength(0);
    act(() => r.unmount());
  });

  it('locked project the user cannot access: error clears after a valid pick', async () => {
    const r = await renderProvider({ projectId: 'zzz' }, true);
    await act(async () => ctx!.openSelector());
    await flush();
    expect(ctx!.projectId).toBeNull();
    expect(ctx!.projects.error).toBeTruthy();
    await act(async () => ctx!.setProjectId('p1'));
    expect(ctx!.projectId).toBe('p1');
    expect(ctx!.projects.error).toBeNull();
    act(() => r.unmount());
  });
});
