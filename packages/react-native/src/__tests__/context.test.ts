import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleCapture } from '../context/ConsoleCapture';
import { ContextCollector } from '../context/ContextCollector';
import { collectDeviceInfo } from '../context/deviceInfo';
import { Filmstrip } from '../context/Filmstrip';
import { JourneyCapture } from '../context/JourneyCapture';
import { NetworkCapture } from '../context/NetworkCapture';
import { formatLogArgs, redactExtra, RingBuffer, sanitizeUrl, scrubText } from '../context/sanitize';
import { buildCreateIssuePayload } from '../api/createIssue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('sanitize', () => {
  it('ring buffer keeps only the newest entries', () => {
    const b = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => b.push(n));
    expect(b.toArray()).toEqual([3, 4, 5]);
  });

  it('scrubs bearer tokens and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
    const out = scrubText(`Authorization: Bearer ${jwt} and ${jwt}`);
    expect(out).not.toContain('eyJ');
    expect(out).toContain('Bearer [redacted]');
  });

  it('drops credentials, fragments and query values from URLs but keeps keys', () => {
    expect(sanitizeUrl('https://u:p@api.test/v1/items?token=abc&page=2#frag')).toBe(
      'https://api.test/v1/items?token=***&page=***',
    );
    expect(sanitizeUrl('https://api.test/v1/items')).toBe('https://api.test/v1/items');
  });

  it('formats errors with a short stack and objects as JSON', () => {
    const e = new Error('boom');
    expect(formatLogArgs([e])).toContain('Error: boom');
    expect(formatLogArgs(['a', { b: 1 }])).toBe('a {"b":1}');
  });

  it('redacts sensitive keys in host extra context and caps its size', () => {
    const out = redactExtra({ plan: 'pro', password: 'x', nested: { apiKey: 'k', ok: 1 } });
    expect(out).toEqual({ plan: 'pro', password: '[redacted]', nested: { apiKey: '[redacted]', ok: 1 } });
    expect(redactExtra({ big: 'x'.repeat(20000).split('').join(' ') }, 100)).toEqual({ _truncated: true });
    expect(redactExtra(undefined)).toBeUndefined();
  });
});

describe('ConsoleCapture', () => {
  it('records errors/warnings, still calls the originals, and restores on stop', () => {
    const orig = { error: vi.fn(), warn: vi.fn() };
    const fake = { ...orig } as { error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
    let handler: ((e: unknown, fatal?: boolean) => void) | undefined;
    const prevHandler = vi.fn();
    handler = prevHandler;
    const errorUtils = {
      getGlobalHandler: () => handler!,
      setGlobalHandler: (h: (e: unknown, f?: boolean) => void) => {
        handler = h;
      },
    };
    const cap = new ConsoleCapture(2, { console: fake, errorUtils });
    cap.start();
    fake.error('first', 1);
    fake.warn('second');
    fake.error('third');
    handler!(new Error('crash'), true);

    expect(orig.error).toHaveBeenCalledWith('first', 1);
    const snap = cap.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0]).toMatchObject({ level: 'error', message: 'third' });
    expect(snap[1].message).toContain('Uncaught (fatal): Error: crash');
    expect(prevHandler).toHaveBeenCalled();

    cap.stop();
    expect(fake.error).toBe(orig.error);
    expect(handler).toBe(prevHandler);
  });

  it('never throws into the host when formatting fails', () => {
    const fake = { error: vi.fn(), warn: vi.fn() };
    const cap = new ConsoleCapture(5, { console: fake });
    cap.start();
    const bad = {
      toJSON() {
        throw new Error('nope');
      },
    };
    expect(() => fake.error(bad)).not.toThrow();
  });
});

describe('NetworkCapture', () => {
  function makeXhr() {
    const listeners: Record<string, () => void> = {};
    const proto = {
      open: vi.fn(),
      send: vi.fn(),
    };
    const xhr = Object.assign(Object.create(proto), {
      status: 500,
      addEventListener: (t: string, cb: () => void) => {
        listeners[t] = cb;
      },
    });
    return { proto, xhr, listeners };
  }

  it('records method, redacted URL, status and duration via XHR (no bodies/headers)', () => {
    const { proto, xhr, listeners } = makeXhr();
    const cap = new NetworkCapture(5, 'https://bugpilot.test', { xhrProto: proto as never });
    cap.start();
    proto.open.call(xhr, 'post', 'https://shop.test/cart?token=abc', true);
    proto.send.call(xhr, '{"card":"4111"}');
    vi.advanceTimersByTime(120);
    listeners.loadend();
    const [e] = cap.snapshot();
    expect(e).toMatchObject({ method: 'POST', url: 'https://shop.test/cart?token=***', status: 500 });
    expect(e.duration).toBeGreaterThanOrEqual(100);
    expect(JSON.stringify(e)).not.toContain('4111');
  });

  it("ignores BugPilot's own API", () => {
    const { proto, xhr, listeners } = makeXhr();
    const cap = new NetworkCapture(5, 'https://bugpilot.test', { xhrProto: proto as never });
    cap.start();
    proto.open.call(xhr, 'POST', 'https://bugpilot.test/api/issues', true);
    proto.send.call(xhr);
    listeners.loadend();
    expect(cap.snapshot()).toHaveLength(0);
  });

  it('falls back to patching fetch when XHR is unavailable, and restores it', async () => {
    const realFetch = vi.fn(async () => ({ status: 404 }));
    const g = globalThis as { fetch?: unknown };
    const saved = g.fetch;
    g.fetch = realFetch;
    try {
      const cap = new NetworkCapture(5, null, { fetch: realFetch as never });
      cap.start();
      await (g.fetch as (u: string) => Promise<unknown>)('https://x.test/a?b=1');
      await Promise.resolve();
      expect(cap.snapshot()[0]).toMatchObject({ method: 'GET', status: 404, url: 'https://x.test/a?b=***' });
      cap.stop();
      expect(g.fetch).toBe(realFetch);
    } finally {
      g.fetch = saved;
    }
  });

  it('records a failed fetch as status 0 with the error message', async () => {
    const failing = vi.fn(async () => {
      throw new Error('Network request failed');
    });
    const g = globalThis as { fetch?: unknown };
    const saved = g.fetch;
    g.fetch = failing;
    try {
      const cap = new NetworkCapture(5, null, { fetch: failing as never });
      cap.start();
      await expect((g.fetch as (u: string) => Promise<unknown>)('https://x.test')).rejects.toThrow();
      await Promise.resolve();
      expect(cap.snapshot()[0]).toMatchObject({ status: 0, error: 'Network request failed' });
      cap.stop();
    } finally {
      g.fetch = saved;
    }
  });
});

describe('JourneyCapture', () => {
  it('records screen changes once and taps with the matched testID, not typed text', () => {
    let route: string | undefined = 'Home';
    const j = new JourneyCapture(
      3,
      () => route,
      (x) => (x < 100 ? { selector: 'buy-btn', text: 'Buy' } : null),
      1000,
    );
    j.start();
    vi.advanceTimersByTime(1000);
    route = 'Cart';
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    j.recordTap(50, 60);
    j.recordTap(300, 400);
    j.stop();
    const s = j.snapshot();
    expect(s.screens.map((x) => x.url)).toEqual(['Home', 'Cart']);
    expect(s.taps[0]).toMatchObject({ type: 'click', selector: 'buy-btn', text: 'Buy', route: 'Cart', x: 50, y: 60 });
    expect(s.taps[1].selector).toBeUndefined();
  });

  it('survives a throwing resolver', () => {
    const j = new JourneyCapture(3, () => 'A', () => {
      throw new Error('x');
    });
    expect(() => j.recordTap(1, 1)).not.toThrow();
  });
});

describe('Filmstrip', () => {
  it('keeps the newest frames, skips while paused or busy, and survives failures', async () => {
    let n = 0;
    const capture = vi.fn(async () => {
      n++;
      if (n === 2) throw new Error('fail');
      return { base64: `f${n}` };
    });
    const f = new Filmstrip(capture, 1000, 2);
    await f.tick(); // f1
    await f.tick(); // throws, skipped
    await f.tick(); // f3
    await f.tick(); // f4
    expect(f.snapshot().map((x) => x.base64)).toEqual(['f3', 'f4']);
    f.setPaused(true);
    await f.tick();
    expect(capture).toHaveBeenCalledTimes(4);
  });
});

describe('collectDeviceInfo', () => {
  const rn = {
    Platform: {
      OS: 'android',
      Version: 34,
      constants: { Brand: 'google', Manufacturer: 'Google', Model: 'Pixel 8', Version: 34 },
    },
    Dimensions: { get: () => ({ width: 412, height: 915, scale: 2.6, fontScale: 1.1 }) },
    PixelRatio: { get: () => 2.6, getFontScale: () => 1.1 },
    Appearance: { getColorScheme: () => 'dark' },
    I18nManager: { isRTL: false },
  };

  it('gathers device, screen and settings from React Native alone', async () => {
    const info = await collectDeviceInfo(rn);
    expect(info).toMatchObject({
      deviceBrand: 'google',
      deviceModel: 'Pixel 8',
      osApiLevel: 34,
      screen: '412x915',
      orientation: 'portrait',
      pixelRatio: 2.6,
      fontScale: 1.1,
      colorScheme: 'dark',
    });
    expect(info.rtl).toBeUndefined();
  });

  it('adds build, connectivity and battery from optional modules', async () => {
    const info = await collectDeviceInfo(rn, {
      application: { applicationId: 'com.acme.app', nativeBuildVersion: '42', nativeApplicationVersion: '1.2.3' },
      device: { modelName: 'Pixel 8', isDevice: true, totalMemory: 8 * 1048576 * 1024 },
      netinfo: { fetch: async () => ({ type: 'cellular', isConnected: true, isInternetReachable: false, details: { cellularGeneration: '5g' } }) },
      battery: { getBatteryLevelAsync: async () => 0.55, isLowPowerModeEnabledAsync: async () => true },
      constants: { executionEnvironment: 'standalone', expoConfig: { sdkVersion: '57.0.0' } },
    });
    expect(info).toMatchObject({
      bundleId: 'com.acme.app',
      buildNumber: '42',
      isPhysicalDevice: true,
      memoryMb: 8192,
      networkType: 'cellular',
      internetReachable: false,
      cellularGeneration: '5g',
      batteryPercent: 55,
      lowPowerMode: true,
      expoSdk: '57.0.0',
    });
  });

  it('does not hang when an optional module never resolves', async () => {
    const p = collectDeviceInfo(rn, { netinfo: { fetch: () => new Promise(() => undefined) } });
    await vi.advanceTimersByTimeAsync(2000);
    const info = await p;
    expect(info.deviceModel).toBe('Pixel 8');
    expect(info.networkType).toBeUndefined();
  });
});

describe('ContextCollector', () => {
  const deps = (opts: unknown) => ({
    getOptions: () => opts as never,
    apiUrl: 'https://bugpilot.test',
    getRouteName: () => 'Checkout',
    resolveTap: () => ({ selector: 'pay' }),
    getDeviceInfo: async () => ({ deviceModel: 'X' }),
    captureThumbnail: async () => ({ base64: 'thumb' }),
  });

  it('builds a pack in the keys the dashboard already renders', async () => {
    const c = new ContextCollector(deps({ filmstrip: true, getExtraContext: () => ({ plan: 'pro', token: 't' }) }));
    c.start();
    vi.advanceTimersByTime(2100);
    c.recordTap(10, 20);
    const pack = await c.snapshot();
    c.stop();
    expect(pack.browserInfo).toEqual({ deviceModel: 'X' });
    expect(Object.keys(pack.metadata).sort()).toEqual(
      ['consoleErrors', 'mobile', 'navigationHistory', 'networkTransactions', 'recordedSteps'].concat(
        pack.metadata.screenshots ? ['screenshots'] : [],
      ).sort(),
    );
    expect((pack.metadata.recordedSteps as { selector: string }[])[0].selector).toBe('pay');
    expect((pack.metadata.navigationHistory as { url: string }[])[0].url).toBe('Checkout');
    expect(pack.metadata.mobile).toMatchObject({ extra: { plan: 'pro', token: '[redacted]' } });
  });

  it('collects nothing when context is false, and honours per-group switches', async () => {
    const off = new ContextCollector(deps(false));
    off.start();
    const none = await off.snapshot();
    off.stop();
    expect(none.browserInfo).toEqual({});
    expect(none.metadata.consoleErrors).toBeUndefined();

    const some = new ContextCollector(deps({ device: false, network: false, journey: false }));
    some.start();
    const pack = await some.snapshot();
    some.stop();
    expect(pack.browserInfo).toEqual({});
    expect(pack.metadata.networkTransactions).toBeUndefined();
    expect(pack.metadata.consoleErrors).toEqual([]);
  });

  it('stop() restores console so nothing keeps recording', () => {
    const original = console.error;
    const c = new ContextCollector(deps({ network: false, journey: false }));
    c.start();
    expect(console.error).not.toBe(original);
    c.stop();
    expect(console.error).toBe(original);
  });
});

describe('payload with context', () => {
  it('merges context into browser_info and metadata without clobbering captureSource', () => {
    const payload = buildCreateIssuePayload({
      apiUrl: 'x',
      accessToken: null,
      projectId: 'p1',
      form: { title: 'Bug', severity: 'Medium' },
      routeName: 'Cart',
      environmentInfo: { platform: 'react-native', os: 'ios', osVersion: '17' },
      context: {
        browserInfo: { deviceModel: 'iPhone 15', os: 'WRONG' },
        metadata: {
          consoleErrors: [{ level: 'error', message: 'x', timestamp: 't' }],
          mobile: { collected: ['logs'] },
          captureSource: 'evil',
        },
        summary: { logs: 1, requests: 0, screens: 0, taps: 0, frames: 0 },
      },
      elementScreenshot: { base64: 'crop' },
    });
    expect(payload.browser_info).toMatchObject({ deviceModel: 'iPhone 15', os: 'ios', platform: 'react-native' });
    expect(payload.metadata).toMatchObject({
      captureSource: 'rn-reporter',
      consoleErrors: [{ message: 'x' }],
      mobile: { collected: ['logs'], navigation: { routeName: 'Cart' } },
    });
    expect(payload.element_screenshot).toBe('crop');
  });

  it('is unchanged when there is no context', () => {
    const payload = buildCreateIssuePayload({
      apiUrl: 'x',
      accessToken: null,
      projectId: 'p1',
      form: { title: 'Bug', severity: 'Medium' },
    });
    expect(payload.browser_info).toBeUndefined();
    expect((payload.metadata as { consoleErrors?: unknown }).consoleErrors).toBeUndefined();
  });
});
