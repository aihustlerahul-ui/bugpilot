/**
 * Shared types for @bugpilot/react-native (Track A Phase 2).
 * Parity target: extension buildIssue + background submitIssue payload.
 */

import type { ComponentRegistry } from './registry';
import type { StorageAdapter } from './auth/types';
import type { ScreenshotCapture, ScreenshotResult } from './screenshot/ScreenshotCapture';

export type BugSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export type BugPilotConfig = {
  /** Nest API origin, e.g. http://localhost:4000 */
  apiUrl: string;
  /** Target project; when omitted the user picks one after sign-in. */
  projectId?: string;
  /**
   * Override that bypasses the built-in TokenManager (CI / Maestro use).
   * When omitted, tokens come from the signed-in session.
   */
  getAccessToken?: () => Promise<string | null>;
  /** Session persistence (e.g. createSecureStoreAdapter(SecureStore)). */
  storage?: StorageAdapter;
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

export type BugPilotCaptureMode = 'idle' | 'selecting' | 'form';

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
  openSelector: () => void;
  openForm: (el?: SelectedElementInfo) => void;
  closeOverlay: () => void;
};
