/**
 * Screenshot capture contract for @bugpilot/react-native.
 *
 * Primary (Expo / expo-dev-client): `react-native-view-shot` via
 * `ViewShotScreenshotAdapter` — captures an in-app root ref (annotation-friendly).
 * Alternative: `expo-screen-capture` for full display pixels (less ideal for
 * marking a subtree; not implemented here).
 *
 * Extension parity: base64 PNG **without** `data:image/...;base64,` prefix for
 * `screenshot` / `element_screenshot` on POST /api/issues.
 *
 * Host install requires a native rebuild:
 *   npx expo install react-native-view-shot
 */

import type { NativeViewHandle } from '../nativeView';

export type ScreenshotResult = {
  /** Raw base64 (no data-URL prefix) */
  base64: string;
  label?: string;
};

export type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenshotCapture = {
  /** Capture the provider root (wrapped app tree). */
  captureFullWindow: () => Promise<ScreenshotResult | null>;
  /**
   * Optional region crop. View-shot adapters may re-capture full window and
   * leave cropping to a later annotation pass when native crop is unavailable.
   */
  captureRegion?: (bounds: CaptureRegion) => Promise<ScreenshotResult | null>;
  /** Low-resolution root capture (`width` px wide) for the rolling filmstrip. */
  captureThumbnail?: (width: number) => Promise<ScreenshotResult | null>;
  /** Capture a single mounted view (element crop). */
  captureElement?: (target: NativeViewHandle) => Promise<ScreenshotResult | null>;
};

let warnedNoop = false;

/**
 * Fallback when `react-native-view-shot` peer is missing.
 * Logs once in __DEV__; always returns null.
 */
export const noopScreenshotCapture: ScreenshotCapture = {
  async captureFullWindow() {
    if (!warnedNoop && typeof __DEV__ !== 'undefined' && __DEV__) {
      warnedNoop = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[bugPilot] ScreenshotCapture: react-native-view-shot not installed. ' +
          'Using noop adapter. Host must run: npx expo install react-native-view-shot ' +
          '(after explicit approval) and rebuild the native app.',
      );
    }
    return null;
  },
  async captureRegion() {
    return null;
  },
};

/** Strip data-URL prefix if a capture library returns one. */
export function normalizeScreenshotBase64(raw: string): string {
  const trimmed = raw.trim();
  const marker = 'base64,';
  const idx = trimmed.indexOf(marker);
  if (trimmed.startsWith('data:') && idx !== -1) {
    return trimmed.slice(idx + marker.length);
  }
  return trimmed;
}
