const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SENSITIVE_KEY_RE = /pass(word)?|token|secret|auth|cookie|session|credential|api[-_]?key|private/i;

/** Fixed-size buffer that drops the oldest entry first. */
export class RingBuffer<T> {
  private items: T[] = [];
  constructor(private max: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }
  toArray(): T[] {
    return this.items.slice();
  }
  get size(): number {
    return this.items.length;
  }
  clear(): void {
    this.items = [];
  }
}

/** Remove bearer tokens and JWTs from free text, then cap its length. */
export function scrubText(text: string, max = 1000): string {
  const clean = text.replace(BEARER_RE, 'Bearer [redacted]').replace(JWT_RE, '[redacted-jwt]');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Keep scheme/host/path; drop credentials, fragment and query *values*
 * (keys stay so the shape of the request is still visible).
 */
export function sanitizeUrl(raw: string): string {
  let url = raw.split('#')[0];
  url = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
  const q = url.indexOf('?');
  if (q === -1) return scrubText(url, 300);
  const base = url.slice(0, q);
  const query = url
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => `${pair.split('=')[0]}=***`)
    .join('&');
  return scrubText(query ? `${base}?${query}` : base, 300);
}

export function formatLogArgs(args: unknown[]): string {
  const parts = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) {
      const stack = a.stack ? `\n${a.stack.split('\n').slice(0, 6).join('\n')}` : '';
      return `${a.name}: ${a.message}${stack}`;
    }
    try {
      return JSON.stringify(a) ?? String(a);
    } catch {
      return String(a);
    }
  });
  return scrubText(parts.join(' '));
}

/** Deep-copy JSON-safe values, redacting sensitive keys; caps depth and total size. */
export function redactExtra(
  input: Record<string, unknown> | undefined | null,
  maxChars = 8000,
): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const walk = (v: unknown, depth: number): unknown => {
    if (v == null || typeof v === 'boolean' || typeof v === 'number') return v;
    if (typeof v === 'string') return scrubText(v, 300);
    if (depth >= 4) return '[truncated]';
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => walk(x, depth + 1));
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
        out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : walk(val, depth + 1);
      }
      return out;
    }
    return String(v);
  };
  const cleaned = walk(input, 0) as Record<string, unknown>;
  try {
    if (JSON.stringify(cleaned).length > maxChars) return { _truncated: true };
  } catch {
    return undefined;
  }
  return cleaned;
}
