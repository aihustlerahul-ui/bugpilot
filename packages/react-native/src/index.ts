/**
 * @bugpilot/react-native — Track A Phase 2
 * Floating FAB → selector → on-device form → POST /api/issues
 */

export { BugPilotProvider, useBugPilot } from './BugPilotProvider';
export type { BugPilotProviderProps } from './BugPilotProvider';

export { FloatingBugButton } from './FloatingBugButton';
export { SelectorMode } from './SelectorMode';
export { ReportForm } from './ReportForm';

export { BugPilot, BugPilotWatch, watch } from './BugPilotWatch';
export type { BugPilotWatchProps, WatchOptions } from './BugPilotWatch';

export { createIssue, buildCreateIssuePayload } from './api/createIssue';
export type { CreateIssueOptions, CreateIssueResult } from './api/createIssue';

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
  BugPilotCaptureMode,
  BugPilotContextValue,
  BugSeverity,
  CreateIssuePayload,
  ReportFormValues,
  SelectedElementInfo,
} from './types';
