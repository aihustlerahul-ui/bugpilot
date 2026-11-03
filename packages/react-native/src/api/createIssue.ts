import type { CreateIssuePayload, ReportFormValues, SelectedElementInfo } from '../types';
import type { ScreenshotResult } from '../screenshot/ScreenshotCapture';

export type CreateIssueOptions = {
  apiUrl: string;
  projectId: string;
  accessToken: string | null;
  form: ReportFormValues;
  element?: SelectedElementInfo | null;
  routeName?: string;
  environmentInfo?: Record<string, unknown>;
  screenshot?: ScreenshotResult | null;
  elementScreenshot?: ScreenshotResult | null;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * Maps RN form + context → extension-compatible POST /api/issues body.
 * [Certain] field names match extension background.js submitIssue payload.
 */
export function buildCreateIssuePayload(opts: CreateIssueOptions): CreateIssuePayload {
  const { form, projectId, element, routeName, environmentInfo, screenshot, elementScreenshot } =
    opts;

  let title = form.title.trim();
  let description = (form.description || '').trim();

  // Extension smart-mode fallback when title empty
  if (!title && form.smartInput?.trim()) {
    const smart = form.smartInput.trim();
    const tName =
      element?.bugpilotName || element?.testID || element?.accessibilityLabel || 'element';
    title =
      smart.length > 5 && smart.length < 80
        ? smart.charAt(0).toUpperCase() + smart.slice(1)
        : `${tName}: ${smart.slice(0, 60)}`;
    description = `### Summary\n${smart}\n\n### Steps to Reproduce\n1. Navigate to \`${routeName || 'unknown'}\`\n2. Interact with \`${tName}\`\n3. Observe: ${smart}`;
  }

  const descriptionForApi = title + (description ? `\n\n${description}` : '');

  const element_info = element
    ? {
        testID: element.testID ?? null,
        accessibilityLabel: element.accessibilityLabel ?? null,
        nativeID: element.nativeID ?? null,
        bugpilotName: element.bugpilotName ?? null,
        text: element.text ?? null,
        dimensions: element.bounds ?? null,
        touch: element.touch ?? null,
        routeName: element.routeName ?? routeName ?? null,
      }
    : undefined;

  return {
    project_id: projectId,
    title,
    description: descriptionForApi,
    severity: form.severity || 'Medium',
    route: routeName,
    browser_info: environmentInfo,
    element_info,
    screenshot: screenshot?.base64,
    element_screenshot: elementScreenshot?.base64,
    metadata: {
      captureSource: 'rn-reporter',
      expectedResult: form.expectedResult || null,
      actualResult: form.actualResult || null,
      priority: form.priority || null,
      environment: form.environment || null,
      labels: form.labels || null,
      mobile: {
        navigation: {
          routeName: routeName || null,
        },
      },
    },
  };
}

export type CreateIssueResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; message: string };

/**
 * JS-only fetch to Nest POST /api/issues.
 * No native deps. Auth header mirrors extension Bearer token.
 */
export async function createIssue(opts: CreateIssueOptions): Promise<CreateIssueResult> {
  const payload = buildCreateIssuePayload(opts);
  if (!payload.title) {
    return { ok: false, status: 0, message: 'Title is required' };
  }
  if (!payload.project_id) {
    return { ok: false, status: 0, message: 'Choose a project' };
  }
  if (!opts.accessToken?.trim()) {
    return {
      ok: false,
      status: 0,
      message: 'Not signed in — sign in to bugPilot (or pass config.getAccessToken())',
    };
  }

  const base = opts.apiUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.accessToken.trim()}`,
  };

  try {
    const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    const res = await doFetch(`${base}/api/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, message: text || res.statusText };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, message };
  }
}

export type SubmitIssueOptions = Omit<CreateIssueOptions, 'accessToken'> & {
  tokens: {
    getAccessToken(): Promise<string | null>;
    refreshAfter401(): Promise<string | null>;
  };
};

/**
 * createIssue with the session token; on 401 refreshes once and retries.
 * Never throws: token-source failures resolve to a failed result.
 */
export async function submitIssue(opts: SubmitIssueOptions): Promise<CreateIssueResult> {
  const { tokens, ...rest } = opts;
  try {
    const token = await tokens.getAccessToken();
    const first = await createIssue({ ...rest, accessToken: token });
    if (first.ok || first.status !== 401) return first;
    const next = await tokens.refreshAfter401();
    if (!next) return first;
    return await createIssue({ ...rest, accessToken: next });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, message };
  }
}
