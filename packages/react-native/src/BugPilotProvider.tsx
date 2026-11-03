import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BugPilotContext } from './BugPilotContext';
import { createComponentRegistry } from './registry';
import { createScreenshotCapture } from './screenshot/createScreenshotCapture';
import type { ScreenshotCapture, ScreenshotResult } from './screenshot/ScreenshotCapture';
import type {
  BugPilotCaptureMode,
  BugPilotConfig,
  BugPilotContextValue,
  SelectedElementInfo,
} from './types';

export { useBugPilot } from './BugPilotContext';

declare const __DEV__: boolean | undefined;

function resolveEnabled(config: BugPilotConfig): boolean {
  if (config.enabled !== undefined) return config.enabled;
  return typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : false;
}

export type BugPilotProviderProps = {
  config: BugPilotConfig;
  children: React.ReactNode;
  /**
   * When true (default), render FloatingBugButton **outside** the screenshot root
   * so captures do not include the FAB. Pass false if the host places its own FAB.
   */
  floatingButton?: boolean;
};

/**
 * Lazy overlay requires — keeps Provider → Form/Selector out of the static
 * require graph (avoids Metro require-cycle warnings with context consumers).
 */
function BugPilotOverlays({
  enabled,
  mode,
  floatingButton,
}: {
  enabled: boolean;
  mode: BugPilotCaptureMode;
  floatingButton: boolean;
}) {
  if (!enabled) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SelectorMode } = require('./SelectorMode') as typeof import('./SelectorMode');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ReportForm } = require('./ReportForm') as typeof import('./ReportForm');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FloatingBugButton } = require('./FloatingBugButton') as typeof import('./FloatingBugButton');

  return (
    <>
      {mode === 'selecting' ? <SelectorMode /> : null}
      {mode === 'form' ? <ReportForm /> : null}
      {/* FAB last so cancel taps are not swallowed by the selector hit layer. */}
      {floatingButton ? <FloatingBugButton /> : null}
    </>
  );
}

/**
 * Root provider — wraps children in a capturable View for view-shot.
 * Gates overlays when disabled (default: `__DEV__`).
 * UX: FAB (sibling outside root) → selector → form (extension parity, #7 Locked).
 */
export function BugPilotProvider({
  config,
  children,
  floatingButton = true,
}: BugPilotProviderProps) {
  const [mode, setMode] = useState<BugPilotCaptureMode>('idle');
  const [selected, setSelected] = useState<SelectedElementInfo | null>(null);
  const [pendingScreenshot, setPendingScreenshot] = useState<ScreenshotResult | null>(
    null,
  );

  const rootRef = useRef<View>(null);
  const registryRef = useRef(createComponentRegistry());
  const captureRef = useRef<ScreenshotCapture | null>(null);

  const enabled = resolveEnabled(config);

  if (!captureRef.current) {
    captureRef.current = createScreenshotCapture({
      rootRef,
      override: config.screenshotCapture,
    });
  }

  const openSelector = useCallback(() => {
    if (!enabled) return;
    setSelected(null);
    setPendingScreenshot(null);
    setMode('selecting');
  }, [enabled]);

  const openForm = useCallback(
    (el?: SelectedElementInfo) => {
      if (!enabled) return;
      if (el) setSelected(el);
      setMode('form');
    },
    [enabled],
  );

  const closeOverlay = useCallback(() => {
    setMode('idle');
    setSelected(null);
    setPendingScreenshot(null);
  }, []);

  const value = useMemo<BugPilotContextValue>(
    () => ({
      config,
      mode,
      selected,
      pendingScreenshot,
      screenshotCapture: captureRef.current!,
      registry: registryRef.current,
      setMode,
      setSelected,
      setPendingScreenshot,
      openSelector,
      openForm,
      closeOverlay,
    }),
    [
      config,
      mode,
      selected,
      pendingScreenshot,
      openSelector,
      openForm,
      closeOverlay,
    ],
  );

  return (
    <BugPilotContext.Provider value={value}>
      <View style={styles.shell} pointerEvents="box-none">
        <View ref={rootRef} style={styles.root} collapsable={false}>
          {children}
        </View>
        <BugPilotOverlays
          enabled={enabled}
          mode={mode}
          floatingButton={floatingButton}
        />
      </View>
    </BugPilotContext.Provider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
});
