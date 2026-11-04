/**
 * Context pack: extra, privacy-filtered metadata attached to every report so a
 * developer can reproduce the bug without asking the tester.
 *
 * Everything is on by default except the screenshot filmstrip (costs CPU and
 * memory). Request/response bodies, headers and typed input values are never
 * captured.
 */
export type ContextOptions = {
  /** Device, OS, screen, locale, app build, connectivity. Default true. */
  device?: boolean;
  /** Recent console.error / console.warn and uncaught JS errors. Default true. */
  logs?: boolean;
  /** Recent network calls (method, redacted URL, status, duration). Default true. */
  network?: boolean;
  /** Recent screens visited and taps (testID / name, never typed text). Default true. */
  journey?: boolean;
  /**
   * Rolling low-res screenshots (the seconds before the report). Default off.
   * `true` = a frame every 2 s, last 5 frames, 360 px wide.
   */
  filmstrip?: boolean | { intervalMs?: number; maxFrames?: number; width?: number };
  /** Ring-buffer sizes. */
  maxLogs?: number;
  maxRequests?: number;
  maxSteps?: number;
  /**
   * Host-supplied app state (feature flags, user role, tenant, cart size…).
   * Keys that look sensitive (password, token, secret, auth, cookie, key) are
   * redacted and the result is size-capped.
   */
  getExtraContext?: () => Record<string, unknown> | undefined;
};

export type ConsoleEntry = { level: 'error' | 'warn'; message: string; timestamp: string };

export type NetworkEntry = {
  method: string;
  url: string;
  status: number;
  duration: number;
  timestamp: string;
  error?: string;
};

export type ScreenEntry = { url: string; timestamp: string };

export type TapEntry = {
  type: 'click';
  selector?: string;
  text?: string;
  route?: string;
  x: number;
  y: number;
  timestamp: string;
};

export type FilmstripFrame = { base64: string; at: number };

export type ContextPack = {
  /** Merged into `browser_info` (flat, JSON-safe). */
  browserInfo: Record<string, unknown>;
  /** Merged into `metadata` using the keys the dashboard already renders. */
  metadata: Record<string, unknown>;
  /** What was collected, shown to the tester before submit. */
  summary: { logs: number; requests: number; screens: number; taps: number; frames: number };
};
