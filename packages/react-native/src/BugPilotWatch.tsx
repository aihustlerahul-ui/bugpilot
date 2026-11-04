import React, { useEffect, useId, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useBugPilot } from './BugPilotContext';
import type { NativeViewHandle } from './nativeView';

export type BugPilotWatchProps = {
  /** Prefer a stable id. */
  testID?: string;
  /** Opt-in display name stored as bugpilotName on selection. */
  name?: string;
  accessibilityLabel?: string;
  nativeID?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * Optional wrap that registers measureInWindow bounds for selector hit-testing.
 * Lightweight — no Fiber. Hosts add testIDs over time.
 *
 * @example
 * <BugPilotWatch testID="surface-fab" name="Create FAB">
 *   <Pressable>...</Pressable>
 * </BugPilotWatch>
 */
export function BugPilotWatch({
  testID,
  name,
  accessibilityLabel,
  nativeID,
  style,
  children,
}: BugPilotWatchProps) {
  const { registry } = useBugPilot();
  const reactId = useId();
  const idRef = useRef(`bp-watch-${reactId}`);
  const viewRef = useRef<NativeViewHandle>(null);

  const measureAndUpdate = () => {
    viewRef.current?.measureInWindow((x, y, width, height) => {
      registry.update(idRef.current, {
        bounds: { x, y, width, height },
        testID: testID ?? null,
        name: name ?? null,
        accessibilityLabel: accessibilityLabel ?? null,
        nativeID: nativeID ?? null,
      });
    });
  };

  useEffect(() => {
    const id = idRef.current;
    const unregister = registry.register({
      id,
      testID: testID ?? null,
      name: name ?? null,
      accessibilityLabel: accessibilityLabel ?? null,
      nativeID: nativeID ?? null,
      bounds: null,
      ref: viewRef.current,
    });
    const unsubRemeasure = registry.subscribeRemeasure(measureAndUpdate);
    // Initial measure after mount (onLayout may have already fired).
    measureAndUpdate();
    return () => {
      unregister();
      unsubRemeasure();
    };
    // measureAndUpdate closes over latest props; re-register when identity fields change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, testID, name, accessibilityLabel, nativeID]);

  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={style}
      onLayout={measureAndUpdate}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      nativeID={nativeID}
    >
      {children}
    </View>
  );
}

export type WatchOptions = {
  testID?: string;
  name?: string;
  accessibilityLabel?: string;
  nativeID?: string;
};

/**
 * HOC-style helper: `BugPilot.watch({ testID, name })(Component)`.
 */
export function watch<P extends object>(opts: WatchOptions) {
  return function wrap(Component: React.ComponentType<P>): React.FC<P> {
    const Watched: React.FC<P> = (props) => (
      <BugPilotWatch
        testID={opts.testID}
        name={opts.name}
        accessibilityLabel={opts.accessibilityLabel}
        nativeID={opts.nativeID}
      >
        <Component {...props} />
      </BugPilotWatch>
    );
    Watched.displayName = `BugPilotWatch(${opts.name || opts.testID || 'Component'})`;
    return Watched;
  };
}

/** Namespace export for `BugPilot.watch({ ... })`. */
export const BugPilot = {
  watch,
  Watch: BugPilotWatch,
};
