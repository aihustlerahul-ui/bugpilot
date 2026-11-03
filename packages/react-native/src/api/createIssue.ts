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
  if (!opts.accessToken?.trim()) {
    return {
      ok: false,
      status: 0,
      message:
        'Missing access token — set EXPO_PUBLIC_BUGPILOT_ACCESS_TOKEN (Supabase JWT) or config.getAccessToken()',
    };
  }

  const base = opts.apiUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.accessToken.trim()}`,
  };

  try {
    const res = await fetch(`${base}/api/issues`, {
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
