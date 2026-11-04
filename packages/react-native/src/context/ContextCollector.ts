import { ConsoleCapture } from './ConsoleCapture';
import { Filmstrip } from './Filmstrip';
import { JourneyCapture, type TapTarget } from './JourneyCapture';
import { NetworkCapture } from './NetworkCapture';
import { redactExtra } from './sanitize';
import type { ContextOptions, ContextPack } from './types';

export type CollectorDeps = {
  /** Read on every start/snapshot so config changes apply without remounting. */
  getOptions: () => ContextOptions | false | undefined;
  /** BugPilot's own API origin; its requests are excluded from network context. */
  apiUrl: string;
  getRouteName: () => string | undefined;
  resolveTap: (x: number, y: number) => TapTarget;
  /** Low-res root capture for the filmstrip; undefined when unsupported. */
  captureThumbnail?: (width: number) => Promise<{ base64: string } | null>;
  /** Device/app/connectivity facts (async). */
  getDeviceInfo: () => Promise<Record<string, unknown>>;
};

const DEFAULT_FILMSTRIP = { intervalMs: 2000, maxFrames: 5, width: 360 };

function resolve(opts: ContextOptions | false | undefined) {
  if (opts === false) {
    return { device: false, logs: false, network: false, journey: false, filmstrip: null, max: {}, o: {} as ContextOptions };
  }
  const o = opts ?? {};
  const f = o.filmstrip;
  return {
    device: o.device !== false,
    logs: o.logs !== false,
    network: o.network !== false,
    journey: o.journey !== false,
    filmstrip: f ? { ...DEFAULT_FILMSTRIP, ...(typeof f === 'object' ? f : {}) } : null,
    max: { logs: o.maxLogs ?? 20, requests: o.maxRequests ?? 20, steps: o.maxSteps ?? 20 },
    o,
  };
}

/** Owns the rolling buffers; start() when the overlay is enabled, stop() on unmount. */
export class ContextCollector {
  private con: ConsoleCapture | null = null;
  private net: NetworkCapture | null = null;
  private jour: JourneyCapture | null = null;
  private film: Filmstrip | null = null;

  constructor(private readonly deps: CollectorDeps) {}

  start(): void {
    this.stop();
    const r = resolve(this.deps.getOptions());
    if (r.logs) {
      this.con = new ConsoleCapture((r.max as { logs: number }).logs);
      this.con.start();
    }
    if (r.network) {
      this.net = new NetworkCapture((r.max as { requests: number }).requests, this.deps.apiUrl || null);
      this.net.start();
    }
    if (r.journey) {
      this.jour = new JourneyCapture(
        (r.max as { steps: number }).steps,
        this.deps.getRouteName,
        this.deps.resolveTap,
      );
      this.jour.start();
    }
    const thumb = this.deps.captureThumbnail;
    if (r.filmstrip && thumb) {
      const width = r.filmstrip.width;
      this.film = new Filmstrip(() => thumb(width), r.filmstrip.intervalMs, r.filmstrip.maxFrames);
      this.film.start();
    }
  }

  stop(): void {
    this.con?.stop();
    this.net?.stop();
    this.jour?.stop();
    this.film?.stop();
    this.con = this.net = this.jour = this.film = null;
  }

  /** Pause frame capture while the BugPilot overlay is on screen. */
  setPaused(paused: boolean): void {
    this.film?.setPaused(paused);
  }

  recordTap(x: number, y: number): void {
    this.jour?.recordTap(x, y);
  }

  counts(): ContextPack['summary'] {
    const j = this.jour?.snapshot();
    return {
      logs: this.con?.snapshot().length ?? 0,
      requests: this.net?.snapshot().length ?? 0,
      screens: j?.screens.length ?? 0,
      taps: j?.taps.length ?? 0,
      frames: this.film?.snapshot().length ?? 0,
    };
  }

  /** Never throws: any failing group is simply omitted. */
  async snapshot(): Promise<ContextPack> {
    const r = resolve(this.deps.getOptions());
    const metadata: Record<string, unknown> = {};
    const collected: string[] = [];
    let browserInfo: Record<string, unknown> = {};

    if (r.device) {
      try {
        browserInfo = await this.deps.getDeviceInfo();
        collected.push('device');
      } catch {
        // omit
      }
    }
    if (this.con) {
      metadata.consoleErrors = this.con.snapshot();
      collected.push('logs');
    }
    if (this.net) {
      metadata.networkTransactions = this.net.snapshot();
      collected.push('network');
    }
    if (this.jour) {
      const j = this.jour.snapshot();
      metadata.navigationHistory = j.screens;
      metadata.recordedSteps = j.taps;
      collected.push('journey');
    }
    if (this.film) {
      const now = Date.now();
      const frames = this.film.snapshot();
      if (frames.length) {
        metadata.screenshots = frames.map((f) => ({
          label: `${Math.max(0, Math.round((now - f.at) / 1000))}s before report`,
          data: f.base64,
        }));
        collected.push('filmstrip');
      }
    }

    let extra: Record<string, unknown> | undefined;
    try {
      extra = redactExtra(r.o.getExtraContext?.());
    } catch {
      extra = undefined;
    }
    if (extra) collected.push('extra');
    metadata.mobile = { collected, ...(extra ? { extra } : {}) };

    return { browserInfo, metadata, summary: this.counts() };
  }
}
