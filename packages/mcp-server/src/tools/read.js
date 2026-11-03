import { apiGet, getConfig } from '../client.js';

const MAX_ARRAY = 50;
const MAX_STRING = 2000;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function resolveProjectId(args) {
  const { defaultProjectId } = getConfig();
  const projectId = String(args.projectId ?? defaultProjectId ?? '').trim();
  if (!projectId) throw new Error('projectId required (or set BUGPILOT_PROJECT_ID)');
  return projectId;
}

export const tools = [
  {
    name: 'list_projects',
    description: 'List bugPilot projects visible to the authenticated user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_project',
    description: 'Get a single project by id.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: 'Project UUID' } },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_issues',
    description:
      'List issues for a project as compact rows (newest first). Uses BUGPILOT_PROJECT_ID when projectId is omitted. Filters are applied client-side.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project UUID (optional if BUGPILOT_PROJECT_ID is set)' },
        status: { type: 'string', description: 'Only issues with this status' },
        assigneeMemberId: { type: 'string', description: 'Only issues assigned to this member id' },
        severity: { type: 'string', description: 'Only issues with this severity' },
        limit: { type: 'number', description: 'Max rows to return (default 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_issue',
    description:
      'Get full issue detail with comments. Console/network arrays are capped at 50 entries and long strings at 2000 chars (flagged with truncated: true). Screenshots <= 1.5 MB are returned as images, otherwise as URLs.',
    inputSchema: {
      type: 'object',
      properties: { issueId: { type: 'string', description: 'Issue UUID' } },
      required: ['issueId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_members',
    description: 'List assignable workspace members for a project (id, name, email).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project UUID (optional if BUGPILOT_PROJECT_ID is set)' },
      },
      additionalProperties: false,
    },
  },
];

function compactRow(i) {
  return {
    id: i.id,
    title: i.title,
    status: i.status,
    severity: i.severity,
    assignee: i.assignee_member_id ?? i.metadata?.assignee ?? null,
    reporter: i.reporter_id ?? null,
    route: i.route ?? null,
    createdAt: i.created_at,
  };
}

const MAX_ARRAY_ANY = 100;
const MAX_IMAGES = 3;
const MAX_IMAGE_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_PAYLOAD_CHARS = 200_000;
const MAX_URL_CHARS = 4096;
const MAX_TRUNCATED_FIELDS = 20;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Mutable so tests can shorten the image-download timeout. */
export const imageConfig = { timeoutMs: 10000 };

function isHttpUrl(v) {
  return typeof v === 'string' && v.length <= MAX_URL_CHARS && /^https?:\/\//i.test(v);
}

function truncateIssue(issue) {
  const cut = [];
  const walk = (val, path) => {
    if (Array.isArray(val)) {
      const key = path[path.length - 1] ?? '';
      const cap = /console|network/i.test(key) ? MAX_ARRAY : MAX_ARRAY_ANY;
      let arr = val;
      if (val.length > cap) {
        cut.push(`${path.join('.')} (${val.length} -> ${cap} entries)`);
        arr = val.slice(0, cap);
      }
      return arr.map((v, idx) => walk(v, [...path, String(idx)]));
    }
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = walk(v, [...path, k]);
      return out;
    }
    if (typeof val === 'string' && val.length > MAX_STRING) {
      const key = path[path.length - 1] ?? '';
      if (/url$/i.test(key) && isHttpUrl(val)) return val;
      cut.push(`${path.join('.')} (${val.length} -> ${MAX_STRING} chars)`);
      return val.slice(0, MAX_STRING);
    }
    return val;
  };
  const out = walk(issue, []);

  // Final total-size guard: omit the largest fields until the payload fits.
  const protectedKeys = new Set(['id', 'truncated', 'truncatedFields', 'truncatedFieldsCount']);
  for (let guard = 0; guard < 200; guard++) {
    if (JSON.stringify(out).length <= MAX_PAYLOAD_CHARS - 2000) break;
    let best = null;
    const consider = (holder, key, label) => {
      const len = JSON.stringify(holder[key])?.length ?? 0;
      if (!best || len > best.len) best = { holder, key, label, len };
    };
    for (const k of Object.keys(out)) {
      if (protectedKeys.has(k) || typeof out[k] === 'string' && out[k].startsWith('[omitted')) continue;
      consider(out, k, k);
      if (k === 'metadata' && out[k] && typeof out[k] === 'object') {
        for (const mk of Object.keys(out[k])) {
          if (typeof out[k][mk] === 'string' && out[k][mk].startsWith('[omitted')) continue;
          consider(out[k], mk, `metadata.${mk}`);
        }
      }
    }
    if (!best) break;
    // Prefer replacing the child over the whole metadata object when metadata is the largest.
    if (best.label === 'metadata') {
      let child = null;
      for (const mk of Object.keys(out.metadata)) {
        if (typeof out.metadata[mk] === 'string' && out.metadata[mk].startsWith('[omitted')) continue;
        const len = JSON.stringify(out.metadata[mk])?.length ?? 0;
        if (!child || len > child.len) child = { mk, len };
      }
      if (child) best = { holder: out.metadata, key: child.mk, label: `metadata.${child.mk}`, len: child.len };
    }
    cut.push(`${best.label} (omitted, ${best.len} chars, payload size guard)`);
    best.holder[best.key] = `[omitted for size: ${best.len} chars]`;
  }

  if (cut.length) {
    out.truncated = true;
    out.truncatedFields = cut.slice(0, MAX_TRUNCATED_FIELDS);
    if (cut.length > MAX_TRUNCATED_FIELDS) out.truncatedFieldsCount = cut.length;
  }
  return out;
}

function imageFetchAllowed(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:') return false;
  try {
    return new URL(getConfig().apiUrl).protocol === 'http:';
  } catch {
    return false;
  }
}

/** Returns {image, bytes} or null. Never throws. No credentials are sent. */
async function fetchImage(url, maxBytes) {
  if (!imageFetchAllowed(url)) return null;
  const signal = AbortSignal.timeout(imageConfig.timeoutMs);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) return null;
    const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(mimeType)) {
      res.body.cancel?.().catch?.(() => {});
      return null;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks);
    return { image: { type: 'image', data: buf.toString('base64'), mimeType }, bytes: total };
  } catch {
    return null;
  }
}

export const handlers = {
  async list_projects() {
    return jsonResult(await apiGet('/api/projects'));
  },
  async get_project(args = {}) {
    if (!args.projectId) throw new Error('projectId is required');
    return jsonResult(await apiGet(`/api/projects/${encodeURIComponent(args.projectId)}`));
  },
  async list_issues(args = {}) {
    const projectId = resolveProjectId(args);
    const all = await apiGet(`/api/issues/project/${encodeURIComponent(projectId)}`);
    let rows = Array.isArray(all) ? all : [];
    if (args.status) rows = rows.filter((i) => i.status === args.status);
    if (args.severity) rows = rows.filter((i) => i.severity === args.severity);
    if (args.assigneeMemberId) rows = rows.filter((i) => i.assignee_member_id === args.assigneeMemberId);
    rows = [...rows].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    const n = Number(args.limit);
    const limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
    return jsonResult(rows.slice(0, limit).map(compactRow));
  },
  async get_issue(args = {}) {
    if (!args.issueId) throw new Error('issueId is required');
    const id = encodeURIComponent(args.issueId);
    const [issue, comments] = await Promise.all([apiGet(`/api/issues/${id}`), apiGet(`/api/issues/${id}/comments`)]);
    const out = truncateIssue({ ...issue, comments: Array.isArray(comments) ? comments : [] });

    const urls = [];
    for (const u of [issue.screenshot_url, issue.element_screenshot_url]) if (u) urls.push(u);
    for (const s of issue.metadata?.screenshots ?? []) if (s?.url) urls.push(s.url);
    const unique = [...new Set(urls)];

    const images = [];
    const asUrls = [];
    let budget = MAX_IMAGE_TOTAL_BYTES;
    for (const u of unique) {
      if (images.length >= MAX_IMAGES || budget <= 0) {
        asUrls.push(u);
        continue;
      }
      const got = await fetchImage(u, Math.min(MAX_IMAGE_BYTES, budget));
      if (got) {
        images.push(got.image);
        budget -= got.bytes;
      } else asUrls.push(u);
    }
    if (asUrls.length) out.screenshotUrls = asUrls;
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, ...images] };
  },
  async list_members(args = {}) {
    const projectId = resolveProjectId(args);
    return jsonResult(await apiGet(`/api/issues/project/${encodeURIComponent(projectId)}/members`));
  },
};
