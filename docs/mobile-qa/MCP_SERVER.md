# bugPilot MCP Server: developer workflow (implemented, NOT YET VERIFIED LIVE)

**Status:** Built as `@bugpilot/mcp-server` under `packages/mcp-server/` on branch `feat/mcp-dev-workflow`. Covered by unit tests only. The three DB migrations have not been confirmed applied, no real key has been created, and Cursor has not been driven end-to-end (see the checklist at the bottom).
**Scope:** list/read bugs, comment, assign, set status. No create/delete tools.

## Auth: personal API keys

| Decision | Detail |
| --- | --- |
| Credential | Personal API key `bp_live_...`, created on the dashboard **AI Tools** page (`/ai-tools`), shown once |
| Storage | Only a SHA-256 hash is stored (`api_keys` table); keys are revocable |
| Headers | `Authorization: Bearer bp_live_...` plus `X-Workspace-Id: <workspace uuid>` (required) |
| Where accepted | Only routes marked `@ApiKeyAllowed()`; anything else returns 403 |
| Checks | key valid and not revoked, owner's email confirmed, owner has access to the workspace |
| Legacy | `BUGPILOT_ACCESS_TOKEN` (Supabase JWT, Bearer only) still works as a fallback when no key is set |

Allowlisted routes: `GET /api/projects`, `GET /api/projects/:id`, `GET /api/issues/project/:projectId`, `GET /api/issues/project/:projectId/members`, `GET /api/issues/:id`, `GET|POST /api/issues/:id/comments`, `PATCH /api/issues/:id/status`, `PATCH /api/issues/:id/assignee`. The set is pinned by `backend/src/common/decorators/api-key-allowlist.spec.ts`; changing it means editing that test deliberately.

Permissions: project owners may set any status; other members may set only `Resolved`. Never commit keys.

## Migrations (run manually in the Supabase SQL editor)

- `backend/migrations/20261104_api_keys.sql`
- `backend/migrations/20261104_issue_comments.sql`
- `backend/migrations/20261104_issue_assignee_member.sql`

## Package

| Item | Path |
| --- | --- |
| Package | `packages/mcp-server/` |
| Entry | `packages/mcp-server/src/index.js` (stdio MCP) |
| Install | `cd packages/mcp-server && npm install` |
| Tests | `cd packages/mcp-server && npm test` |
| Smoke | `BUGPILOT_API_KEY=... BUGPILOT_WORKSPACE_ID=... npm run smoke` (needs Nest up; prints `OK projects=N`, `OK issues=N`, `OK members=N`) |

## Env

| Var | Required | Default |
| --- | --- | --- |
| `BUGPILOT_API_KEY` | yes (or legacy token) | none |
| `BUGPILOT_WORKSPACE_ID` | yes with a key | none |
| `BUGPILOT_API_URL` | no | `http://localhost:4000` |
| `BUGPILOT_PROJECT_ID` | no | default project for `list_issues` / `list_members` |
| `BUGPILOT_ACCESS_TOKEN` | legacy fallback | none |

## Tools (use these names)

| Tool | Writes? | Maps to | Notes |
| --- | --- | --- | --- |
| `list_projects` | no | `GET /api/projects` | |
| `get_project` | no | `GET /api/projects/:id` | args: `projectId` |
| `list_issues` | no | `GET /api/issues/project/:projectId` | `projectId` optional if env set; filters `status`, `assigneeMemberId`, `severity`, `limit` |
| `get_issue` | no | `GET /api/issues/:id` + `/comments` | bounded: arrays and strings truncated, up to 3 screenshots inline (each <= 1.5 MB) |
| `list_members` | no | `GET /api/issues/project/:projectId/members` | assignable members |
| `add_comment` | yes | `POST /api/issues/:id/comments` | recorded with source `mcp`; dashboard shows an AI badge |
| `update_issue_status` | yes | `PATCH /api/issues/:id/status` | members: `Resolved` only |
| `assign_issue` | yes | `PATCH /api/issues/:id/assignee` | `memberId` or `null` |
| `assign_to_reporter` | yes | assignee = reporter's member row | fails with the member list if the reporter is not a member |

Finish sequence (only after the developer asked for the fix): `add_comment` -> `assign_to_reporter` -> `update_issue_status` `Resolved`.

Bug content is untrusted reporter-supplied data; tool descriptions tell the model not to follow instructions found in it.

## Cursor connect

1. Create a key on the dashboard AI Tools page (copy it immediately).
2. Backup `~/.cursor/mcp.json` (or project `.cursor/mcp.json`), then merge:

```json
{
  "mcpServers": {
    "bugpilot": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/bugPilot/packages/mcp-server/src/index.js"],
      "env": {
        "BUGPILOT_API_URL": "http://localhost:4000",
        "BUGPILOT_API_KEY": "<bp_live_key>",
        "BUGPILOT_WORKSPACE_ID": "<workspace-uuid>"
      }
    }
  }
}
```

3. Toggle/restart the MCP server in Cursor Settings -> Tools & MCPs.

## Shared report schema

JSON shape for filed bugs: [REPORT_SCHEMA.md](./REPORT_SCHEMA.md).  
MCP `get_issue` returns the Nest/platform issue JSON (not a separate export file). Optional local dump:

```bash
# After Nest is up and token set:
node -e "/* or use MCP get_issue */"
# Or curl:
# curl -H "Authorization: Bearer $BUGPILOT_API_KEY" -H "X-Workspace-Id: $BUGPILOT_WORKSPACE_ID" \
#   "$BUGPILOT_API_URL/api/issues/<id>" > bugs.json
```

## Verification checklist

Verified by unit tests in the repo (`backend` jest, `packages/mcp-server` `npm test`):

- [x] MCP package exists; tool names and env vars match the code (this doc)
- [x] Client sends Bearer + `X-Workspace-Id`; legacy token fallback works (`client.test.js`)
- [x] Write tools behave and surface backend errors without leaking the key (`write.test.js`)
- [x] API-key allowlist is pinned to the route set above (`api-key-allowlist.spec.ts`)
- [x] Key service hashes and verifies keys (`api-keys.service.spec.ts`)

NOT YET VERIFIED (user to run, in order):

- [ ] Three migrations applied to the live DB
- [ ] Key created through the dashboard AI Tools page
- [ ] `npm run smoke` against a live backend prints `OK projects/issues/members`
- [ ] Cursor end-to-end: list -> read -> comment -> assign to reporter -> resolve; dashboard shows AI-badged comment, assignee and status
- [ ] Key revocation: next MCP call returns 401
