import type { ConsoleEntry } from './types';
import { formatLogArgs, RingBuffer } from './sanitize';

type ErrorUtilsLike = {
  getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (h: (error: unknown, isFatal?: boolean) => void) => void;
};

type ConsoleLike = Record<'error' | 'warn', (...args: unknown[]) => void>;

/**
 * Rolling buffer of console.error / console.warn and uncaught JS errors.
 * Wraps the originals (never replaces their behaviour) and restores them on stop.
 */
export class ConsoleCapture {
  private buffer: RingBuffer<ConsoleEntry>;
  private restore: Array<() => void> = [];
  private started = false;

  constructor(
    max = 20,
    private readonly env: { console?: ConsoleLike; errorUtils?: ErrorUtilsLike } = {
      console: console as unknown as ConsoleLike,
      errorUtils: (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils,
    },
  ) {
    this.buffer = new RingBuffer(max);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const c = this.env.console;
    if (c) {
      (['error', 'warn'] as const).forEach((level) => {
        const original = c[level];
        const wrapped = (...args: unknown[]) => {
          this.record(level, () => formatLogArgs(args));
          original.apply(c, args);
        };
        c[level] = wrapped;
        this.restore.push(() => {
          if (c[level] === wrapped) c[level] = original;
        });
      });
    }
    const eu = this.env.errorUtils;
    if (eu?.getGlobalHandler && eu.setGlobalHandler) {
      const previous = eu.getGlobalHandler();
      const handler = (error: unknown, isFatal?: boolean) => {
        this.record('error', () => `Uncaught${isFatal ? ' (fatal)' : ''}: ${formatLogArgs([error])}`);
        previous?.(error, isFatal);
      };
      eu.setGlobalHandler(handler);
      this.restore.push(() => {
        if (eu.getGlobalHandler?.() === handler && previous) eu.setGlobalHandler?.(previous);
      });
    }
  }

  stop(): void {
    this.restore.reverse().forEach((r) => r());
    this.restore = [];
    this.started = false;
  }

  /** Never throws into the host: a failure to format drops the entry. */
  private record(level: ConsoleEntry['level'], message: () => string): void {
    try {
      this.buffer.push({ level, message: message(), timestamp: new Date().toISOString() });
    } catch {
      // ignore
    }
  }

  snapshot(): ConsoleEntry[] {
    return this.buffer.toArray();
  }
}
