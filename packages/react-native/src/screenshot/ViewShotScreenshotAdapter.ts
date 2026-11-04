import type { RefObject } from 'react';
import type { NativeViewHandle } from '../nativeView';
import {
  normalizeScreenshotBase64,
  noopScreenshotCapture,
  type CaptureRegion,
  type ScreenshotCapture,
  type ScreenshotResult,
} from './ScreenshotCapture';

type ViewShotModule = {
  captureRef: (
    ref: RefObject<NativeViewHandle | null> | NativeViewHandle,
    options?: {
      format?: 'png' | 'jpg' | 'webm' | 'raw';
      quality?: number;
      result?: 'tmpfile' | 'base64' | 'data-uri';
      width?: number;
      height?: number;
    },
  ) => Promise<string>;
};

export type ViewShotAvailability =
  | { available: true }
  | {
      available: false;
      reason: 'js-missing' | 'native-unlinked' | 'root-unmounted' | 'capture-failed';
      message: string;
    };

let viewShotModule: ViewShotModule | null | undefined;
let warnedMissing = false;
let lastFailure: ViewShotAvailability | null = null;

function loadViewShot(): ViewShotModule | null {
  if (viewShotModule !== undefined) return viewShotModule;
  try {
    // Peer dependency — may be absent until host installs it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    viewShotModule = require('react-native-view-shot') as ViewShotModule;
  } catch {
    viewShotModule = null;
  }
  return viewShotModule;
}

function warnMissingOnce() {
  if (warnedMissing) return;
  warnedMissing = true;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      '[bugPilot] react-native-view-shot peer dependency not found. ' +
        'Screenshot capture disabled until the host installs it and rebuilds. ' +
        'Approve then run: npx expo install react-native-view-shot && npx expo run:ios',
    );
  }
}

function looksLikeNativeMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /native module|RNViewShot|null is not an object|Cannot read property 'captureRef'|Invariant Violation/i.test(
    msg,
  );
}

/**
 * Adapter backed by peerDep `react-native-view-shot`.
 * Captures the View ref passed from `BugPilotProvider` (in-app UI subtree).
 */
export function createViewShotScreenshotAdapter(
  rootRef: RefObject<NativeViewHandle | null>,
): ScreenshotCapture {
  const mod = loadViewShot();
  if (!mod?.captureRef) {
    warnMissingOnce();
    lastFailure = {
      available: false,
      reason: 'js-missing',
      message:
        'react-native-view-shot JS package not resolvable — install peer + rebuild native app',
    };
    return noopScreenshotCapture;
  }

  const capture = async (
    label: string,
    opts: { target?: NativeViewHandle; width?: number } = {},
  ): Promise<ScreenshotResult | null> => {
    const target = opts.target ?? rootRef.current;
    if (!target) {
      lastFailure = {
        available: false,
        reason: 'root-unmounted',
        message: 'Screenshot root ref not mounted',
      };
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[bugPilot] ViewShotScreenshotAdapter: root ref not mounted');
      }
      return null;
    }
    try {
      const raw = await mod.captureRef(opts.target ?? rootRef, {
        format: 'png',
        result: 'base64',
        quality: 1,
        ...(opts.width ? { width: opts.width } : {}),
      });
      if (!raw) {
        lastFailure = {
          available: false,
          reason: 'capture-failed',
          message: 'view-shot returned empty image',
        };
        return null;
      }
      lastFailure = null;
      return { base64: normalizeScreenshotBase64(raw), label };
    } catch (err) {
      const nativeMissing = looksLikeNativeMissing(err);
      lastFailure = {
        available: false,
        reason: nativeMissing ? 'native-unlinked' : 'capture-failed',
        message: nativeMissing
          ? 'view-shot JS present but native module missing — rebuild expo-dev-client (Metro reload is not enough)'
          : err instanceof Error
            ? err.message
            : String(err),
      };
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[bugPilot] view-shot capture failed:', lastFailure.message, err);
      }
      return null;
    }
  };

  return {
    captureFullWindow: () => capture('full-window'),
    // No JS-side pixel crop: a region falls back to the full window (bounds stay on
    // element_info). Watched elements use captureElement for a real crop.
    captureRegion: async (_bounds: CaptureRegion) => capture('region-as-full'),
    captureThumbnail: (width: number) => capture('frame', { width }),
    captureElement: (target: NativeViewHandle) => capture('element', { target }),
  };
}

/** True when `require('react-native-view-shot')` succeeds (JS only — not a native-link guarantee). */
export function isViewShotAvailable(): boolean {
  return loadViewShot() != null;
}

/** Last capture failure diagnostic (null after a successful capture). */
export function getLastViewShotFailure(): ViewShotAvailability | null {
  if (loadViewShot() == null) {
    return {
      available: false,
      reason: 'js-missing',
      message:
        'react-native-view-shot not resolvable — install peer + rebuild native app',
    };
  }
  return lastFailure;
}
