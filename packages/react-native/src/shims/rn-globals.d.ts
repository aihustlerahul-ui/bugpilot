/**
 * Ambient globals for package-local typecheck without host node_modules.
 * Host apps (Tallect) resolve real react / react-native via preserveSymlinks.
 */
declare const __DEV__: boolean;

interface Console {
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
  log(...data: unknown[]): void;
}

declare const console: Console;
declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(handle?: number): void;
declare function requestAnimationFrame(callback: (time: number) => void): number;

interface AbortSignal {
  readonly aborted: boolean;
}
declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
