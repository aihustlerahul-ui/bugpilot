import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBugPilot } from './BugPilotContext';

declare const __DEV__: boolean | undefined;

function isEnabled(enabled: boolean | undefined): boolean {
  if (enabled !== undefined) return enabled;
  return typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : false;
}

/**
 * Free-floating entry control (#7 Locked).
 * Extension analogue: side panel "Capture Now" / Alt+Shift+Q.
 * Tap → enables selector mode. Hidden when provider disabled (default __DEV__).
 */
export function FloatingBugButton() {
  const { config, mode, openSelector, closeOverlay } = useBugPilot();

  if (!isEnabled(config.enabled)) return null;

  const active = mode !== 'idle';

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? 'Cancel bug capture' : 'Report a bug'}
        onPress={() => (active ? closeOverlay() : openSelector())}
        style={[styles.fab, active && styles.fabActive]}
        testID="bugpilot-fab"
      >
        <Text style={styles.fabLabel}>{active ? '✕' : '🐞'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    zIndex: 9999,
    elevation: 9999,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
  },
  fabActive: {
    backgroundColor: '#B91C1C',
  },
  fabLabel: {
    fontSize: 22,
    color: '#FFFFFF',
  },
});
