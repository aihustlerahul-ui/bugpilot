import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AuthClient } from './auth/AuthClient';
import { resolveAccessToken } from './auth/resolveAccessToken';
import { createMemoryAdapter } from './auth/SessionStore';
import { TokenManager } from './auth/TokenManager';
import type { StorageAdapter } from './auth/types';
import { BugPilotContext } from './BugPilotContext';
import type { NativeViewHandle } from './nativeView';
import { createComponentRegistry } from './registry';
import { createScreenshotCapture } from './screenshot/createScreenshotCapture';
import type { ScreenshotCapture, ScreenshotResult } from './screenshot/ScreenshotCapture';
import type {
  BugPilotCaptureMode,
  BugPilotAuthStatus,
  BugPilotConfig,
  BugPilotContextValue,
  BugPilotSession,
  SelectedElementInfo,
} from './types';
import { useProjects } from './useProjects';

export { useBugPilot } from './BugPilotContext';

declare const __DEV__: boolean | undefined;

function resolveEnabled(config: BugPilotConfig): boolean {
  if (config.enabled !== undefined) return config.enabled;
  return typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : false;
}

const SIGN_IN_FAILED = "Couldn't sign in. Check your connection and try again.";
const INVALID_CREDENTIALS = 'Invalid email or password';
const OVERRIDE_USER_KEY = 'token-override';

type AuthKit = { client: AuthClient; manager: TokenManager; storage: StorageAdapter };

/** Never throws: a failure here disables the overlay instead of the host. */
function createAuthKit(config: BugPilotConfig, onSignedOut: () => void): AuthKit | null {
  try {
    const storage = config.storage ?? createMemoryAdapter();
    const client = new AuthClient(config.apiUrl);
    const manager = new TokenManager(client, storage, onSignedOut);
    return { client, manager, storage };
  } catch {
    return null;
  }
}

/** Render failures inside SDK overlays hide the overlay instead of crashing the host. */
class OverlayErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    // Intentionally silent: no host crash, no logging of SDK state.
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
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
  // Boundary wraps the component that performs the lazy requires, so a failed
  // require or render inside the SDK hides the overlay instead of the host.
  return (
    <OverlayErrorBoundary>
      <OverlayContent mode={mode} floatingButton={floatingButton} />
    </OverlayErrorBoundary>
  );
}

function OverlayContent({
  mode,
  floatingButton,
}: {
  mode: BugPilotCaptureMode;
  floatingButton: boolean;
}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SelectorMode } = require('./SelectorMode') as typeof import('./SelectorMode');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SignInSheet } = require('./SignInSheet') as typeof import('./SignInSheet');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ReportForm } = require('./ReportForm') as typeof import('./ReportForm');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FloatingBugButton } = require('./FloatingBugButton') as typeof import('./FloatingBugButton');

  return (
    <>
      {mode === 'signin' ? <SignInSheet /> : null}
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

  const rootRef = useRef<NativeViewHandle>(null);
  const registryRef = useRef(createComponentRegistry());
  const captureRef = useRef<ScreenshotCapture | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const [session, setSession] = useState<BugPilotSession | null>(null);
  const [authStatus, setAuthStatus] = useState<BugPilotAuthStatus>('loading');
  /** Projects load lazily on first FAB use, not at host app start. */
  const [engaged, setEngaged] = useState(false);

  // TokenManager reports a rejected refresh; reopen the sheet if selecting.
  const onSignedOutRef = useRef<() => void>(() => undefined);
  onSignedOutRef.current = () => {
    setSession(null);
    setAuthStatus('signedOut');
    setMode((m) => (m === 'selecting' ? 'signin' : m));
  };

  const authRef = useRef<{ kit: AuthKit | null } | null>(null);
  if (!authRef.current) {
    authRef.current = { kit: createAuthKit(config, () => onSignedOutRef.current()) };
  }
  const kit = authRef.current.kit;

  const enabled = resolveEnabled(config);
  const overlayAvailable = enabled && kit !== null;
  const usingTokenOverride = typeof config.getAccessToken === 'function';

  if (!captureRef.current) {
    captureRef.current = createScreenshotCapture({
      rootRef,
      override: config.screenshotCapture,
    });
  }

  // Restore a persisted session (dev/QA builds only).
  useEffect(() => {
    if (!overlayAvailable || !kit) return;
    let cancelled = false;
    kit.manager
      .getUser()
      .then((user) => {
        if (cancelled) return;
        setSession(user ? { user } : null);
        setAuthStatus(user ? 'signedIn' : 'signedOut');
      })
      .catch(() => {
        if (!cancelled) setAuthStatus('signedOut');
      });
    return () => {
      cancelled = true;
    };
  }, [overlayAvailable, kit]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!kit) return null;
    return resolveAccessToken(configRef.current, kit.manager);
  }, [kit]);

  const refreshAfter401 = useCallback(async (): Promise<string | null> => {
    if (!kit) return null;
    try {
      // With an override the host owns tokens: ask it again instead of refreshing.
      if (configRef.current.getAccessToken) {
        return await resolveAccessToken(configRef.current, kit.manager);
      }
      return await kit.manager.refreshAfter401();
    } catch {
      return null;
    }
  }, [kit]);

  const tokens = useMemo(
    () => ({ getAccessToken, refreshAfter401 }),
    [getAccessToken, refreshAfter401],
  );

  const userKey =
    overlayAvailable && engaged
      ? session?.user.id || (usingTokenOverride ? OVERRIDE_USER_KEY : null)
      : null;

  const {
    projects,
    reload: reloadProjects,
    projectId,
    setProjectId,
    projectLocked,
  } = useProjects({
    client: kit?.client ?? null,
    tokens,
    storage: kit?.storage ?? null,
    userKey,
    lockedProjectId: config.projectId || undefined,
  });

  /** Internal: enter selector mode without auth checks (after sign-in succeeds). */
  const enterSelector = useCallback(() => {
    if (!overlayAvailable) return;
    setEngaged(true);
    setSelected(null);
    setPendingScreenshot(null);
    setMode('selecting');
  }, [overlayAvailable]);

  const openForm = useCallback(
    (el?: SelectedElementInfo) => {
      if (!overlayAvailable) return;
      if (el) setSelected(el);
      setMode('form');
    },
    [overlayAvailable],
  );

  const closeOverlay = useCallback(() => {
    setMode('idle');
    setSelected(null);
    setPendingScreenshot(null);
  }, []);

  /**
   * Public entry (FAB and hosts with their own button): signed in or token
   * override → selector (and projects load); signed out → sign-in sheet.
   */
  const startCapture = useCallback(() => {
    if (!overlayAvailable || !kit) return;
    setEngaged(true);
    if (usingTokenOverride || session) {
      enterSelector();
      return;
    }
    // Session may still be restoring: check storage before asking to sign in.
    void (async () => {
      let user = null;
      try {
        user = await kit.manager.getUser();
      } catch {
        user = null;
      }
      if (user) {
        setSession({ user });
        setAuthStatus('signedIn');
        enterSelector();
      } else {
        setAuthStatus('signedOut');
        setMode('signin');
      }
    })();
  }, [overlayAvailable, kit, usingTokenOverride, session, enterSelector]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      if (!kit) throw new Error(SIGN_IN_FAILED);
      let next;
      try {
        next = await kit.manager.signIn(email.trim(), password);
      } catch (e) {
        // Only the known-safe message is surfaced; never the raw error.
        throw new Error(
          e instanceof Error && e.message === INVALID_CREDENTIALS
            ? INVALID_CREDENTIALS
            : SIGN_IN_FAILED,
        );
      }
      setSession({
        user: { id: next.user?.id ?? '', email: next.user?.email ?? email.trim() },
      });
      setAuthStatus('signedIn');
      setEngaged(true);
    },
    [kit],
  );

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await kit?.manager.signOut();
    } catch {
      // never throw into the host
    }
    setSession(null);
    setAuthStatus('signedOut');
    closeOverlay();
  }, [kit, closeOverlay]);

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
      openSelector: startCapture,
      enterSelector,
      openForm,
      closeOverlay,
      overlayAvailable,
      startCapture,
      authStatus,
      session,
      usingTokenOverride,
      signIn,
      signOut,
      projects,
      reloadProjects,
      projectId,
      setProjectId,
      projectLocked,
      getAccessToken,
      refreshAfter401,
    }),
    [
      config,
      mode,
      selected,
      pendingScreenshot,
      enterSelector,
      openForm,
      closeOverlay,
      overlayAvailable,
      startCapture,
      authStatus,
      session,
      usingTokenOverride,
      signIn,
      signOut,
      projects,
      reloadProjects,
      projectId,
      setProjectId,
      projectLocked,
      getAccessToken,
      refreshAfter401,
    ],
  );

  return (
    <BugPilotContext.Provider value={value}>
      <View style={styles.shell} pointerEvents="box-none">
        <View ref={rootRef} style={styles.root} collapsable={false}>
          {children}
        </View>
        <BugPilotOverlays
          enabled={overlayAvailable}
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
