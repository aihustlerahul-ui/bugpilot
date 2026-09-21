# BugPilot Engineering Roadmap & Task Tracker

> **Status Reference**: `[ ]` Not Started • `[/]` In Progress • `[x]` Completed  
> This file tracks the end-to-end implementation of BugPilot v2.1 across Part A (Non-AI / Platform / Extension) and Part B (AI-Native Features).

---

## 🚀 Part A: Platform, Extension & Integrations (100% Completed)

### Phase A0: Extension Quick Wins & Performance (Days 1–3) — 100% DONE
- [x] **A0.1**: Fix canvas recording configuration bug in `extension/replay-recorder.js` (`recordCanvas: true, sampling: { canvas: 2 }`).
- [x] **A0.2**: Vendor Anton Medvedev's `finder` (1.1KB) into `extension/content.js` for shortest unique resilient CSS selectors.
- [x] **A0.3**: Integrate Bug Magnet exploratory QA test datasets into `extension/background.js` (`chrome.contextMenus`).
- [x] **A0.4**: Upgrade annotation blur in `extension/annotate.js` to true Gaussian blur (`ctx.filter = 'blur(12px)'`).
- [x] **A0.5**: Decouple `@rrweb/record` from extension to reduce payload footprint from 535KB to ~220KB.

### Phase A1: Foundation, Privacy & Core UX (Weeks 1–3) — 100% DONE
- [x] **A1**: Port Mimik's live DOM TreeWalker Smart Blur into `extension/content.js` (redacts email, phone, ssn, card, ip, mac before capture).
- [x] **A2**: Upgrade context crop in `extension/content.js` to aspect-ratio aware geometry (`PAD_RATIO = 0.3`, dashed border `[8, 5]`).
- [x] **A3**: Build Dashboard Home page (`platform/app/(dashboard)/page.tsx` & `/dashboard`) with summary metrics, activity feed, and project links.
- [x] **A4**: Redesign Sidebar navigation (`platform/components/Sidebar.tsx`) with workspace switcher and updated hierarchy.
- [x] **A5**: Implement search and multi-criteria diagnostic filtering in issue lists with URL param persistence.
- [x] **A6**: Implement explicit issue triage status model (`Incoming` $\rightarrow$ `In Triage` $\rightarrow$ `Confirmed` $\rightarrow$ `In Dev` $\rightarrow$ `Resolved` $\rightarrow$ `Closed`) decoupled from sync status. *(Database schema & tables applied to Supabase via MCP)*
- [x] **A7**: Simplify extension settings into "Full Diagnostic" vs "Strict Privacy" presets.

### Phase A2: Replay Synchronization, 2-Column Detail & Kanban (Weeks 3–5) — 100% DONE
- [x] **A8**: Add interactive colored scrubber tick markers (🔴 errors, 🟡 network drops, 🔵 clicks) in `ReplayPlayer.tsx` with 2s pre-roll seek.
- [x] **A9**: Implement Master Clock synchronization linking replay timestamp to active Console and Network rows.
- [x] **A10**: Configure `slimDOMOptions` and `@rrweb/packer` for 60%+ rrweb payload reduction.
- [x] **A11**: Redesign issue detail view (`projects/[id]/issues/[issueId]/page.tsx`) into a sticky 2-column split layout.
- [x] **A12**: Build drag-and-drop Kanban board using `@dnd-kit/core` with horizontal severity swimlanes (`Critical`, `High`, `Medium`, `Low`).
- [x] **A13**: Implement TanStack Query optimistic UI mutations (`onMutate` rollback) for Kanban card movements.
- [x] **A14**: Design rich QA diagnostic cards (thumbnails, component chips, telemetry badges, IDE deep links).
- [x] **A15**: Build Visual Bug Gallery view comparing captured screenshots side-by-side.
- [x] **A16**: Implement internal comments & activity log database schema in Supabase (`issue_activities`, `issue_comments`).
- [x] **A17**: Implement bulk actions on issue list (batch assign, status change, severity change, delete).

### Phase A3: Deep Telemetry, Deobfuscation & Integrations (Weeks 6–8) — 100% DONE
- [x] **A18**: Source map deobfuscation service (`source-map.service.ts`) with stack frame deobfuscation.
- [x] **A19**: Smart vendor frame folding (`▶ 14 hidden frames`) in `<StackTraceView>` with VS Code deep links.
- [x] **A20**: Unified Breadcrumb flight recorder (clicks, route changes, fetch/xhr, console errors with relative timeline offsets).
- [x] **A21**: Network waterfall view with cURL export (inside `NetworkLogViewer.tsx`).
- [x] **A22**: Transparent Redux DevTools & React hook state (`fiberNode.memoizedState`) capture.
- [x] **A23**: Long Tasks (>50ms UI freeze) PerformanceObserver and memory heap telemetry.
- [x] **A24**: Jira 2-way sync connector (OAuth2 / API token, field mapping, rich repro steps).
- [x] **A25**: Linear connector with 2-way status mirroring.
- [x] **A26**: Slack and Microsoft Teams outbound webhook notifications.
- [x] **A27**: 30-day auto-delete media retention policy on resolved issues (`/issues/retention/cleanup`).

### Phase A4: Embed Widget, Growth & Polish (Weeks 9–10) — 100% DONE
- [x] **A28**: SnapDOM guest / magic-link embeddable reporting widget (`platform/public/widget.js`).
- [x] **A29**: "Replay Repro in Browser" engine with fuzzy multi-signal element locator in `content.js`.
- [x] **A30**: Numbered step callout badge tool (`[1]`, `[2]`, `[3]`) in `annotate.js`.
- [x] **A31**: 4-step onboarding wizard and interactive demo sandbox (`OnboardingWizardModal.tsx`).
- [x] **A32**: Unified People page with role-based access control (`Admin`, `Member`, `Viewer`) in `/team`.
- [x] **A33**: Turnkey Enterprise Docker Compose bundle (`docker-compose.enterprise.yml`, MinIO S3 + Postgres + Redis).

---

## 🧠 Part B: AI-Native Features (100% Completed)

### Phase B1: AI Foundation & Auto-Fill (Weeks 3–5) — 100% DONE
- [x] **B1**: NestJS `AiService` in backend with RCA engine, Playwright spec generator, and compound duplicate detection.
- [x] **B2**: "What's Wrong?" single-input smart form in extension using Mimik 50-token DOM context.
- [x] **B3**: AI Root Cause Analysis panel with code fix suggestions & git diffs on issue detail.

### Phase B2: Duplicate Detection & AI IDE (Weeks 6–8) — 100% DONE
- [x] **B4**: In-modal pre-submit duplicate warning using Sentry compound fingerprinting.
- [x] **B5**: "Send Context to Cursor" button packaging RCA + component + source lines into IDE prompt.

### Phase B3: Automated Testing & Advanced AI (Weeks 9–10) — 100% DONE
- [x] **B6**: Automated Playwright test generation (`.spec.ts`) from rrweb session interaction events and breadcrumbs.
- [x] **B7**: "Record Bug Steps" mode (Mimik `InputSession` + SPA click interception).
- [x] **B8**: AI Screenshot Visual Anomaly Analysis for layout clipping and UI bugs.
