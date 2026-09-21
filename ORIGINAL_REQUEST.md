# Original User Request

## 2026-09-12T13:21:29Z

Implement Phase A0, A1, and A2 of BugPilot (Extension quick wins, Live DOM Smart Blur, Dashboard home, Sidebar navigation, Issue search/filtering, Status lifecycle, Replay scrubbing synchronization with 2s pre-roll, 2-column detail view, and Triage Kanban board with severity swimlanes).

Working directory: /Users/rahulsarawagi/Work/bugPilot
Integrity mode: development

## Requirements

### R1. Extension Quick Wins & Privacy Upgrades (Phase A0 & A1)
- Fix rrweb canvas recording configuration in `extension/replay-recorder.js` (`recordCanvas: true, sampling: { canvas: 2 }`).
- Vendor and integrate `finder` (1.1KB) in `extension/content.js` to generate shortest unique resilient CSS selectors.
- Integrate Bug Magnet exploratory test data menus via `chrome.contextMenus` in `extension/background.js`.
- Replace the dark annotation rectangle in `extension/annotate.js` with true Gaussian blur (`ctx.filter = 'blur(12px)').
- Decouple `@rrweb/record` from extension to reduce payload footprint.
- Port Mimik's live DOM TreeWalker Smart Blur into `extension/content.js` to redact emails, phone numbers, SSNs, credit cards, and IPs in live DOM before capture.
- Upgrade element context cropping to aspect-ratio aware geometry (`PAD_RATIO = 0.3`) with rounded dashed borders (`[8, 5]`).

### R2. Web Platform Dashboard & Triage Lifecycle (Phase A1)
- Build a Dashboard summary home page at `/` or `/dashboard` with key metrics (open, critical, resolved, trend sparkline), recent activity, and quick navigation.
- Redesign sidebar layout with workspace switcher at top, collapsible projects list, and reorganized nav items.
- Implement search and diagnostic filtering (status, severity, assignee, dates, replay/video availability, console error presence, React component name).
- Add database migration and API support for explicit issue triage status (`Incoming`, `In Triage`, `Confirmed`, `In Dev`, `Resolved`, `Closed`) separate from sync status.

### R3. Replay Synchronization & 2-Column Detail View (Phase A2)
- Add interactive scrubber markers (🔴 errors, 🟡 network drops, 🔵 clicks) in `platform/components/ReplayPlayer.tsx` with 2-second pre-roll seek (`Math.max(0, eventTime - 2000)`).
- Implement Master Clock synchronization linking replay playback timestamp to active console log and network request rows.
- Configure `slimDOMOptions` and `@rrweb/packer` to compress replay payload sizes.
- Redesign the issue detail page (`projects/[id]/issues/[issueId]/page.tsx`) into a sticky 2-column split layout: Left pane (60%) for media hub (Replay, Video, Screenshots), Right pane (40%) for tabbed DevTools inspector (`DOM & React`, `Console Logs`, `Network Requests`, `Environment`, `Activity & Comments`).

### R4. Triage Kanban Board with Severity Swimlanes (Phase A2)
- Implement drag-and-drop Kanban board using `@dnd-kit/core` and `@dnd-kit/sortable` with horizontal swimlanes for `Critical`, `High`, `Medium`, `Low` severity and columns for triage lifecycle.
- Add optimistic UI updates with TanStack Query `onMutate` rollback on failure.
- Design rich QA diagnostic cards with screenshot thumbnails, React component chips (`<CheckoutButton>`), telemetry chips (`🎬 Replay`, `📹 Video`, `⚠️ Errors`, `🌐 Net 500`), sync status pills, and one-click IDE deep links (`vscode://`, `cursor://`).
- Add sub-header view switcher: `[Kanban Board]` `[Diagnostic Table]` `[Visual Gallery]`.

## Acceptance Criteria

### Extension & Capture Integrity
- [ ] Extension builds cleanly with zero syntax/bundling errors.
- [ ] Smart blur redacts regex-matched sensitive data in live DOM before `captureVisibleTab` runs.
- [ ] `finder` generates compact, unique CSS selectors for clicked DOM elements.
- [ ] Context crop maintains consistent aspect ratio around elements with dashed rounded callout box.

### Web Platform & Dashboard
- [ ] Next.js platform builds cleanly without TypeScript or ESLint errors (`npm run build` in `platform/`).
- [ ] Dashboard renders metric cards, activity feed, and project links.
- [ ] Issues list filters and searches dynamically with URL query synchronization.
- [ ] ReplayPlayer renders colored scrubber tick markers and clicking a tick seeks to 2 seconds before the event.
- [ ] Issue detail page renders in 2-column split view with synchronized DevTools tabs.
- [ ] Kanban board permits dragging cards across columns and swimlanes with optimistic UI updates.
