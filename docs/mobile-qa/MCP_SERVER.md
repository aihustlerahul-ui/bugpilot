# bugPilot MCP Server — Track C (implemented, read-only)

**Status:** Shipped as `@bugpilot/mcp-server` under `packages/mcp-server/`.  
**Cursor:** `~/.cursor/mcp.json` has `bugpilot` + `maestro` (backup `mcp.json.bak.20261103-215914`). `BUGPILOT_ACCESS_TOKEN` still **empty** — enable by pasting a Supabase JWT, then restart MCP.  
**Scope:** list/get only. **No** create/update/delete tools.  
**Live smoke:** Not verified in 2026-11-03 night recovery (needs token + Nest).

## Auth choice (pragmatic default) — Locked for v1

| Decision | Detail |
| --- | --- |
| Token type | **Supabase user JWT** (`access_token`) |
| How Nest validates | Existing `SupabaseAuthGuard` → `supabase.auth.getUser(token)` |
| Env var | `BUGPILOT_ACCESS_TOKEN` |
| PAT | **Not implemented** — would need new backend auth. Revisit later if CI needs non-user tokens. |

Same bearer pattern as the RN reporter’s `EXPO_PUBLIC_BUGPILOT_ACCESS_TOKEN`. Never commit tokens.

## Package

| Item | Path |
| --- | --- |
| Package | `packages/mcp-server/` |
| Entry | `packages/mcp-server/src/index.js` (stdio MCP) |
| Install | `cd packages/mcp-server && npm install` |
| Smoke | `BUGPILOT_ACCESS_TOKEN=… npm run smoke` (needs Nest up) |

## Env

| Var | Required | Default |
| --- | --- | --- |
| `BUGPILOT_ACCESS_TOKEN` | yes | — |
| `BUGPILOT_API_URL` | no | `http://localhost:4000` |
| `BUGPILOT_PROJECT_ID` | no | default for `list_issues` |

## Tools (implemented — use these names)

| Tool | Maps to | Notes |
| --- | --- | --- |
| `list_projects` | `GET /api/projects` | |
| `get_project` | `GET /api/projects/:id` | args: `projectId` |
| `list_issues` | `GET /api/issues/project/:projectId` | args: `projectId` optional if env set |
| `get_issue` | `GET /api/issues/:id` | args: `issueId`; includes signed media when API returns them |

### Explicitly not implemented

Write tools (`create_issue`, `update_issue_status`, delete, uploads).  
Maestro device tools — those belong to Maestro MCP only.

## Cursor connect

1. Backup `~/.cursor/mcp.json` (or project `.cursor/mcp.json`).
2. Merge:

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

3. Toggle/restart the MCP server in Cursor Settings → Tools & MCPs.
4. Side-by-side with Maestro: see Tallect `QA/MCP_SETUP.md`.

## Separation of concerns

| MCP | Purpose |
| --- | --- |
| **bugpilot** | Bugs / projects from Nest |
| **maestro** | Devices, screenshots, YAML flows (`maestro mcp`) |

## Shared report schema

JSON shape for filed bugs: [REPORT_SCHEMA.md](./REPORT_SCHEMA.md).  
MCP `get_issue` returns the Nest/platform issue JSON (not a separate export file). Optional local dump:

```bash
# After Nest is up and token set:
node -e "/* or use MCP get_issue */"
# Or curl:
# curl -H "Authorization: Bearer $BUGPILOT_ACCESS_TOKEN" \
#   "$BUGPILOT_API_URL/api/issues/<id>" > bugs.json
```

## Verification checklist

- [x] Server package exists
- [x] Tool names match implementation (this doc)
- [ ] Cursor called tools against seeded project (needs user token + Nest)
- [x] Documented with Maestro in Tallect `QA/MCP_SETUP.md`
- [x] Auth contract closed for v1 (JWT Bearer)
