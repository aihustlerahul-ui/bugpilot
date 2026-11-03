import type { RefObject } from 'react';
import type { NativeViewHandle } from '../nativeView';
import { noopScreenshotCapture, type ScreenshotCapture } from './ScreenshotCapture';
import {
  createViewShotScreenshotAdapter,
  isViewShotAvailable,
} from './ViewShotScreenshotAdapter';

export type CreateScreenshotCaptureOptions = {
  rootRef: RefObject<NativeViewHandle | null>;
  /** Inject a custom capture impl (tests / host override). */
  override?: ScreenshotCapture | null;
};

/**
 * Resolve screenshot backend: override → view-shot peer → noop (+ warning).
 */
export function createScreenshotCapture(
  opts: CreateScreenshotCaptureOptions,
): ScreenshotCapture {
  if (opts.override) return opts.override;
  if (isViewShotAvailable()) {
    return createViewShotScreenshotAdapter(opts.rootRef);
  }
  return noopScreenshotCapture;
}
