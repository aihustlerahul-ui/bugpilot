#!/usr/bin/env node
/**
 * @bugpilot/mcp-server — MCP over Nest issues/projects APIs.
 *
 * Auth: BUGPILOT_API_KEY (+ BUGPILOT_WORKSPACE_ID) preferred; BUGPILOT_ACCESS_TOKEN fallback.
 * Env: BUGPILOT_API_URL (default http://localhost:4000), BUGPILOT_PROJECT_ID (optional default).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getConfig, redactToken } from './client.js';
import { tools as readTools, handlers as readHandlers } from './tools/read.js';

const TOOLS = [...readTools];
const HANDLERS = { ...readHandlers };

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
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  const result = await handler(args);
  return result && Array.isArray(result.content) ? result : jsonResult(result);
}

async function main() {
  // Fail fast on missing token so Cursor shows a clear error at connect time.
  try {
    getConfig();
  } catch (e) {
    console.error(`[bugpilot-mcp] ${e.message}`);
    console.error(
      '[bugpilot-mcp] Set BUGPILOT_API_KEY (bp_live_...) and BUGPILOT_WORKSPACE_ID; ' +
        'BUGPILOT_ACCESS_TOKEN (Supabase JWT) works as a Bearer-only fallback. ' +
        'Optional: BUGPILOT_API_URL (default http://localhost:4000), BUGPILOT_PROJECT_ID.',
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
  console.error(`[bugpilot-mcp] ready (tools: ${TOOLS.map((t) => t.name).join(', ')})`);
}

main().catch((err) => {
  console.error('[bugpilot-mcp] fatal:', redactToken(err?.message ?? err));
  process.exit(1);
});
