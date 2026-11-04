import type { FilmstripFrame } from './types';
import { RingBuffer } from './sanitize';

/**
 * Rolling low-resolution screenshots of the app root. Paused while the BugPilot
 * overlay is open, and skips a tick if the previous capture is still running.
 */
export class Filmstrip {
  private frames: RingBuffer<FilmstripFrame>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private paused = false;

  constructor(
    private readonly capture: () => Promise<{ base64: string } | null>,
    private readonly intervalMs = 2000,
    maxFrames = 5,
  ) {
    this.frames = new RingBuffer(maxFrames);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  async tick(): Promise<void> {
    if (this.busy || this.paused) return;
    this.busy = true;
    try {
      const shot = await this.capture();
      if (shot?.base64) this.frames.push({ base64: shot.base64, at: Date.now() });
    } catch {
      // a failed frame is just skipped
    } finally {
      this.busy = false;
    }
  }

  snapshot(): FilmstripFrame[] {
    return this.frames.toArray();
  }
}
