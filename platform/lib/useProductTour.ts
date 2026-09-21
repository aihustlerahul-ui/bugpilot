'use client'

import { useCallback } from 'react'
import { driver, DriveStep } from '@/lib/driver'

export type TourType = 'dashboard' | 'kanban' | 'issueDetail' | 'extensionSettings' | 'connectors'

export const TOURS: Record<TourType, { name: string; description: string; steps: DriveStep[] }> = {
  dashboard: {
    name: 'Dashboard Overview',
    description: 'Explore workspace metrics, sparklines, and recent activity.',
    steps: [
      {
        element: '#tour-workspace-switcher',
        popover: {
          title: '🏢 Workspace Switcher',
          description: 'Switch between team workspaces or create a new organization. All settings and integrations are scoped per workspace.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-metrics-summary',
        popover: {
          title: '📊 Key Quality Metrics',
          description: 'High-level overview of total open bugs, critical blocker issues, resolution rate, and a 7-day sparkline trend.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-projects-list',
        popover: {
          title: '📁 Projects & Repositories',
          description: 'Quick access to all active web, mobile, and backend projects with open bug counts and direct links to triage boards.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-activity-feed',
        popover: {
          title: '⚡ Live Activity Feed',
          description: 'Real-time timeline of newly submitted issues, status transitions, and Jira/Linear/Azure synchronization events.',
          side: 'left',
          align: 'start',
        },
      },
      {
        element: '#tour-extension-cta',
        popover: {
          title: '🧩 Chrome Extension Quick-Link',
          description: 'Download the extension or open extension telemetry settings to customize how diagnostics are captured.',
          side: 'bottom',
          align: 'center',
        },
      },
    ],
  },

  kanban: {
    name: 'Kanban & Triage Board',
    description: 'Learn how to triage, filter, and drag-and-drop bug cards.',
    steps: [
      {
        element: '#tour-view-switcher',
        popover: {
          title: '🔀 Multi-View Switcher',
          description: 'Toggle between the visual Kanban Board (severity swimlanes), Diagnostic Table (deep sorting), and Visual Gallery (screenshot comparison).',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-filter-bar',
        popover: {
          title: '🔍 Multi-Criteria Diagnostic Filter',
          description: 'Filter bugs by Status, Severity, Assignee, Session Replay presence, Console errors, or React Component name. Filters automatically sync with URL query parameters.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-severity-swimlanes',
        popover: {
          title: '🚨 Severity Swimlanes',
          description: 'Critical, High, Medium, and Low swimlanes ensure blocking issues remain visible at the very top of your triage board.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-triage-columns',
        popover: {
          title: '🔄 Triage Lifecycle Columns',
          description: 'Drag cards seamlessly across Incoming → In Triage → Confirmed → In Dev → Resolved → Closed with optimistic instant UI updates.',
          side: 'top',
          align: 'start',
        },
      },
    ],
  },

  issueDetail: {
    name: 'Issue Detail & Diagnostic Inspector',
    description: 'Inspect session replays, master clock logs, and AI root cause analyses.',
    steps: [
      {
        element: '#tour-media-hub',
        popover: {
          title: '🎬 Sticky Media Hub',
          description: 'Watch the full DOM session replay, inspect screen video recordings with audio/webcam, or zoom in on high-res screenshots.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '#tour-scrubber-ticks',
        popover: {
          title: '⏱️ Interactive Error Scrubber',
          description: 'Click colored markers (🔴 Errors, 🟡 Network 4xx/5xx, 🔵 Clicks) to instantly jump with a 2-second pre-roll before the failure occurred.',
          side: 'top',
          align: 'center',
        },
      },
      {
        element: '#tour-devtools-tabs',
        popover: {
          title: '🛠️ 5-Tab DevTools Inspector',
          description: 'Explore DOM & React Fiber metadata, Console logs, Network requests waterfall, Breadcrumb flight recorder, and Browser performance metrics.',
          side: 'left',
          align: 'start',
        },
      },
      {
        element: '#tour-ai-rca-panel',
        popover: {
          title: '🤖 AI Root Cause Analysis',
          description: 'AI analyzes console traces, network payloads, and DOM context to diagnose root causes and generate git diff code fix suggestions.',
          side: 'left',
          align: 'start',
        },
      },
      {
        element: '#tour-ide-prompt-btn',
        popover: {
          title: '⚡ 1-Click Cursor / Copilot Prompt',
          description: 'Packages the entire diagnostic context, component hierarchy, stack frames, and reproduction steps into an AI IDE prompt.',
          side: 'left',
          align: 'start',
        },
      },
    ],
  },

  extensionSettings: {
    name: 'Extension Settings & Sensible Defaults',
    description: 'Understand screenshot modes, diagnostics levels, and advanced telemetry.',
    steps: [
      {
        element: '#tour-screenshot-modes',
        popover: {
          title: '📸 Screenshot Modes',
          description: 'Choose what gets captured when you click an element: Full Screen, Element Crop, Element + Context (30% padding), or Full with Highlight.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-diagnostics-preset',
        popover: {
          title: '🎯 Diagnostics Level: Full (Sensible Defaults)',
          description: 'Enabled by default to turn on all rich diagnostic collectors without decision fatigue. You can switch to Strict Privacy for zero DOM introspection.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-advanced-accordion',
        popover: {
          title: '⚙️ Advanced Technical Accordion',
          description: 'Expand this accordion anytime to fine-tune individual collectors: React Fiber metadata, DOM breadcrumbs, Computed CSS styles, XPath, and memory keys.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '#tour-bug-form-settings',
        popover: {
          title: '📝 Bug Form Configuration',
          description: 'Configure required and optional fields displayed in the in-page QA reporting modal (Expected vs Actual, Priority, Sprint, Assignee).',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '#tour-replay-settings',
        popover: {
          title: '🎥 Session Replay & Video Controls',
          description: 'Configure multi-tab DOM recording, WebM screen video capture, microphone audio, and webcam video overlay.',
          side: 'top',
          align: 'start',
        },
      },
    ],
  },

  connectors: {
    name: 'Enterprise Connectors & Webhooks',
    description: 'Set up two-way sync with Jira, Linear, Azure DevOps, Slack, and Teams.',
    steps: [
      {
        element: '#tour-jira-connector',
        popover: {
          title: '🔷 Atlassian Jira Cloud',
          description: 'Two-way sync that automatically converts bug reports into Jira issues with Atlassian Document Format (ADF) repro steps.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-linear-connector',
        popover: {
          title: '🟣 Linear Team Sync',
          description: 'Instantly creates Linear issues with mapped priorities and two-way status mirroring.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-azure-connector',
        popover: {
          title: '🔷 Azure DevOps Work Items',
          description: 'Generates Azure DevOps Bug work items with full HTML reproduction steps and screenshot attachments.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#tour-webhooks-connector',
        popover: {
          title: '📢 Slack & Microsoft Teams Webhooks',
          description: 'Sends rich alert cards to Slack channels or Microsoft Teams when critical bugs are captured or status transitions occur.',
          side: 'top',
          align: 'start',
        },
      },
    ],
  },
}

export function useProductTour() {
  const startTour = useCallback((tourType: TourType) => {
    const tour = TOURS[tourType]
    if (!tour) return

    const driverObj = driver({
      steps: tour.steps,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next →',
      prevBtnText: '← Back',
      doneBtnText: 'Finish Tour ✓',
      closeBtnText: '✕',
      allowClose: true,
      animate: true,
      stagePadding: 8,
      stageRadius: 10,
    })

    driverObj.drive()
  }, [])

  return {
    startTour,
    tours: TOURS,
  }
}
