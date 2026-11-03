/**
 * Thin HTTP client for Nest `/api/*`.
 * Auth: BUGPILOT_API_KEY (+ BUGPILOT_WORKSPACE_ID) preferred; BUGPILOT_ACCESS_TOKEN
 * (Supabase JWT) is a Bearer-only fallback.
 */

export function getConfig() {
  const apiUrl = (process.env.BUGPILOT_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  const defaultProjectId = (process.env.BUGPILOT_PROJECT_ID ?? '').trim() || undefined;
  const apiKey = (process.env.BUGPILOT_API_KEY ?? '').trim();
  if (apiKey) {
    const workspaceId = (process.env.BUGPILOT_WORKSPACE_ID ?? '').trim();
    if (!workspaceId) {
      throw new Error(
        'Missing required env: BUGPILOT_WORKSPACE_ID (required when BUGPILOT_API_KEY is set)',
      );
    }
    return { apiUrl, credential: apiKey, workspaceId, defaultProjectId };
  }
  const token = (process.env.BUGPILOT_ACCESS_TOKEN ?? '').trim();
  if (token) return { apiUrl, credential: token, workspaceId: undefined, defaultProjectId };
  throw new Error(
    'Missing credentials: set BUGPILOT_API_KEY (+ BUGPILOT_WORKSPACE_ID), or BUGPILOT_ACCESS_TOKEN as a fallback',
  );
}

/**
 * @param {'GET'|'POST'|'PATCH'} method
 * @param {string} path - e.g. `/api/projects`
 * @param {{ query?: Record<string,string>, body?: unknown }} [opts]
 */
export async function apiRequest(method, path, opts = {}) {
  const { apiUrl, credential, workspaceId } = getConfig();
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('apiRequest path must be a relative API path starting with a single "/"');
  }
  const url = new URL(`${apiUrl}${path}`);
  if (url.origin !== new URL(apiUrl).origin) {
    throw new Error('apiRequest path must stay on the configured API origin');
  }
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: 'application/json', Authorization: `Bearer ${credential}` };
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  const init = { method, headers };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(redactToken(e?.message ?? String(e)));
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (body && (body.message || body.error || body.msg)) ||
      `HTTP ${res.status} ${res.statusText}`;
    throw new Error(redactToken(typeof msg === 'string' ? msg : JSON.stringify(msg)));
  }
  return body;
}

export function apiGet(path, query) {
  return apiRequest('GET', path, { query });
}

export function redactToken(s) {
  return String(s ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/bp_live_[A-Za-z0-9_\-]*/g, 'bp_live_[REDACTED]');
}
