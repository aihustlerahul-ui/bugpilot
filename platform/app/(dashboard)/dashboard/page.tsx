'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { DashboardMetrics, IssueTriageStatus } from '@/lib/types';
import { useWorkspaceAccess } from '@/components/useWorkspaceAccess';
import { SparklineChart } from '@/components/SparklineChart';
import { TriageStatusBadge } from '@/components/TriageStatusBadge';
import { OnboardingWizardModal } from '@/components/OnboardingWizardModal';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  PuzzleIcon,
  FolderIcon,
  ClockIcon,
  TerminalIcon,
  PlayIcon,
  VideoIcon,
  LayersIcon,
} from '@/components/Icons';

function formatRelativeTime(dateStr: string) {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / (1000 * 60));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

const SEVERITY_CONFIG: Record<string, { label: string; cls: string }> = {
  Critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  High: { label: 'High', cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  high: { label: 'High', cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  Medium: { label: 'Medium', cls: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  medium: { label: 'Medium', cls: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  Low: { label: 'Low', cls: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
  low: { label: 'Low', cls: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
};

export default function DashboardPage() {
  const { isMemberOnly } = useWorkspaceAccess();
  const queryClient = useQueryClient();
  const [showOnboarding, setShowOnboarding] = React.useState(false);

  const { data: metrics, isLoading, isError } = useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: () => api.get<DashboardMetrics>('/issues/dashboard/metrics'),
    refetchInterval: 30000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ issueId, status }: { issueId: string; status: IssueTriageStatus }) =>
      api.patch(`/issues/${issueId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
  });

  const totalOpen = metrics?.open ?? 0;
  const criticalCount = metrics?.critical ?? 0;
  const resolvedCount = metrics?.resolved ?? 0;
  const trendData = metrics?.trend ?? [];
  const recentIssues = metrics?.recentIssues ?? [];

  const weeklyTrendTotal = trendData.reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Onboarding Wizard Modal */}
      <OnboardingWizardModal isOpen={showOnboarding} onClose={() => setShowOnboarding(false)} />

      {/* Top Banner / Welcome & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Overview Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time QA telemetry, issue triage status, and capture trends across your workspace.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowOnboarding(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 shadow-2xs transition-colors"
          >
            <span>🚀 Quick Start Guide</span>
          </button>
          <Link
            href="/projects"
            id="tour-projects-list"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-xs transition-colors"
          >
            <FolderIcon className="w-3.5 h-3.5 text-gray-500" />
            <span>All Projects</span>
          </Link>
          {!isMemberOnly && (
            <Link
              href="/extension"
              id="tour-extension-cta"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-xs transition-colors"
            >
              <PuzzleIcon className="w-3.5 h-3.5" />
              <span>Browser Extension</span>
            </Link>
          )}
        </div>
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircleIcon className="w-4 h-4 text-red-500 shrink-0" />
          <span>Unable to fetch dashboard metrics. Please refresh or check connection.</span>
        </div>
      )}

      {/* 4 KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" id="tour-metrics-summary">
        {/* Card 1: Total Open */}
        <div className="bg-white rounded-xl border border-gray-200/80 p-5 shadow-xs hover:border-gray-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Open Issues</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
              <ClockIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 tabular-nums">
              {isLoading ? '…' : totalOpen}
            </span>
            <span className="text-xs text-gray-400 font-medium">in triage & dev</span>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
            <span>Requires review</span>
            <span className="font-medium text-blue-600">Active</span>
          </div>
        </div>

        {/* Card 2: Critical */}
        <div className="bg-white rounded-xl border border-gray-200/80 p-5 shadow-xs hover:border-gray-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Critical Blockers</span>
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-600">
              <AlertTriangleIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-red-600 tabular-nums">
              {isLoading ? '…' : criticalCount}
            </span>
            <span className="text-xs text-gray-400 font-medium">unresolved</span>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
            <span>High priority</span>
            <span className={criticalCount > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>
              {criticalCount > 0 ? 'Attention Needed' : 'None'}
            </span>
          </div>
        </div>

        {/* Card 3: Resolved */}
        <div className="bg-white rounded-xl border border-gray-200/80 p-5 shadow-xs hover:border-gray-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Resolved</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <CheckCircleIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-700 tabular-nums">
              {isLoading ? '…' : resolvedCount}
            </span>
            <span className="text-xs text-gray-400 font-medium">closed & fixed</span>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
            <span>Lifecycle complete</span>
            <span className="font-medium text-emerald-600">Done</span>
          </div>
        </div>

        {/* Card 4: 7-Day Trend Sparkline */}
        <div className="bg-white rounded-xl border border-gray-200/80 p-5 shadow-xs hover:border-gray-300 transition-all flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">7-Day Inflow</span>
              <span className="text-xs font-medium text-gray-500 tabular-nums">
                +{weeklyTrendTotal} this week
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-2xl font-bold text-gray-900 tabular-nums">
                {isLoading ? '…' : weeklyTrendTotal}
              </span>
              <SparklineChart data={trendData} width={130} height={36} strokeColor="#2563eb" />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-400 flex items-center justify-between">
            <span>Past 7 days</span>
            <span className="font-mono">Daily capture</span>
          </div>
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden" id="tour-activity-feed">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Recent Issue Activity</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Live incoming bug reports with diagnostic telemetry, replay captures, and triage status.
            </p>
          </div>
          <Link
            href="/projects"
            className="text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 group"
          >
            <span>View All</span>
            <ArrowRightIcon className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
            <span>Loading recent activity…</span>
          </div>
        ) : recentIssues.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base font-medium text-gray-700">No issues recorded yet</p>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              Capture your first bug using the Chrome extension or create a new project to get started.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link
                href="/projects"
                className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Go to Projects
              </Link>
              {!isMemberOnly && (
                <Link
                  href="/extension"
                  className="px-4 py-2 text-xs font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Extension Guide
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentIssues.map((issue) => {
              const sev = SEVERITY_CONFIG[issue.severity ?? 'Medium'] ?? SEVERITY_CONFIG.Medium;
              const title = issue.title || issue.description.split('\n')[0];
              const consoleErrorsCount = issue.metadata?.consoleErrors?.length ?? 0;
              const hasReplay = Boolean(issue.replayUrl || issue.replay_storage_path);
              const hasVideo = Boolean(issue.videoUrl || issue.video_storage_path);
              const reactComponent =
                (issue.element_info?.react as { componentName?: string } | undefined)?.componentName;
              const assignee = issue.metadata?.assignee;
              const networkErrorsCount = (issue.metadata?.networkErrors as unknown[])?.length ?? 0;

              return (
                <div
                  key={issue.id}
                  className="p-5 hover:bg-gray-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                        {issue.projectName || 'Project'}
                      </span>
                      <Link
                        href={`/projects/${issue.project_id}/issues/${issue.id}`}
                        className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1"
                      >
                        {title}
                      </Link>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                      {/* Route / URL */}
                      {(issue.route || issue.url) && (
                        <span className="font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100 truncate max-w-xs">
                          {issue.route || issue.url}
                        </span>
                      )}

                      {/* React component chip */}
                      {reactComponent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 ring-1 ring-purple-200 font-mono text-[11px]">
                          <LayersIcon className="w-3 h-3" />
                          &lt;{reactComponent}&gt;
                        </span>
                      )}

                      {/* Replay indicator pill */}
                      {hasReplay && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 ring-1 ring-blue-200 font-medium text-[11px]">
                          <PlayIcon className="w-2.5 h-2.5" />
                          Replay
                        </span>
                      )}

                      {/* Video indicator pill */}
                      {hasVideo && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 font-medium text-[11px]">
                          <VideoIcon className="w-2.5 h-2.5" />
                          Video
                        </span>
                      )}

                      {/* Console errors indicator */}
                      {consoleErrorsCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 ring-1 ring-rose-200 font-medium text-[11px]">
                          <TerminalIcon className="w-2.5 h-2.5" />
                          {consoleErrorsCount} {consoleErrorsCount === 1 ? 'Error' : 'Errors'}
                        </span>
                      )}

                      {/* Network errors indicator */}
                      {networkErrorsCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 ring-1 ring-amber-200 font-medium text-[11px]">
                          🌐 Net
                        </span>
                      )}

                      {/* Assignee indicator */}
                      {assignee && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 font-medium text-[11px]">
                          👤 {assignee}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status, Severity & Action */}
                  <div className="flex items-center gap-3 shrink-0 self-start md:self-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sev.cls}`}>
                      {sev.label}
                    </span>

                    <TriageStatusBadge
                      status={issue.status ?? 'Incoming'}
                      onStatusChange={(nextStatus) => {
                        updateStatusMutation.mutate({ issueId: issue.id, status: nextStatus });
                      }}
                      size="sm"
                    />

                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {formatRelativeTime(issue.created_at)}
                    </span>

                    <Link
                      href={`/projects/${issue.project_id}/issues/${issue.id}`}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      title="Inspect issue"
                    >
                      <ArrowRightIcon className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
