# BugPilot v2.1 — Complete Feature & Technical Specification

> **The Open-Source-Powered Bug Reporting, Session Replay & AI Diagnostic Platform**  
> BugPilot unifies a Chrome Extension (Manifest V3 Side Panel), a Next.js 14 Web Dashboard, a NestJS 10 Backend API, and Supabase Cloud Infrastructure to eliminate context switching, accelerate QA bug triage, and automate reproduction with AI.

---

## 📑 Table of Contents
1. [Executive Summary & High-Level Architecture](#1-executive-summary--high-level-architecture)
2. [Chrome Extension & In-Browser Capture Engine](#2-chrome-extension--in-browser-capture-engine)
3. [Privacy Engine: Live DOM Smart Blur & PII Redaction](#3-privacy-engine-live-dom-smart-blur--pii-redaction)
4. [Session Replay & Telemetry Synchronization](#4-session-replay--telemetry-synchronization)
5. [AI-Native Diagnostic Engine (Part B)](#5-ai-native-diagnostic-engine-part-b)
6. [Triage Kanban Board, Gallery & Detail Inspector](#6-triage-kanban-board-gallery--detail-inspector)
7. [Enterprise Integrations & Outbound Webhooks](#7-enterprise-integrations--outbound-webhooks)
8. [Embeddable Guest Reporting Widget (No Extension Required)](#8-embeddable-guest-reporting-widget-no-extension-required)
9. [Enterprise Self-Hosting, Retention & Docker Bundle](#9-enterprise-self-hosting-retention--docker-bundle)
10. [Test Matrix & Quality Verification](#10-test-matrix--quality-verification)

---

## 1. Executive Summary & High-Level Architecture

BugPilot combines the best architectural patterns from 10 leading open-source platforms (**Mimik**, **SnapDOM**, **Sentry**, **PostHog**, **Highlight.io**, **OpenReplay**, **Plane**, **Focalboard**, **rrweb**, and **Bug Magnet**) into a unified QA operating system.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Chrome Extension (MV3 Side Panel)                         │
│  ┌────────────────────────┐ ┌───────────────────────────┐ ┌─────────────────────────┐  │
│  │ Live DOM Smart Blur    │ │ 50-Token DOM AI Context   │ │ Step Callout Studio [1] │  │
│  │ (TreeWalker PII Blur)  │ │ (Mimik Fast Prompting)    │ │ (True Gaussian Blur)    │  │
│  └───────────┬────────────┘ └─────────────┬─────────────┘ └────────────┬────────────┘  │
│              │                            │                            │               │
│  ┌───────────┴────────────────────────────┴────────────────────────────┴────────────┐  │
│  │ Background Service Worker: Decoupled rrweb (182KB), Bug Magnet Menus, Tab Syncer │  │
│  └────────────────────────────────────────┬─────────────────────────────────────────┘  │
└───────────────────────────────────────────┼────────────────────────────────────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
┌─────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│       Next.js 14 Web Platform (3000)    │   │        NestJS 10 Backend API (4000)      │
│ - Triage Kanban (Severity Swimlanes)    │   │ - AI Diagnostics (RCA, Playwright Gen)   │
│ - Scrubber Seek with 2s Pre-Roll        │   │ - Sentry-Style Compound Fingerprinting   │
│ - Master Clock Playback Synchronization │   │ - In-Browser Source Map Deobfuscation    │
│ - Visual Bug Gallery & Lightbox         │   │ - Jira Cloud (ADF), Linear, Azure DevOps │
│ - 2-Column Sticky Detail View           │   │ - Slack & MS Teams Outbound Webhooks     │
│ - Vendor Stack Trace Frame Folding      │   │ - 30-Day Auto-Delete Retention Engine    │
│ - Onboarding Wizard & People RBAC       │   │ - AES-256-GCM Credential Encryption      │
└────────────────────┬────────────────────┘   └────────────────────┬─────────────────────┘
                     │                                             │
                     └──────────────────────┬──────────────────────┘
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                     Database & Storage Layer (Supabase / Self-Hosted)                   │
│  - PostgreSQL 16: RLS Policies, Triage Status Enums, Threaded Comments, Activities Log  │
│  - Storage Buckets: `screenshots`, `videos`, `qa-replays`, `thumbnails`                │
│  - Turnkey Enterprise Docker Stack: MinIO S3 + Postgres 16 + Redis 7 + NestJS + Next   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Chrome Extension & In-Browser Capture Engine

### 2.1 Side Panel Manager (Manifest V3)
- **Zero-Interruption Navigation**: Uses `chrome.sidePanel` to preserve active recordings, buffered bug batches, and diagnostics across tab switches and domain redirects.
- **Global Shortcut**: `⌥⇧Q` (Option/Alt + Shift + Q) triggers immediate element inspection.
- **Dynamic Project & Member Scoping**: Pulls workspace projects and active assignees dynamically from Supabase.
- **Live Status Badges**: Visual state pills indicating idle readiness vs active multi-tab recording.

### 2.2 Shortest Unique Resilient CSS Selectors (`finder`)
- Integrates Anton Medvedev’s **1.1 KB `finder`** engine into `extension/finder.js`.
- Generates penalty-scored, human-readable CSS selectors (e.g. `button#checkout-btn` or `[data-testid="submit-order"]`) rather than brittle 100-character DOM paths.
- Automatically rejects dynamic numeric IDs (e.g. `:r1a:`, `_10924`).

### 2.3 Aspect-Ratio Responsive Crop
- Replaces rigid crop margins with Mimik's responsive formula:
  $$\text{PAD\_RATIO} = 0.3 \quad (30\% \text{ viewport padding relative to element width/height})$$
- Renders rounded dashed focus callout borders (`[8, 5]` stroke pattern) with Retina DPR 2x/3x scaling.

### 2.4 Annotation Studio & Numbered Step Badges
- **True Gaussian Canvas Blur**: In-browser vector blur (`ctx.filter = 'blur(12px)'`) with 1:1 physical pixel Retina coordinate alignment.
- **Numbered Step Callouts (`[1]`, `[2]`, `[3]`)**: Auto-incrementing numbered badge tool with high-contrast drop shadow for step-by-step visual bug reproduction.
- **Vector Tools**: Rectangle, Arrow, Circle, Freehand Pen, Text, Blur, and Numbered Step Callouts with 8-point resize handles and undo/redo history stack.

### 2.5 Active QA Exploratory Testing Datasets (Bug Magnet)
- Injected into `chrome.contextMenus` with 8 curated exploratory test categories:
  1. **RFC Email Boundary Tests**: `very.common@example.com`, `user+tag@sub.domain.org`, special unicode chars.
  2. **XSS & Script Injection Probes**: `<script>alert(1)</script>`, `"><svg/onload=confirm(1)>`.
  3. **SQL Injection**: `' OR '1'='1`, `admin' --`.
  4. **Names & International Characters**: `D'Angelo`, `José-María`, Japanese/Arabic RTL strings.
  5. **Large Text & Buffer Overflows**: 255 chars, 1,000 chars, 5,000 chars.
  6. **Numeric Edge Cases**: `0`, `-1`, `2147483647` (Max Int32), `9007199254740991` (Max Safe Int).
  7. **Dates & Formatting**: Leap years (`2024-02-29`), Year 2038 boundary, Unix epoch.
  8. **Format & Zero-Width Strings**: Zero-width spaces (`\u200B`), emoji strings (`👩🏽‍💻🚀`), trailing whitespace.

---

## 3. Privacy Engine: Live DOM Smart Blur & PII Redaction

### 3.1 Pre-Capture Live DOM Smart Blur (Mimik Architecture)
- Rather than attempting to blur pixels after capture, BugPilot's `TreeWalker` scanner inspects the live DOM **before** `chrome.tabs.captureVisibleTab` executes.
- Sensitive text nodes and input values are wrapped in high-performance CSS `blur(10px)` containers, natively rasterizing redacted pixels into the captured image bitmap.
- Automatically unblurs after capture completes (with an adversarial 2.5s fallback safety timer).

### 3.2 Automated Redaction Regex Presets
- **Email Addresses**: `/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi`
- **Social Security Numbers (SSN)**: `/\b\d{3}-?\d{2}-?\d{4}\b/g`
- **Credit Card Numbers (Luhn boundary)**: `/\b(?:\d[ -]*?){13,19}\b/g`
- **Phone Numbers**: International `+` formats, `(xxx) xxx-xxxx`, and 10–11 digit strings.
- **IP Addresses**: IPv4 octet bounds (`0–255.0–255.0–255.0–255`).
- **MAC Addresses**: Standard colon and hyphen hex notation (`00:1B:44:11:3A:B7`).

### 3.3 Client-Side Stream Sanitization
- Auto-scrubs sensitive headers (`Authorization: Bearer [REDACTED_AUTH]`, `Cookie: [REDACTED_COOKIE]`).
- Auto-sanitizes URL query parameters (`token=`, `secret=`, `api_key=`, `jwt=`, `session=`).

---

## 4. Session Replay & Telemetry Synchronization

### 4.1 Decoupled Lightweight rrweb Engine
- Decoupled `@rrweb/record` bundle into a dedicated **182 KB bundle** (`extension/rrweb-record.min.js`), reducing extension footprint by **66%** from monolithic 535KB builds.
- Configured with `slimDOMOptions` (stripping comments, whitespaces, unused meta tags) and `@rrweb/packer` for 60%+ JSON payload reduction.
- Canvas snapshot recording enabled (`recordCanvas: true, sampling: { canvas: 2 }`).

### 4.2 Interactive Scrubber Timeline Markers & 2-Second Pre-Roll
- Overlay colored diagnostic markers along the `ReplayPlayer.tsx` scrubber bar:
  - 🔴 **Red Pin**: Unhandled JavaScript runtime exception or `console.error`
  - 🟡 **Amber Pin**: 4xx / 5xx HTTP network request failure
  - 🔵 **Blue Pin**: User click, navigation, or form input event
- **2-Second Pre-Roll Playback**: Clicking any error marker instantly seeks to:
  $$\text{SeekTime} = \max(0, \text{ErrorTimestamp} - 2000\text{ms})$$
  allowing developers to witness the exact user actions immediately preceding the crash.

### 4.3 Master Clock Playback Synchronization
- Synchronizes replay time offset in real time with the **Console Log Viewer** and **Network Log Viewer**.
- Highlights active console errors and in-flight HTTP requests dynamically as the video scrubber advances.

### 4.4 Vendor Stack Frame Folding & Sourcemap Deobfuscation
- **Smart Frame Folding**: Collapses consecutive vendor internals (`node_modules/`, `webpack/`, `react-dom/`) into collapsible `▶ 14 hidden vendor frames` drawers in `<StackTraceView>`.
- **VS Code Deep Links**: Generates 1-click `vscode://file/{absolutePath}:{line}` links for instant jump to code.
- **Backend `SourceMapService`**: Fetches `.map` files to map minified bundle coordinates (`main.min.js:1:4209`) to original TypeScript source files (`src/Cart.tsx:42`).

### 4.5 Unified Breadcrumb Flight Recorder & Network Waterfall
- **Breadcrumb Recorder**: Chronological timeline of clicks, route changes, console logs, and fetch calls with relative offsets (`-4.2s`, `-1.8s`, `0.0s`).
- **Network Gantt Waterfall**: Displays method, URL, status code, payload sizes, duration in ms, and a 1-click **Copy as cURL** button.
- **Performance & State Telemetry**: Captures Long Tasks (>50ms UI freeze), JS Memory Heap metrics, React Router state, and Redux/Zustand store keys.

---

## 5. AI-Native Diagnostic Engine (Part B)

### 5.1 NestJS `AiService` Module
- Centralized backend AI orchestrator in `backend/src/ai/ai.service.ts` exposing structured diagnostic endpoints:
  - `POST /ai/rca`: Root Cause Analysis and Git diff patch generator.
  - `POST /ai/generate-test`: Automated Playwright E2E test script generator.
  - `POST /ai/detect-duplicates`: Sentry-style compound fingerprint duplicate detector.

### 5.2 50-Token DOM Context & "What's Wrong?" Smart Form (Phase B1 & B2)
- Instead of expensive multi-megabyte vision model queries, BugPilot extracts ~50 tokens of structured semantic DOM context:
  ```text
  Page: "Checkout" /cart/checkout
  Container: form [role=form] "Billing Details"
  Heading: "Payment Method"
  Siblings: select#payment-type, button "Back"
  → Target: button#submit-order "Place Order" (click)
  ```
- **"What's Wrong?" Single-Input Smart Form**: Testers type a 1-sentence description; the AI auto-populates Title, Description, Expected vs. Actual results, and Step-by-Step Repro sequence in under 1 second.

### 5.3 Diagnostic RCA Panel & 1-Click Cursor / VS Code Copilot Prompt
- Generates probable root cause summary, affected component name, and a git-style diff patch.
- **"⚡ Copy for Cursor / VS Code"**: Generates a rich, Markdown-formatted prompt including component hierarchy, source lines, console stack traces, network failures, and reproduction instructions tailored for AI IDEs.

### 5.4 Automated Playwright Test Spec Generator (`.spec.ts`)
- Converts user interaction breadcrumbs, input values, and DOM context into runnable `@playwright/test` scripts:
  ```typescript
  import { test, expect } from '@playwright/test';

  test.describe('Reproduction: Cart checkout failure', () => {
    test('should trigger error state on <CheckoutButton>', async ({ page }) => {
      await page.goto('https://shop.example.com/checkout');
      await page.waitForLoadState('networkidle');
      await page.locator('input#email').fill('user@test.com');
      await page.locator('button#submit-order').first().click();
      await expect(page.locator('body')).toContainText('500 Internal Server Error');
    });
  });
  ```

### 5.5 Sentry-Style Compound Error Fingerprinting & Duplicate Detection
- Computes multi-signal compound hashes:
  $$\text{Fingerprint} = \text{SHA-256}(\text{NormalizedURL} \parallel \text{CSSSelector} \parallel \text{ScrubbedErrorStack} \parallel \text{NetworkPath})$$
- Flags duplicates before submission with similarity scoring ($0.0 \to 1.0$) and match explanations ("Matches identical error stack trace & DOM element").

### 5.6 "Record Bug Steps" Workflow Mode (`InputSession`)
- Mimik-inspired step recorder that captures user interaction journeys.
- **Keystroke Consolidation**: Consolidates 50 typing keystrokes into 1 clean step (`input#search -> typed "Laptop"`).
- Automatically stitches numbered step badges and element crops into an exportable step-by-step QA guide.

### 5.7 AI Screenshot Visual Anomaly Analysis
- Evaluates screenshots for layout clipping, overflowing text, broken flexboxes, CSS alignment glitches, and mobile viewport overlaps.

---

## 6. Triage Kanban Board, Gallery & Detail Inspector

### 6.1 Severity-Driven Kanban Board (`platform/components/KanbanBoard.tsx`)
- **Drag-and-Drop**: Built using `@dnd-kit/core` and `@dnd-kit/sortable`.
- **Severity Horizontal Swimlanes**: `Critical`, `High`, `Medium`, and `Low` swimlanes keep blocking issues permanently prioritized at the top.
- **Triage Lifecycle Columns**: `Incoming` $\to$ `In Triage` $\to$ `Confirmed` $\to$ `In Dev` $\to$ `Resolved` $\to$ `Closed`.
- **Optimistic UI Updates**: TanStack Query `onMutate` cache updates with automatic rollback on network failure.
- **Rich QA Diagnostic Cards**:
  - Thumbnail preview with aspect-ratio badge
  - React component chip: `<CheckoutButton>`
  - Telemetry badges: `🎬 Replay` · `📹 Video` · `⚠️ 2 Errors` · `🌐 Net 500`
  - 1-click IDE deep link (`vscode://`, `cursor://`)

### 6.2 Visual Bug Gallery View (`platform/components/VisualGalleryView.tsx`)
- Image-first screenshot gallery with side-by-side comparison, element zoom, and metadata overlays.

### 6.3 2-Column Sticky Issue Detail Inspector
- **Left Column (60%)**: Sticky Media Hub with tabbed Replayer, Screen Video, and Full-Resolution Screenshot Lightbox.
- **Right Column (40%)**: 5-Tab DevTools Inspector:
  1. `DOM & Stack Trace`: CSS Selectors, XPath, DOM Breadcrumb, React Fiber tree, Source Lines, Vendor Frame Folding.
  2. `Console Logs`: Master Clock synchronized logs with severity filters (`Error`, `Warn`, `Info`).
  3. `Network Requests`: Waterfall Gantt chart, status codes, request/response headers, JSON bodies, cURL export.
  4. `Flight Recorder`: Breadcrumb interaction timeline with relative time offsets.
  5. `Environment & State`: Browser, OS, DPR, Viewport, Performance marks, Redux/Zustand state keys.

### 6.4 Internal Comments & Audit Log Activity Stream
- Threaded internal discussion comments.
- Real-time audit log tracking status transitions, assignees, and integration sync history.

### 6.5 Diagnostic Filter Bar & Bulk Actions
- Multi-criteria search (Status, Severity, Assignee, Replay availability, Console error presence, React component name) synced with URL query parameters.
- Bulk actions: batch status change, batch severity update, batch assign, batch delete.

---

## 7. Enterprise Integrations & Outbound Webhooks

### 7.1 Atlassian Jira Cloud Connector
- Two-way synchronization via Jira REST API v3 (`POST /rest/api/3/issue`).
- Formats structured issue fields into Atlassian Document Format (ADF) with repro steps, environment specs, and screenshot attachments.
- DTO: [`CreateJiraIntegrationDto`](file:///Users/rahulsarawagi/Work/bugPilot/backend/src/integrations/dto/create-jira-integration.dto.ts).

### 7.2 Linear Team Connector
- Two-way sync via Linear GraphQL API (`issueCreate` mutation).
- Maps severity to Linear priority (1 = Urgent/Critical, 2 = High, 3 = Medium, 4 = Low).
- DTO: [`CreateLinearIntegrationDto`](file:///Users/rahulsarawagi/Work/bugPilot/backend/src/integrations/dto/create-linear-integration.dto.ts).

### 7.3 Azure DevOps Connector
- Two-way sync with Azure DevOps Work Items API (`$Bug?api-version=7.1`).
- Custom field mapping (`System.Title`, `Microsoft.VSTS.TCM.ReproSteps`, `System.Description`, `System.AssignedTo`).
- Automated screenshot attachment uploads.

### 7.4 Slack & Microsoft Teams Outbound Webhooks
- **Slack Block Kit**: Sends rich alert cards with severity emoji indicators (🔴 / 🟠 / 🟡), route paths, and direct dashboard deep links.
- **Microsoft Teams MessageCards / Adaptive Cards**: Actionable cards with status pills and direct view actions.
- Configurable triggers: Notify on specific severities (`Critical`, `High`) and triage status updates.

### 7.5 Connectors Hub Settings UI
- Multi-tab management page in [`platform/app/(dashboard)/settings/integrations/page.tsx`](file:///Users/rahulsarawagi/Work/bugPilot/platform/app/(dashboard)/settings/integrations/page.tsx) with live connection test buttons and AES-256-GCM encrypted PAT storage.

---

## 8. Embeddable Guest Reporting Widget (No Extension Required)

- **File**: [`platform/public/widget.js`](file:///Users/rahulsarawagi/Work/bugPilot/platform/public/widget.js)
- **Zero-Dependency Script**: Can be embedded into any web page via a single `<script>` tag:
  ```html
  <script 
    src="https://app.bugpilot.dev/widget.js" 
    data-project-id="YOUR_PROJECT_ID" 
    data-api-url="https://api.bugpilot.dev">
  </script>
  ```
- **Shadow DOM Encapsulation**: 100% isolated CSS styling that will never conflict with host page styles.
- **Automatic Telemetry**: Intercepts in-memory `console.error` logs and unhandled promise rejections.
- **Modal Submission**: Floats a sleek "Report Bug" trigger button opening an issue submission modal directly on the client app.

---

## 9. Enterprise Self-Hosting, Retention & Docker Bundle

### 9.1 Turnkey Enterprise Docker Compose (`docker-compose.enterprise.yml`)
- Provides a self-contained, air-gapped deployment bundle:
  - **PostgreSQL 16** with persistent volumes and health checks
  - **MinIO S3-Compatible Storage** with web console on `:9001`
  - **Redis 7** for caching, session locks, and background jobs
  - **NestJS Backend API** on `:4000`
  - **Next.js 14 Web Platform** on `:3000`

### 9.2 30-Day Auto-Delete Media Retention Policy
- `POST /issues/retention/cleanup`: Scheduled endpoint that purges orphaned screenshots, video chunks, and session replay streams for resolved/closed issues older than the retention threshold (default: 30 days).
- Clears storage bucket blobs while preserving audit history and issue metadata.

### 9.3 Role-Based Access Control (RBAC Team Management)
- User roles in [`platform/app/(dashboard)/team/page.tsx`](file:///Users/rahulsarawagi/Work/bugPilot/platform/app/(dashboard)/team/page.tsx):
  - **Admin**: Full control over projects, billing, integrations, and member invitations.
  - **Member**: Create, triage, edit, and assign bug reports.
  - **Viewer**: Read-only access to session replays, screenshots, and diagnostic logs.

---

## 10. Test Matrix & Quality Verification

| Component / Test Suite | Framework | Tests Passed | Status |
|---|---|:---:|:---:|
| **NestJS Backend API** | Jest | **74 / 74** (12 suites) | 🟢 100% Pass |
| **Chrome Extension (MV3)** | Node.js Test Runner | **58 / 58** tests | 🟢 100% Pass |
| **Next.js Web Platform Build** | `next build` (Next 14) | **13 / 13** routes | 🟢 Zero Errors |
| **Supabase Database Schema** | PostgreSQL / MCP | **100%** In Sync | 🟢 Active & Healthy |

---

*BugPilot v2.1 Technical Specification — Generated September 2026.*
