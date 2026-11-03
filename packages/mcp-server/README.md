# @bugpilot/mcp-server

Read-only MCP server for Cursor: list/get **projects** and **issues** via Nest `GET /api/*`.

## Auth choice (pragmatic default)

| Choice | Detail |
| --- | --- |
| **Bearer = Supabase user JWT** | Set `BUGPILOT_ACCESS_TOKEN` to the same `access_token` the web platform / extension use. Nest `SupabaseAuthGuard` validates via `supabase.auth.getUser(token)`. |
| PAT | **Not implemented.** Would need backend support beyond current JWT guard. |

Never commit real tokens. Put them only in Cursor MCP `env` (local) or your shell.

## Env

| Var | Required | Default |
| --- | --- | --- |
| `BUGPILOT_ACCESS_TOKEN` | yes | — |
| `BUGPILOT_API_URL` | no | `http://localhost:4000` |
| `BUGPILOT_PROJECT_ID` | no | used when `list_issues` omits `projectId` |

## Tools (implemented)

| Tool | Maps to |
| --- | --- |
| `list_projects` | `GET /api/projects` |
| `get_project` | `GET /api/projects/:id` |
| `list_issues` | `GET /api/issues/project/:projectId` |
| `get_issue` | `GET /api/issues/:id` |

**No** create/update/delete tools.

## Install deps

```bash
cd packages/mcp-server && npm install
```

## Cursor config

Backup `~/.cursor/mcp.json` first, then merge (see `docs/mobile-qa/MCP_SERVER.md` and Tallect `QA/MCP_SETUP.md`):

```json
{
  "mcpServers": {
    "bugpilot": {
      "command": "node",
      "args": ["/Users/rahulsarawagi/Work/bugPilot/packages/mcp-server/src/index.js"],
      "env": {
        "BUGPILOT_API_URL": "http://localhost:4000",
        "BUGPILOT_ACCESS_TOKEN": "<supabase-access-token>",
        "BUGPILOT_PROJECT_ID": "<optional-project-uuid>"
      }
    }
  }
}
```

Restart Cursor MCP (toggle server or restart app) after editing.

## Smoke (optional)

```bash
export BUGPILOT_ACCESS_TOKEN=…
export BUGPILOT_PROJECT_ID=…   # optional
npm run smoke
```

Requires Nest listening on `BUGPILOT_API_URL`.
