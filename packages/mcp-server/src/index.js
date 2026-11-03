#!/usr/bin/env node
/**
 * @bugpilot/mcp-server — read-only MCP over Nest issues/projects APIs.
 *
 * Tools (implemented):
 *   list_projects | get_project | list_issues | get_issue
 *
 * Auth: Bearer Supabase JWT via BUGPILOT_ACCESS_TOKEN (pragmatic default).
 * Env: BUGPILOT_API_URL (default http://localhost:4000), BUGPILOT_PROJECT_ID (optional default).
 *
 * No write/update/create tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { apiGet, getConfig, redactToken } from './client.js';

const TOOLS = [
  {
    name: 'list_projects',
    description:
      'List bugPilot projects visible to the authenticated user (GET /api/projects). Read-only.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_project',
    description: 'Get a single project by id (GET /api/projects/:id). Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project UUID' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_issues',
    description:
      'List issues for a project (GET /api/issues/project/:projectId). Uses BUGPILOT_PROJECT_ID when projectId omitted. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project UUID (optional if BUGPILOT_PROJECT_ID is set)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_issue',
    description:
      'Get issue detail including signed media URLs when present (GET /api/issues/:id). Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Issue UUID' },
      },
      required: ['issueId'],
      additionalProperties: false,
    },
  },
];

function jsonResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err) {
  const message = redactToken(err?.message ?? String(err));
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

async function handleTool(name, args = {}) {
  switch (name) {
    case 'list_projects':
      return jsonResult(await apiGet('/api/projects'));
    case 'get_project': {
      if (!args.projectId) throw new Error('projectId is required');
      return jsonResult(await apiGet(`/api/projects/${encodeURIComponent(args.projectId)}`));
    }
    case 'list_issues': {
      const { defaultProjectId } = getConfig();
      const projectId = (args.projectId ?? defaultProjectId ?? '').trim();
      if (!projectId) {
        throw new Error('projectId required (or set BUGPILOT_PROJECT_ID)');
      }
      return jsonResult(await apiGet(`/api/issues/project/${encodeURIComponent(projectId)}`));
    }
    case 'get_issue': {
      if (!args.issueId) throw new Error('issueId is required');
      return jsonResult(await apiGet(`/api/issues/${encodeURIComponent(args.issueId)}`));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
  // Fail fast on missing token so Cursor shows a clear error at connect time.
  try {
    getConfig();
  } catch (e) {
    console.error(`[bugpilot-mcp] ${e.message}`);
    console.error(
      '[bugpilot-mcp] Set BUGPILOT_ACCESS_TOKEN to a Supabase user JWT (access_token). ' +
        'Optional: BUGPILOT_API_URL, BUGPILOT_PROJECT_ID. No write tools in this server.',
    );
    process.exit(1);
  }

  const server = new Server(
    { name: 'bugpilot', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    try {
      return await handleTool(name, args);
    } catch (err) {
      console.error(`[bugpilot-mcp] ${name}:`, redactToken(err?.message ?? err));
      return errorResult(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[bugpilot-mcp] ready (read-only: list_projects, get_project, list_issues, get_issue)');
}

main().catch((err) => {
  console.error('[bugpilot-mcp] fatal:', redactToken(err?.message ?? err));
  process.exit(1);
});
