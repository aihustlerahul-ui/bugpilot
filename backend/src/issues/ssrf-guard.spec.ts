import { assertPublicHttpUrl, isBlockedAddress, safeFetchJson, SsrfBlockedError } from './ssrf-guard';

type LookupAll = (host: string) => Promise<Array<{ address: string; family: number }>>;
const resolvesTo = (...addresses: string[]): LookupAll => async () =>
  addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.5.5.5',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '100.127.255.255',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    'ff02::1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700::1111'])(
    'allows public %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe('assertPublicHttpUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://x.com/a', 'gopher://x', 'javascript:alert(1)']) {
      await expect(assertPublicHttpUrl(url, resolvesTo('8.8.8.8'))).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it('rejects literal private / metadata / loopback hosts', async () => {
    for (const url of [
      'http://127.0.0.1/a.js',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/x',
      'http://10.1.2.3:8080/x',
      'http://0/x',
    ]) {
      await expect(assertPublicHttpUrl(url, resolvesTo('8.8.8.8'))).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it('rejects a hostname when ANY resolved address is private', async () => {
    await expect(
      assertPublicHttpUrl('https://evil.example.com/a.js', resolvesTo('8.8.8.8', '192.168.0.10')),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects localhost names', async () => {
    await expect(assertPublicHttpUrl('http://localhost/a.js', resolvesTo('127.0.0.1'))).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('accepts a public hostname', async () => {
    await expect(assertPublicHttpUrl('https://cdn.example.com/a.js', resolvesTo('93.184.216.34'))).resolves.toBeInstanceOf(
      URL,
    );
  });
});

describe('safeFetchJson', () => {
  const jsonResponse = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
    new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });

  it('fetches public JSON with redirects disabled at the fetch layer', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ version: 3 }));
    const res = await safeFetchJson('https://cdn.example.com/a.js.map', {
      lookup: resolvesTo('93.184.216.34'),
      fetchImpl,
    });
    expect(res).toEqual({ version: 3 });
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
  });

  it('never calls fetch for a blocked target', async () => {
    const fetchImpl = jest.fn();
    await expect(
      safeFetchJson('http://169.254.169.254/latest', { lookup: resolvesTo('8.8.8.8'), fetchImpl }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-checks every redirect hop and refuses a redirect to a private address', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://internal.example/x' } }));
    const lookup: LookupAll = async (host) =>
      host === 'internal.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
    await expect(
      safeFetchJson('https://cdn.example.com/a.js.map', { lookup, fetchImpl }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to another public host', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/b.js.map' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    const res = await safeFetchJson('https://cdn.example.com/a.js.map', {
      lookup: resolvesTo('93.184.216.34'),
      fetchImpl,
    });
    expect(res).toEqual({ ok: 1 });
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://cdn.example.com/b.js.map');
  });

  it('gives up after too many redirects', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
    await expect(
      safeFetchJson('https://cdn.example.com/a', { lookup: resolvesTo('93.184.216.34'), fetchImpl, maxRedirects: 2 }),
    ).rejects.toThrow(/redirect/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('refuses bodies over the size cap', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: 'x'.repeat(2000) }));
    await expect(
      safeFetchJson('https://cdn.example.com/a.js.map', {
        lookup: resolvesTo('93.184.216.34'),
        fetchImpl,
        maxBytes: 100,
      }),
    ).rejects.toThrow(/too large/i);
  });

  it('returns null for non-2xx responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, { status: 404 }));
    await expect(
      safeFetchJson('https://cdn.example.com/a.js.map', { lookup: resolvesTo('93.184.216.34'), fetchImpl }),
    ).resolves.toBeNull();
  });
});
