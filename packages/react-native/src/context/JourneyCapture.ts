import type { ScreenEntry, TapEntry } from './types';
import { RingBuffer, scrubText } from './sanitize';

export type TapTarget = { selector?: string; text?: string } | null;

/**
 * Last screens visited and taps. Taps record the matched element's testID /
 * watch name and coordinates — never what the user typed.
 */
export class JourneyCapture {
  private screens: RingBuffer<ScreenEntry>;
  private taps: RingBuffer<TapEntry>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastScreen: string | undefined;

  constructor(
    maxSteps = 20,
    private readonly getRouteName: () => string | undefined,
    private readonly resolveTap: (x: number, y: number) => TapTarget = () => null,
    private readonly pollMs = 1000,
  ) {
    this.screens = new RingBuffer(maxSteps);
    this.taps = new RingBuffer(maxSteps);
  }

  start(): void {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Public so hosts can report a screen change immediately. */
  recordScreen(name: string | undefined): void {
    if (!name || name === this.lastScreen) return;
    this.lastScreen = name;
    this.screens.push({ url: scrubText(name, 120), timestamp: new Date().toISOString() });
  }

  recordTap(x: number, y: number): void {
    try {
      const target = this.resolveTap(x, y);
      this.taps.push({
        type: 'click',
        ...(target?.selector ? { selector: scrubText(target.selector, 120) } : {}),
        ...(target?.text ? { text: scrubText(target.text, 80) } : {}),
        route: this.lastScreen,
        x: Math.round(x),
        y: Math.round(y),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // never throw into the host's touch handling
    }
  }

  private poll(): void {
    try {
      this.recordScreen(this.getRouteName());
    } catch {
      // ignore
    }
  }

  snapshot(): { screens: ScreenEntry[]; taps: TapEntry[] } {
    return { screens: this.screens.toArray(), taps: this.taps.toArray() };
  }
}
