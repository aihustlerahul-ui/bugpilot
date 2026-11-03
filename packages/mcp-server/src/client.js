/**
 * Thin read-only HTTP client for Nest `/api/*` (Supabase JWT Bearer).
 * Auth default: BUGPILOT_ACCESS_TOKEN = Supabase user access_token (JWT).
 * PAT is not implemented — Nest uses SupabaseAuthGuard today.
 */

function requireEnv(name) {
  const v = (process.env[name] ?? '').trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function getConfig() {
  const apiUrl = (process.env.BUGPILOT_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  const token = requireEnv('BUGPILOT_ACCESS_TOKEN');
  const defaultProjectId = (process.env.BUGPILOT_PROJECT_ID ?? '').trim() || undefined;
  return { apiUrl, token, defaultProjectId };
}

/**
 * @param {string} path - Absolute path under API host, e.g. `/api/projects`
 * @param {Record<string, string>} [query]
 */
export async function apiGet(path, query) {
  const { apiUrl, token } = getConfig();
  const url = new URL(path.startsWith('http') ? path : `${apiUrl}${path.startsWith('/') ? '' : '/'}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
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
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return body;
}

export function redactToken(s) {
  return String(s ?? '').replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
}
