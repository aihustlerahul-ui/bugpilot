/**
 * @bugpilot/react-native
 * Floating FAB → selector → on-device form → POST /api/issues
 */

export { BugPilotProvider, useBugPilot } from './BugPilotProvider';
export type { BugPilotProviderProps } from './BugPilotProvider';

export { FloatingBugButton } from './FloatingBugButton';
export { SelectorMode } from './SelectorMode';
export { ReportForm } from './ReportForm';
export { SignInSheet, SignInPanel } from './SignInSheet';
export type { SignInPanelProps } from './SignInSheet';
export { ProjectBar } from './ProjectBar';
export { ProjectList } from './ProjectList';
export { useProjects } from './useProjects';
export type { UseProjectsOptions, UseProjectsResult } from './useProjects';
export {
  resolveInitialProject,
  loadProjects,
  loadLastProjectId,
  saveLastProjectId,
} from './projectSelection';

export { AuthClient, AuthError } from './auth/AuthClient';
export { TokenManager } from './auth/TokenManager';
export { createMemoryAdapter, createSecureStoreAdapter } from './auth/SessionStore';
export type { SecureStoreLike } from './auth/SessionStore';
export { resolveAccessToken } from './auth/resolveAccessToken';
export type { AuthSession, AuthUser, ProjectSummary, StorageAdapter } from './auth/types';

export { BugPilot, BugPilotWatch, watch } from './BugPilotWatch';
export type { BugPilotWatchProps, WatchOptions } from './BugPilotWatch';

export { createIssue, buildCreateIssuePayload, submitIssue } from './api/createIssue';
export type {
  CreateIssueOptions,
  CreateIssueResult,
  SubmitIssueOptions,
} from './api/createIssue';

export {
  noopScreenshotCapture,
  normalizeScreenshotBase64,
} from './screenshot/ScreenshotCapture';
export type {
  ScreenshotCapture,
  ScreenshotResult,
  CaptureRegion,
} from './screenshot/ScreenshotCapture';
export {
  createViewShotScreenshotAdapter,
  isViewShotAvailable,
  getLastViewShotFailure,
} from './screenshot/ViewShotScreenshotAdapter';
export type { ViewShotAvailability } from './screenshot/ViewShotScreenshotAdapter';
export { createScreenshotCapture } from './screenshot/createScreenshotCapture';

export type {
  BugPilotConfig,
  BugPilotAuthStatus,
  BugPilotCaptureMode,
  BugPilotContextValue,
  BugPilotSession,
  ProjectsState,
  BugSeverity,
  CreateIssuePayload,
  ReportFormValues,
  SelectedElementInfo,
} from './types';
