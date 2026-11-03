/**
 * Shared types for @bugpilot/react-native (Track A Phase 2).
 * Parity target: extension buildIssue + background submitIssue payload.
 */

import type { ComponentRegistry } from './registry';
import type { AuthUser, ProjectSummary, StorageAdapter } from './auth/types';
import type { ScreenshotCapture, ScreenshotResult } from './screenshot/ScreenshotCapture';

export type BugSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export type BugPilotConfig = {
  /** Nest API origin, e.g. http://localhost:4000 */
  apiUrl: string;
  /**
   * Locks the target project for this host build. When the signed-in user
   * cannot access it, the picker opens with an error. When omitted the user
   * picks one after sign-in (last choice remembered per user).
   */
  projectId?: string;
  /**
   * Override that bypasses the built-in TokenManager (CI / Maestro use).
   * When omitted, tokens come from the signed-in session.
   */
  getAccessToken?: () => Promise<string | null>;
  /** Session persistence (e.g. createSecureStoreAdapter(SecureStore)). */
  storage?: StorageAdapter;
  /**
   * Host app version shown in the form and sent as browser_info.appVersion,
   * e.g. Constants.expoConfig?.version. No native dependency needed.
   */
  appVersion?: string;
  /**
   * Overlay gate. Defaults to `__DEV__` when omitted.
   * Pass `true` for QA builds; `false` to force off in development.
   */
  enabled?: boolean;
  /** Optional navigation route snapshot from host */
  getRouteName?: () => string | undefined;
  getRouteParams?: () => Record<string, unknown> | undefined;
  /** Inject custom screenshot backend (tests / non-view-shot hosts). */
  screenshotCapture?: ScreenshotCapture | null;
};

/** RN analogue of extension element_info — no CSS/XPath */
export type SelectedElementInfo = {
  testID?: string | null;
  accessibilityLabel?: string | null;
  nativeID?: string | null;
  /** Opt-in display name from host wrapper */
  bugpilotName?: string | null;
  text?: string | null;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  touch?: { x: number; y: number };
  routeName?: string | null;
};

export type ReportFormValues = {
  title: string;
  description?: string;
  severity: BugSeverity;
  /** Smart-mode single input (extension qa-smart-input) */
  smartInput?: string;
  expectedResult?: string;
  actualResult?: string;
  priority?: BugSeverity;
  environment?: string;
  labels?: string[];
};

/** Subset of CreateIssueDto + metadata bag used by extension submit */
export type CreateIssuePayload = {
  project_id: string;
  title: string;
  description: string;
  severity: string;
  url?: string;
  route?: string;
  browser_info?: Record<string, unknown>;
  element_info?: Record<string, unknown>;
  screenshot?: string;
  element_screenshot?: string;
  metadata?: Record<string, unknown>;
};

/** `signin` = sign-in sheet shown after a FAB tap while signed out. */
export type BugPilotCaptureMode = 'idle' | 'signin' | 'selecting' | 'form';

/** Public session info — never carries tokens. */
export type BugPilotSession = { user: AuthUser };

export type BugPilotAuthStatus = 'loading' | 'signedOut' | 'signedIn';

export type ProjectsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  projects: ProjectSummary[];
  /** Load error or locked-project error to show above the picker. */
  error: string | null;
};

export type BugPilotContextValue = {
  config: BugPilotConfig;
  mode: BugPilotCaptureMode;
  selected: SelectedElementInfo | null;
  /** Last capture before form (may be null if peerDep missing). */
  pendingScreenshot: ScreenshotResult | null;
  screenshotCapture: ScreenshotCapture;
  registry: ComponentRegistry;
  setMode: (mode: BugPilotCaptureMode) => void;
  setSelected: (el: SelectedElementInfo | null) => void;
  setPendingScreenshot: (shot: ScreenshotResult | null) => void;
  /** Same as startCapture: sign-in sheet when signed out, else selector. */
  openSelector: () => void;
  /** Internal: selector without auth checks (used right after sign-in). */
  enterSelector: () => void;
  openForm: (el?: SelectedElementInfo) => void;
  closeOverlay: () => void;
  /** False when disabled by config/__DEV__ or when SDK auth failed to initialise. */
  overlayAvailable: boolean;
  /** FAB entry: signed in (or token override) → selector; otherwise sign-in sheet. */
  startCapture: () => void;
  authStatus: BugPilotAuthStatus;
  /** Signed-in user, or null when signed out / using the token override. */
  session: BugPilotSession | null;
  /** True when config.getAccessToken overrides the built-in session. */
  usingTokenOverride: boolean;
  /** Throws with a user-safe message on failure (shown by the sign-in sheet). */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  projects: ProjectsState;
  reloadProjects: () => void;
  projectId: string | null;
  setProjectId: (projectId: string) => void;
  /** True when config.projectId locks the project and the user can access it. */
  projectLocked: boolean;
  /** Token for API calls (override or session). Never throws. */
  getAccessToken: () => Promise<string | null>;
  /** Refresh after a 401. Never throws; null when the session is gone. */
  refreshAfter401: () => Promise<string | null>;
};
