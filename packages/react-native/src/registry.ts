import type { NativeViewHandle } from './nativeView';
import type { SelectedElementInfo } from './types';

export type RegisteredBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RegisteredTarget = {
  id: string;
  testID?: string | null;
  name?: string | null;
  accessibilityLabel?: string | null;
  nativeID?: string | null;
  bounds: RegisteredBounds | null;
  /** Mounted view, used for an element-only screenshot. */
  ref?: NativeViewHandle | null;
};

type Listener = () => void;

/**
 * Lightweight component registry for selector hit-testing.
 * Hosts opt in via `<BugPilotWatch />` / `BugPilot.watch` — no Fiber walk.
 */
export function createComponentRegistry() {
  const targets = new Map<string, RegisteredTarget>();
  const listeners = new Set<Listener>();
  const remasureListeners = new Set<Listener>();

  const notify = () => {
    listeners.forEach((l) => l());
  };

  return {
    register(target: RegisteredTarget) {
      targets.set(target.id, target);
      notify();
      return () => {
        targets.delete(target.id);
        notify();
      };
    },

    update(id: string, patch: Partial<Omit<RegisteredTarget, 'id'>>) {
      const prev = targets.get(id);
      if (!prev) return;
      targets.set(id, { ...prev, ...patch });
      notify();
    },

    unregister(id: string) {
      if (targets.delete(id)) notify();
    },

    /** Ask BugPilotWatch wrappers to refresh measureInWindow bounds. */
    requestRemeasure() {
      remasureListeners.forEach((l) => l());
    },

    subscribeRemeasure(listener: Listener) {
      remasureListeners.add(listener);
      return () => remasureListeners.delete(listener);
    },

    /** Smallest registered rect containing (pageX, pageY), if any. */
    hitTest(pageX: number, pageY: number): RegisteredTarget | null {
      let best: RegisteredTarget | null = null;
      let bestArea = Number.POSITIVE_INFINITY;
      for (const t of targets.values()) {
        const b = t.bounds;
        if (!b || b.width <= 0 || b.height <= 0) continue;
        if (
          pageX >= b.x &&
          pageX <= b.x + b.width &&
          pageY >= b.y &&
          pageY <= b.y + b.height
        ) {
          const area = b.width * b.height;
          if (area < bestArea) {
            bestArea = area;
            best = t;
          }
        }
      }
      return best;
    },

    list(): RegisteredTarget[] {
      return Array.from(targets.values());
    },

    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ComponentRegistry = ReturnType<typeof createComponentRegistry>;

export function registeredToSelected(
  hit: RegisteredTarget | null,
  touch: { x: number; y: number },
  routeName?: string | null,
): SelectedElementInfo {
  if (!hit) {
    return {
      touch,
      routeName: routeName ?? null,
      bugpilotName: 'coordinate-capture',
      text: `tap@(${Math.round(touch.x)},${Math.round(touch.y)})`,
      bounds: {
        x: Math.max(0, touch.x - 24),
        y: Math.max(0, touch.y - 24),
        width: 48,
        height: 48,
      },
    };
  }
  return {
    testID: hit.testID ?? null,
    accessibilityLabel: hit.accessibilityLabel ?? null,
    nativeID: hit.nativeID ?? null,
    bugpilotName: hit.name ?? null,
    text: hit.name || hit.testID || hit.accessibilityLabel || null,
    bounds: hit.bounds ?? undefined,
    touch,
    routeName: routeName ?? null,
  };
}
