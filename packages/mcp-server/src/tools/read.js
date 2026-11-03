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

function truncateIssue(issue) {
  const cut = [];
  const walk = (val, path) => {
    if (Array.isArray(val)) {
      const key = path[path.length - 1] ?? '';
      let arr = val;
      if (/console|network/i.test(key) && val.length > MAX_ARRAY) {
        cut.push(`${path.join('.')} (${val.length} -> ${MAX_ARRAY} entries)`);
        arr = val.slice(0, MAX_ARRAY);
      }
      return arr.map((v, idx) => walk(v, [...path, String(idx)]));
    }
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = walk(v, [...path, k]);
      return out;
    }
    if (typeof val === 'string' && val.length > MAX_STRING && !/url$/i.test(path[path.length - 1] ?? '')) {
      cut.push(`${path.join('.')} (${val.length} -> ${MAX_STRING} chars)`);
      return val.slice(0, MAX_STRING);
    }
    return val;
  };
  const out = walk(issue, []);
  if (cut.length) {
    out.truncated = true;
    out.truncatedFields = cut;
  }
  return out;
}

async function fetchImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    if (len && len > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim() || 'image/png';
    return { type: 'image', data: buf.toString('base64'), mimeType };
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
    for (const u of unique) {
      const img = await fetchImage(u);
      if (img) images.push(img);
      else asUrls.push(u);
    }
    if (asUrls.length) out.screenshotUrls = asUrls;
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, ...images] };
  },
  async list_members(args = {}) {
    const projectId = resolveProjectId(args);
    return jsonResult(await apiGet(`/api/issues/project/${encodeURIComponent(projectId)}/members`));
  },
};
