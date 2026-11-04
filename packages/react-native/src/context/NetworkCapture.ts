import type { NetworkEntry } from './types';
import { RingBuffer, sanitizeUrl, scrubText } from './sanitize';

type XhrProto = {
  open: (this: XhrInstance, method: string, url: string, ...rest: unknown[]) => unknown;
  send: (this: XhrInstance, ...args: unknown[]) => unknown;
};
type XhrInstance = {
  __bp?: { method: string; url: string; started: number };
  addEventListener?: (type: string, cb: () => void) => void;
  status?: number;
};
type FetchLike = (input: unknown, init?: { method?: string }) => Promise<{ status: number }>;

type NetworkEnv = { xhrProto?: XhrProto; fetch?: FetchLike };

function defaultEnv(): NetworkEnv {
  const g = globalThis as unknown as {
    XMLHttpRequest?: { prototype: XhrProto };
    fetch?: FetchLike;
  };
  return { xhrProto: g.XMLHttpRequest?.prototype, fetch: g.fetch };
}

/**
 * Records method, redacted URL, status and duration of recent requests.
 * Never records headers or bodies. In React Native `fetch` is built on
 * XMLHttpRequest, so only XHR is patched there (otherwise every call would be
 * counted twice); `fetch` is patched only when XHR is unavailable.
 */
export class NetworkCapture {
  private buffer: RingBuffer<NetworkEntry>;
  private restore: Array<() => void> = [];
  private started = false;

  constructor(
    max = 20,
    /** Requests to BugPilot's own API are not part of the bug context. */
    private readonly ignorePrefix: string | null = null,
    private readonly env: NetworkEnv = defaultEnv(),
  ) {
    this.buffer = new RingBuffer(max);
  }

  private ignored(url: string): boolean {
    return !!this.ignorePrefix && url.startsWith(this.ignorePrefix);
  }

  private record(method: string, rawUrl: string, status: number, started: number, error?: string) {
    try {
      if (this.ignored(rawUrl)) return;
      this.buffer.push({
        method: method.toUpperCase(),
        url: sanitizeUrl(rawUrl),
        status,
        duration: Math.max(0, Date.now() - started),
        timestamp: new Date(started).toISOString(),
        ...(error ? { error: scrubText(error, 200) } : {}),
      });
    } catch {
      // never throw into the host
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const { xhrProto, fetch: realFetch } = this.env;
    if (xhrProto && typeof xhrProto.open === 'function' && typeof xhrProto.send === 'function') {
      const origOpen = xhrProto.open;
      const origSend = xhrProto.send;
      const self = this;
      xhrProto.open = function (this: XhrInstance, method: string, url: string, ...rest: unknown[]) {
        try {
          this.__bp = { method: String(method), url: String(url), started: 0 };
        } catch {
          // ignore
        }
        return origOpen.call(this, method, url, ...rest);
      };
      xhrProto.send = function (this: XhrInstance, ...args: unknown[]) {
        try {
          const meta = this.__bp;
          if (meta) {
            meta.started = Date.now();
            this.addEventListener?.('loadend', () => {
              self.record(meta.method, meta.url, this.status ?? 0, meta.started);
            });
          }
        } catch {
          // ignore
        }
        return origSend.apply(this, args);
      };
      this.restore.push(() => {
        if (xhrProto.open !== origOpen) xhrProto.open = origOpen;
        if (xhrProto.send !== origSend) xhrProto.send = origSend;
      });
    } else if (realFetch) {
      const g = globalThis as unknown as { fetch?: FetchLike };
      const wrapped: FetchLike = (input, init) => {
        const started = Date.now();
        const url =
          typeof input === 'string' ? input : String((input as { url?: string } | null)?.url ?? '');
        const method = init?.method ?? (input as { method?: string } | null)?.method ?? 'GET';
        const p = realFetch(input, init);
        p.then(
          (res) => this.record(method, url, res.status, started),
          (err) => this.record(method, url, 0, started, err instanceof Error ? err.message : String(err)),
        );
        return p;
      };
      g.fetch = wrapped;
      this.restore.push(() => {
        if (g.fetch === wrapped) g.fetch = realFetch;
      });
    }
  }

  stop(): void {
    this.restore.reverse().forEach((r) => r());
    this.restore = [];
    this.started = false;
  }

  snapshot(): NetworkEntry[] {
    return this.buffer.toArray();
  }
}
