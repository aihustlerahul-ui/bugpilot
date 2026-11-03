import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBugPilot } from './BugPilotContext';

/**
 * Free-floating entry control (#7 Locked).
 * Extension analogue: side panel "Capture Now" / Alt+Shift+Q.
 * Tap → selector mode when signed in, sign-in sheet when signed out.
 * Hidden when the overlay is unavailable (disabled — default __DEV__ — or auth
 * failed to initialise).
 */
export function FloatingBugButton() {
  const { overlayAvailable, mode, startCapture, closeOverlay } = useBugPilot();

  if (!overlayAvailable) return null;

  const active = mode !== 'idle';

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? 'Cancel bug capture' : 'Report a bug'}
        onPress={() => (active ? closeOverlay() : startCapture())}
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
