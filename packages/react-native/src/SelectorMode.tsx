import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBugPilot } from './BugPilotContext';
import { registeredToSelected } from './registry';
import type { SelectedElementInfo } from './types';

type Highlight = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Selector mode — extension analogue: highlight + click element.
 *
 * Phase 2: remasure watches → registry hit-test (BugPilotWatch) or coordinate
 * fallback; show highlight from bounds / touch pad; then open form.
 * Optional screenshot of provider root before form (view-shot peer).
 */
export function SelectorMode() {
  const {
    openForm,
    closeOverlay,
    config,
    registry,
    screenshotCapture,
    setPendingScreenshot,
  } = useBugPilot();
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [busy, setBusy] = useState(false);

  const finishSelect = useCallback(
    async (selected: SelectedElementInfo, box: Highlight) => {
      setHighlight(box);
      setBusy(true);
      try {
        // Brief paint so user sees highlight; capture app root (overlays sit outside root View).
        await new Promise((r) => setTimeout(r, 80));
        const shot = await screenshotCapture.captureFullWindow();
        setPendingScreenshot(shot);
      } catch {
        setPendingScreenshot(null);
      } finally {
        setBusy(false);
        openForm(selected);
      }
    },
    [openForm, screenshotCapture, setPendingScreenshot],
  );

  const onSelectAt = (pageX: number, pageY: number) => {
    if (busy) return;
    const routeName = config.getRouteName?.() ?? null;
    // Refresh measureInWindow bounds before hit-test (scroll / layout drift).
    registry.requestRemeasure();
    // measureInWindow callbacks are sync once the native bridge returns;
    // yield one frame so remasure listeners can flush.
    requestAnimationFrame(() => {
      const hit = registry.hitTest(pageX, pageY);
      const selected = registeredToSelected(hit, { x: pageX, y: pageY }, routeName);
      const box: Highlight = selected.bounds
        ? { ...selected.bounds }
        : {
            x: Math.max(0, pageX - 24),
            y: Math.max(0, pageY - 24),
            width: 48,
            height: 48,
          };
      void finishSelect(selected, box);
    });
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none" testID="bugpilot-selector">
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          {busy ? 'Capturing…' : 'Tap a UI region to report a bug'}
        </Text>
        <Pressable
          onPress={closeOverlay}
          accessibilityRole="button"
          accessibilityLabel="Cancel bug selector"
          disabled={busy}
          testID="bugpilot-selector-cancel"
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      {highlight ? (
        <View
          pointerEvents="none"
          style={[
            styles.highlight,
            {
              left: highlight.x,
              top: highlight.y,
              width: highlight.width,
              height: highlight.height,
            },
          ]}
        />
      ) : null}

      <Pressable
        style={styles.hitLayer}
        disabled={busy}
        accessibilityLabel="Bug selector hit layer"
        testID="bugpilot-selector-hit"
        onPress={(e) => {
          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          onSelectAt(pageX ?? locationX, pageY ?? locationY);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 9998,
    elevation: 9998,
  },
  banner: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  bannerText: {
    color: '#F9FAFB',
    fontSize: 14,
    flex: 1,
    marginRight: 12,
  },
  cancel: {
    color: '#FCA5A5',
    fontSize: 14,
    fontWeight: '600',
  },
  hitLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderRadius: 4,
    zIndex: 1,
  },
});
