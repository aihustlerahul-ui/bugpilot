import { apiRequest } from '../client.js';

export const ISSUE_STATUSES = ['Incoming', 'In Triage', 'Confirmed', 'In Dev', 'Resolved', 'Closed'];

const MAX_COMMENT_CHARS = 5000;

const GUIDANCE =
  'Use ONLY when the developer explicitly asked for this action; never auto-resolve or change issues on your own initiative. ' +
  'Intended finish sequence, after a fix the developer asked you to make: add_comment (what was changed and how to verify) -> assign_to_reporter -> update_issue_status "Resolved".';

function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function requireId(args, key = 'issueId') {
  const v = typeof args[key] === 'string' ? args[key].trim() : '';
  if (!v) throw new Error(`${key} is required`);
  return encodeURIComponent(v);
}

export const tools = [
  {
    name: 'add_comment',
    description: `Add a comment to an issue (recorded with source "mcp"). ${GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Issue UUID' },
        body: { type: 'string', description: `Comment text, 1-${MAX_COMMENT_CHARS} chars` },
      },
      required: ['issueId', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_issue_status',
    description: `Set an issue's status (${ISSUE_STATUSES.join(' | ')}). Project owners may set any status; other project members may only set Resolved (otherwise the backend returns 403). ${GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Issue UUID' },
        status: { type: 'string', enum: ISSUE_STATUSES },
      },
      required: ['issueId', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'assign_issue',
    description: `Assign an issue to a project member by member id (see list_members), or pass memberId null to clear the assignee. memberId is required. ${GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Issue UUID' },
        memberId: { type: ['string', 'null'], description: 'Member id, or null to unassign' },
      },
      required: ['issueId', 'memberId'],
      additionalProperties: false,
    },
  },
  {
    name: 'assign_to_reporter',
    description: `Assign an issue back to the person who reported it. If the reporter has no member row in the project, fails with the list of assignable members and changes nothing. ${GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: { issueId: { type: 'string', description: 'Issue UUID' } },
      required: ['issueId'],
      additionalProperties: false,
    },
  },
];

async function patchAssignee(id, memberId) {
  // memberId key is always present (explicit null clears); the backend rejects a missing key (400), so it is never omitted.
  return apiRequest('PATCH', `/api/issues/${id}/assignee`, { body: { memberId } });
}

export const handlers = {
  async add_comment(args = {}) {
    const id = requireId(args);
    const body = typeof args.body === 'string' ? args.body.trim() : '';
    if (!body) throw new Error('body is required and must be non-empty');
    if (body.length > MAX_COMMENT_CHARS) throw new Error(`body must be at most ${MAX_COMMENT_CHARS} characters (got ${body.length})`);
    const c = await apiRequest('POST', `/api/issues/${id}/comments`, { body: { body } });
    return jsonResult({ ok: true, issueId: args.issueId.trim(), commentId: c?.id ?? null, source: c?.source ?? 'mcp' });
  },

  async update_issue_status(args = {}) {
    const id = requireId(args);
    if (!ISSUE_STATUSES.includes(args.status)) {
      throw new Error(`status must be one of: ${ISSUE_STATUSES.join(', ')}`);
    }
    await apiRequest('PATCH', `/api/issues/${id}/status`, { body: { status: args.status } });
    return jsonResult({ ok: true, issueId: args.issueId.trim(), status: args.status });
  },

  async assign_issue(args = {}) {
    const id = requireId(args);
    const m = args.memberId;
    if (m !== null && (typeof m !== 'string' || !m.trim())) {
      throw new Error('memberId is required: pass a member id string, or null to clear the assignee');
    }
    const memberId = m === null ? null : m.trim();
    const issue = await patchAssignee(id, memberId);
    return jsonResult({ ok: true, issueId: args.issueId.trim(), assigneeMemberId: issue?.assignee_member_id ?? memberId });
  },

  async assign_to_reporter(args = {}) {
    const id = requireId(args);
    const issue = await apiRequest('GET', `/api/issues/${id}`);
    const reporter = issue?.reporter ?? {};
    if (!reporter.memberId) {
      let list = '';
      if (issue?.project_id) {
        const members = await apiRequest('GET', `/api/issues/project/${encodeURIComponent(issue.project_id)}/members`);
        list = (Array.isArray(members) ? members : [])
          .map((m) => `${m.name ?? '(no name)'} <${m.email ?? 'no email'}> (${m.id})`)
          .join('; ');
      }
      const who = reporter.name || reporter.email || 'The reporter';
      throw new Error(
        `${who} has no member row in this project, so the issue was not assigned. ` +
          `Use assign_issue with one of the assignable members: ${list || '(none found)'}`,
      );
    }
    const updated = await patchAssignee(id, reporter.memberId);
    return jsonResult({
      ok: true,
      issueId: args.issueId.trim(),
      assigneeMemberId: updated?.assignee_member_id ?? reporter.memberId,
      reporter: { name: reporter.name ?? null, email: reporter.email ?? null },
    });
  },
};
