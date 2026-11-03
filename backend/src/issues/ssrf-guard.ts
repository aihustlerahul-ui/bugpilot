import { promises as dns } from 'dns';
import { isIPv4, isIPv6 } from 'net';

/**
 * SSRF guard for server-side fetches of user-supplied URLs (source maps).
 *
 * - only http/https
 * - every address the hostname resolves to must be public (no loopback, private, link-local /
 *   cloud metadata, unspecified, CGNAT, multicast/reserved, or IPv6 equivalents incl. v4-mapped)
 * - redirects are not followed by fetch; each hop is re-validated here (bounded)
 * - response size and total time are capped
 *
 * Residual risk: the address is checked before fetch() resolves it again, so a DNS-rebinding
 * host with a near-zero TTL could still swap answers between the check and the connect.
 * Closing that fully needs connect-time pinning (an undici dispatcher with a checked lookup).
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export type LookupAll = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupAll = (host) => dns.lookup(host, { all: true, verbatim: true });

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network / unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local incl. cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address into 8 16-bit groups (handles `::` and a trailing dotted IPv4). */
function expandV6(ip: string): number[] | null {
  let s = ip.split('%')[0].toLowerCase();
  const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    if (!isIPv4(dotted[2])) return null;
    const n = v4ToInt(dotted[2]);
    s = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g, 16));
  return nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : nums;
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const allZeroUpTo = (k: number) => g.slice(0, k).every((x) => x === 0);
  if (g.every((x) => x === 0)) return true; // ::
  if (allZeroUpTo(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded v4
  if (allZeroUpTo(5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    return isBlockedV4(v4);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 (could reach internal v4)
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/** True when the address must never be fetched from the server. Non-IPs are blocked. */
export function isBlockedAddress(ip: string): boolean {
  if (isIPv4(ip)) return isBlockedV4(ip);
  if (isIPv6(ip)) return isBlockedV6(ip);
  return true;
}

/** Validate scheme + every resolved address of the URL's host. Returns the parsed URL. */
export async function assertPublicHttpUrl(rawUrl: string, lookup: LookupAll = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError('Only http(s) URLs are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfBlockedError('Host not allowed');
  }
  if (isIPv4(host) || isIPv6(host)) {
    if (isBlockedAddress(host)) throw new SsrfBlockedError('Address not allowed');
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host);
  } catch {
    throw new SsrfBlockedError('Host did not resolve');
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new SsrfBlockedError('Address not allowed');
  }
  return url;
}

export interface SafeFetchOptions {
  lookup?: LookupAll;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Response too large');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * GET a JSON document from a user-supplied URL with SSRF protections.
 * Returns null for non-2xx; throws SsrfBlockedError for disallowed targets.
 */
export async function safeFetchJson(rawUrl: string, opts: SafeFetchOptions = {}): Promise<any | null> {
  const lookup = opts.lookup ?? defaultLookup;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
  try {
    let current = rawUrl;
    for (let hop = 0; ; hop++) {
      const url = await assertPublicHttpUrl(current, lookup);
      const res = await fetchImpl(url.toString(), { redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return null;
        if (hop >= maxRedirects) throw new Error('Too many redirects');
        current = new URL(location, url).toString();
        continue;
      }
      if (!res.ok) return null;
      return JSON.parse(await readCapped(res, maxBytes));
    }
  } finally {
    clearTimeout(timer);
  }
}
