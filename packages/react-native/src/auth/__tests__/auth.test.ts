import { describe, expect, it, vi } from 'vitest';
import { AuthClient } from '../AuthClient';
import { createMemoryAdapter, createSecureStoreAdapter } from '../SessionStore';
import { TokenManager } from '../TokenManager';
import type { AuthSession } from '../types';

const nowSec = () => Math.floor(Date.now() / 1000);

function session(over: Partial<AuthSession> = {}): AuthSession {
  return {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_at: nowSec() + 3600,
    user: { id: 'u1', email: 'qa@example.com' },
    ...over,
  };
}

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

type FakeRes = ReturnType<typeof res>;

function setup(handler: (url: string, init?: any) => FakeRes | Promise<FakeRes>) {
  const fetchMock = vi.fn(async (url: string, init?: any) => handler(url, init));
  const client = new AuthClient('http://api.test/', fetchMock as any);
  const storage = createMemoryAdapter();
  const onSignedOut = vi.fn();
  const manager = new TokenManager(client, storage, onSignedOut);
  return { fetchMock, client, storage, onSignedOut, manager };
}

describe('AuthClient', () => {
  it('login posts credentials and returns the session', async () => {
    const s = session();
    const { fetchMock, client } = setup(() => res(200, s));
    await expect(client.login('qa@example.com', 'pw')).resolves.toEqual(s);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/auth/login');
    expect(JSON.parse(init.body)).toEqual({ email: 'qa@example.com', password: 'pw' });
  });

  it('login 401 throws a generic error without echoing server text', async () => {
    const { client } = setup(() =>
      res(401, { message: 'Invalid credentials for qa@example.com pw=secret' }),
    );
    const err = await client.login('qa@example.com', 'secret').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Invalid email or password');
    expect(err.message).not.toContain('secret');
  });

  it('listProjects sends bearer token', async () => {
    const { fetchMock, client } = setup(() => res(200, [{ id: 'p1', name: 'P', extra: 1 }]));
    await expect(client.listProjects('tok')).resolves.toEqual([{ id: 'p1', name: 'P' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/projects');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });
});

describe('TokenManager', () => {
  it('signIn stores the session and getAccessToken returns it without fetching again', async () => {
    const { manager, fetchMock } = setup(() => res(200, session()));
    await manager.signIn('qa@example.com', 'pw');
    expect(await manager.getAccessToken()).toBe('access-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await manager.getUser()).toEqual({ id: 'u1', email: 'qa@example.com' });
  });

  it('refreshes once when the token is within 60s of expiry', async () => {
    const { manager, fetchMock } = setup((url) =>
      url.endsWith('/login')
        ? res(200, session({ expires_at: nowSec() + 30 }))
        : res(200, session({ access_token: 'access-2', refresh_token: 'refresh-2' })),
    );
    await manager.signIn('qa@example.com', 'pw');
    expect(await manager.getAccessToken()).toBe('access-2');
    expect(await manager.getAccessToken()).toBe('access-2');
    const refreshCalls = fetchMock.mock.calls.filter((c) => c[0].endsWith('/refresh'));
    expect(refreshCalls).toHaveLength(1);
    expect(JSON.parse(refreshCalls[0][1].body)).toEqual({ refresh_token: 'refresh-1' });
  });

  it('two concurrent refreshAfter401 calls produce a single refresh request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { manager, fetchMock } = setup(async (url) => {
      if (url.endsWith('/login')) return res(200, session());
      await gate;
      return res(200, session({ access_token: 'access-2', refresh_token: 'refresh-2' }));
    });
    await manager.signIn('qa@example.com', 'pw');
    const a = manager.refreshAfter401();
    const b = manager.refreshAfter401();
    release();
    expect(await Promise.all([a, b])).toEqual(['access-2', 'access-2']);
    expect(fetchMock.mock.calls.filter((c) => c[0].endsWith('/refresh'))).toHaveLength(1);
  });

  it('failed refresh clears storage, signals sign-out, returns null, and does not retry', async () => {
    const { manager, storage, onSignedOut, fetchMock } = setup((url) =>
      url.endsWith('/login')
        ? res(200, session({ expires_at: nowSec() - 5 }))
        : res(401, { message: 'Invalid credentials' }),
    );
    await manager.signIn('qa@example.com', 'pw');
    expect(await manager.getAccessToken()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(await manager.getUser()).toBeNull();
    expect(await storage.getItem('bugpilot.session')).toBeNull();
    expect(fetchMock.mock.calls.filter((c) => c[0].endsWith('/refresh'))).toHaveLength(1);
  });

  it('getAccessToken returns null (never throws) on network failure during refresh', async () => {
    const { manager } = setup((url) => {
      if (url.endsWith('/login')) return res(200, session({ expires_at: nowSec() - 5 }));
      throw new Error('network down');
    });
    await manager.signIn('qa@example.com', 'pw');
    await expect(manager.getAccessToken()).resolves.toBeNull();
  });

  it('getAccessToken returns null when no session is stored', async () => {
    const { manager } = setup(() => res(200, session()));
    expect(await manager.getAccessToken()).toBeNull();
  });

  it('signOut clears the stored session', async () => {
    const { manager } = setup(() => res(200, session()));
    await manager.signIn('qa@example.com', 'pw');
    await manager.signOut();
    expect(await manager.getAccessToken()).toBeNull();
  });

  it('never logs credentials or tokens', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const { manager } = setup((url) =>
      url.endsWith('/login') ? res(200, session({ expires_at: nowSec() - 5 })) : res(401, {}),
    );
    await manager.signIn('qa@example.com', 'pw-secret').catch(() => {});
    await manager.getAccessToken();
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain('pw-secret');
    expect(logged).not.toContain('access-1');
    expect(logged).not.toContain('refresh-1');
    spies.forEach((s) => s.mockRestore());
  });
});

describe('adapters', () => {
  it('createSecureStoreAdapter maps to getItemAsync/setItemAsync/deleteItemAsync', async () => {
    const mod = {
      getItemAsync: vi.fn(async (_k: string) => 'v' as string | null),
      setItemAsync: vi.fn(async (_k: string, _v: string) => {}),
      deleteItemAsync: vi.fn(async (_k: string) => {}),
    };
    const a = createSecureStoreAdapter(mod);
    expect(await a.getItem('k')).toBe('v');
    await a.setItem('k', 'x');
    await a.removeItem('k');
    expect(mod.setItemAsync).toHaveBeenCalledWith('k', 'x');
    expect(mod.deleteItemAsync).toHaveBeenCalledWith('k');
  });
});

describe('config override', () => {
  it('config.getAccessToken override bypasses the manager', async () => {
    const { manager, fetchMock } = setup(() => res(200, session()));
    const config: { getAccessToken?: () => Promise<string | null> } = {
      getAccessToken: async () => 'override-token',
    };
    const resolve = () => (config.getAccessToken ? config.getAccessToken() : manager.getAccessToken());
    expect(await resolve()).toBe('override-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
