# Shared Bug Report Schema (Phase 0)

**Status:** Draft for review. Aligns with existing Nest `CreateIssueDto` + platform `Issue` / `IssueMetadata`.  
**Goal:** One extendable JSON shape for web extension **and** RN reporter (`@bugpilot/react-native` overlay) → same `POST /api/issues`.  
**Decisions (2026-11-03):** Capture = in-app overlay (**Locked**). Auth + screenshot/AI privacy = bugPilot-owned (**Locked**). **#7 Locked:** free-floating icon → selector → on-device form matching extension — **not** upload-only edit.

## Verified API create fields ([Certain] — `backend/src/issues/dto/create-issue.dto.ts`)

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `project_id` | yes | string | Workspace project |
| `description` | yes | string | Extension currently concatenates title + description |
| `title` | no | string | |
| `status` | no | triage enum | Incoming → … → Closed |
| `severity` | no | string | Extension default `Medium` |
| `url` | no | string | Web page URL; RN may use deep link or leave null |
| `route` | no | string | Web path; RN: React Navigation route name |
| `browser_info` | no | object | Web UA/env; RN: reuse as **environment_info** semantics |
| `element_info` | no | object | DOM/element; RN: component / testID if available |
| `screenshot` | no | string | Base64 (no data-URL prefix) |
| `element_screenshot` | no | string | Base64 secondary |
| `metadata` | no | object | Extensible bag (see below) |
| `replay_data` | no | string | rrweb; usually N/A for RN |
| `videoStoragePath` | no | string | After separate upload |

## Verified list/get model ([Certain] — `platform/lib/types.ts` `Issue`)

Persisted/read fields include: `id`, `project_id`, `reporter_id`, `title`, `description`, triage/`status`, `severity`, `url`, `route`, `browser_info`, `element_info`, `screenshot_url`, `element_screenshot_url`, `metadata`, `sync_status`, external ticket fields, `created_at`, replay/video signed URLs, etc.

## `metadata` — verified keys in use (web)

From `IssueMetadata` / extension submit ([Certain] for listed keys):

- `screenshots[]` — `{ label, url }`
- `pageContext`, `performanceMetrics`, `appState`
- `consoleErrors`, `networkErrors`, `networkTransactions`
- `navigationHistory`
- `expectedResult`, `actualResult`, `priority`, `environment`, `labels`, `sprint`, `assignee`
- `domContext`, `recordedSteps`
- pin/retention helpers

## Proposed mobile extensions (unverified — not in DTO; place under `metadata`)

Do **not** treat as implemented. Prefer nesting to avoid premature migrations:

```json
{
  "metadata": {
    "captureSource": "rn-reporter",
    "platform": "ios",
    "mobile": {
      "osVersion": "18.0",
      "deviceModel": "iPhone 16",
      "appVersion": "1.0.0",
      "buildNumber": "…",
      "bundleId": "com.example.app",
      "expoSdk": "57",
      "isDevClient": true,
      "navigation": {
        "routeName": "RedeemHome",
        "params": {}
      },
      "testIdsNearby": [],
      "metroConnected": true
    },
    "annotations": {
      "toolVersions": "…",
      "shapes": []
    }
  }
}
```

| Proposal | Status |
| --- | --- |
| `metadata.captureSource` = `extension` \| `rn-reporter` \| `mcp-import` | Proposed |
| `metadata.platform` / `metadata.mobile.*` | Proposed |
| Top-level DB columns for device | Undecided — only if querying/filtering requires it |
| Annotation vector shapes in metadata vs flattened PNG only | **#7 Locked:** on-device form + element select is v1; optional richer shapes/editing in platform after upload is additive |
| `element_info` RN shape: `testID`, coords, routeName, componentName (opt-in) — not CSS/XPath | Proposed |

## Export shape for Cursor / MCP

MCP `get_issue` should return:

1. Core issue fields (id, title, description, severity, status, route, created_at).
2. Signed screenshot URLs (as REST already exposes).
3. `metadata` intact (including proposed `mobile` bag).
4. Optional: truncated console/network for prompt size.

Exact MCP tool names (implemented): `list_projects`, `get_project`, `list_issues`, `get_issue` — see `MCP_SERVER.md`.

### Local `bugs.json` export (optional)

```bash
export BUGPILOT_API_URL=http://localhost:4000
export BUGPILOT_ACCESS_TOKEN=<supabase-jwt>
curl -sS -H "Authorization: Bearer $BUGPILOT_ACCESS_TOKEN" \
  "$BUGPILOT_API_URL/api/issues/project/<PROJECT_ID>" > bugs.json
```

Do not commit `bugs.json` if it contains private URLs or PII.

## Alignment rules

1. RN reporter **must** hit the same create endpoint family as the extension unless a versioned `/api/v2` is explicitly designed later.
2. Do not invent required columns that break the Chrome extension.
3. Sanitize secrets (extension already strips Authorization headers in network capture) — RN must follow the same policy.
