'use client';

import React, { Suspense, useTransition, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Issue } from '@/lib/types';
import { ISSUE_TRIAGE_STATUSES } from '@/lib/types';
import {
  SearchIcon,
  FilterIcon,
  XIcon,
  PlayIcon,
  VideoIcon,
  TerminalIcon,
} from '@/components/Icons';

export interface FilterValues {
  q: string;
  status: string;
  severity: string;
  assignee: string;
  date: string;
  hasReplay: boolean;
  hasVideo: boolean;
  hasErrors: boolean;
  reactComponent: string;
}

interface DiagnosticFilterBarProps {
  issues: Issue[];
  onFilteredIssuesChange?: (filtered: Issue[]) => void;
}

function DiagnosticFilterBarInner({ issues, onFilteredIssuesChange }: DiagnosticFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Read current filters from URL searchParams
  const q = searchParams.get('q') || '';
  const status = searchParams.get('status') || 'all';
  const severity = searchParams.get('severity') || 'all';
  const assignee = searchParams.get('assignee') || 'all';
  const dateRange = searchParams.get('date') || 'all';
  const hasReplay = searchParams.get('hasReplay') === 'true';
  const hasVideo = searchParams.get('hasVideo') === 'true';
  const hasErrors = searchParams.get('hasErrors') === 'true';
  const reactComponent = searchParams.get('reactComponent') || '';

  // Calculate unique assignees and react components present in issues
  const availableAssignees = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((i) => {
      if (i.metadata?.assignee) set.add(i.metadata.assignee);
    });
    return Array.from(set);
  }, [issues]);

  const availableComponents = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((i) => {
      const comp = (i.element_info?.react as { componentName?: string } | undefined)?.componentName;
      if (comp) set.add(comp);
    });
    return Array.from(set);
  }, [issues]);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: issues.length };
    ISSUE_TRIAGE_STATUSES.forEach((st) => {
      counts[st] = 0;
    });
    issues.forEach((i) => {
      const st = i.status ?? 'Incoming';
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  }, [issues]);

  // Apply filters
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      // 1. Search query (title, description, route, url)
      if (q) {
        const query = q.toLowerCase();
        const title = (issue.title || '').toLowerCase();
        const desc = (issue.description || '').toLowerCase();
        const route = (issue.route || '').toLowerCase();
        const url = (issue.url || '').toLowerCase();
        if (!title.includes(query) && !desc.includes(query) && !route.includes(query) && !url.includes(query)) {
          return false;
        }
      }

      // 2. Triage status
      if (status !== 'all') {
        const currentStatus = issue.status ?? 'Incoming';
        if (currentStatus !== status) return false;
      }

      // 3. Severity
      if (severity !== 'all') {
        if ((issue.severity || '').toLowerCase() !== severity.toLowerCase()) return false;
      }

      // 4. Assignee
      if (assignee !== 'all') {
        if (issue.metadata?.assignee !== assignee) return false;
      }

      // 5. Date filter
      if (dateRange !== 'all') {
        const createdMs = new Date(issue.created_at).getTime();
        const now = Date.now();
        if (dateRange === 'today') {
          const startOfToday = new Date().setHours(0, 0, 0, 0);
          if (createdMs < startOfToday) return false;
        } else if (dateRange === '7d') {
          if (now - createdMs > 7 * 24 * 60 * 60 * 1000) return false;
        } else if (dateRange === '30d') {
          if (now - createdMs > 30 * 24 * 60 * 60 * 1000) return false;
        }
      }

      // 6. Has Replay
      if (hasReplay) {
        if (!issue.replayUrl && !issue.replay_storage_path) return false;
      }

      // 7. Has Video
      if (hasVideo) {
        if (!issue.videoUrl && !issue.video_storage_path) return false;
      }

      // 8. Has Console Errors
      if (hasErrors) {
        const errCount = issue.metadata?.consoleErrors?.length ?? 0;
        if (errCount === 0) return false;
      }

      // 9. React Component
      if (reactComponent) {
        const comp = (issue.element_info?.react as { componentName?: string } | undefined)?.componentName;
        if (!comp || !comp.toLowerCase().includes(reactComponent.toLowerCase())) return false;
      }

      return true;
    });
  }, [issues, q, status, severity, assignee, dateRange, hasReplay, hasVideo, hasErrors, reactComponent]);

  // Synchronize filtered issues up to parent
  React.useEffect(() => {
    if (onFilteredIssuesChange) {
      onFilteredIssuesChange(filteredIssues);
    }
  }, [filteredIssues, onFilteredIssuesChange]);

  // Helper to update URL searchParams
  function updateParams(updates: Partial<Record<string, string | null>>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '' || value === 'all' || value === 'false') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    startTransition(() => {
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    });
  }

  const hasActiveFilters =
    Boolean(q) ||
    status !== 'all' ||
    severity !== 'all' ||
    assignee !== 'all' ||
    dateRange !== 'all' ||
    hasReplay ||
    hasVideo ||
    hasErrors ||
    Boolean(reactComponent);

  function clearAllFilters() {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  }

  return (
    <div className="space-y-4">
      {/* Search Input & Quick Filters Row */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Search bar */}
        <div className="relative flex-1 max-w-lg">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={q}
            onChange={(e) => updateParams({ q: e.target.value })}
            placeholder="Search by title, description, or route…"
            className="w-full pl-10 pr-9 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-xs"
          />
          {q && (
            <button
              type="button"
              onClick={() => updateParams({ q: null })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Diagnostic Selectors */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Severity filter dropdown */}
          <select
            value={severity}
            onChange={(e) => updateParams({ severity: e.target.value })}
            aria-label="Filter by severity"
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-xs cursor-pointer"
          >
            <option value="all">All Severities</option>
            <option value="Critical">🔴 Critical</option>
            <option value="High">🟠 High</option>
            <option value="Medium">🟡 Medium</option>
            <option value="Low">⚪ Low</option>
          </select>

          {/* Assignee filter dropdown */}
          {availableAssignees.length > 0 && (
            <select
              value={assignee}
              onChange={(e) => updateParams({ assignee: e.target.value })}
              aria-label="Filter by assignee"
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-xs cursor-pointer"
            >
              <option value="all">All Assignees</option>
              {availableAssignees.map((a) => (
                <option key={a} value={a}>
                  👤 {a}
                </option>
              ))}
            </select>
          )}

          {/* Date range dropdown */}
          <select
            value={dateRange}
            onChange={(e) => updateParams({ date: e.target.value })}
            aria-label="Filter by date range"
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-xs cursor-pointer"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

          {/* Clear button if filters applied */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <XIcon className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Triage Status Filter Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto pb-px">
        {['all', ...ISSUE_TRIAGE_STATUSES].map((s) => {
          const isActive = status === s;
          const count = statusCounts[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => updateParams({ status: s === 'all' ? null : s })}
              className={`px-3.5 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-all flex items-center gap-1.5 ${
                isActive
                  ? 'border-blue-600 text-blue-600 font-semibold'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              <span>{s === 'all' ? 'All Issues' : s}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium tabular-nums ${
                  isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Diagnostic Filter Chips Row */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs text-gray-400 font-medium flex items-center gap-1 mr-1">
          <FilterIcon className="w-3 h-3" />
          <span>Diagnostic Filters:</span>
        </span>

        {/* Chip 1: Replay */}
        <button
          type="button"
          onClick={() => updateParams({ hasReplay: hasReplay ? null : 'true' })}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            hasReplay
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <PlayIcon className="w-3 h-3" />
          <span>🎬 Replay</span>
        </button>

        {/* Chip 2: Video */}
        <button
          type="button"
          onClick={() => updateParams({ hasVideo: hasVideo ? null : 'true' })}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            hasVideo
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <VideoIcon className="w-3 h-3" />
          <span>📹 Video</span>
        </button>

        {/* Chip 3: Console Errors */}
        <button
          type="button"
          onClick={() => updateParams({ hasErrors: hasErrors ? null : 'true' })}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            hasErrors
              ? 'bg-rose-600 text-white shadow-xs'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <TerminalIcon className="w-3 h-3" />
          <span>⚠️ Console Errors</span>
        </button>

        {/* Chip 4: React Component filter */}
        {availableComponents.length > 0 && (
          <div className="inline-flex items-center gap-1">
            <select
              value={reactComponent}
              onChange={(e) => updateParams({ reactComponent: e.target.value })}
              aria-label="Filter by React component"
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                reactComponent
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <option value="" className="text-gray-900 bg-white">
                ⚛️ All Components
              </option>
              {availableComponents.map((c) => (
                <option key={c} value={c} className="text-gray-900 bg-white">
                  &lt;{c}&gt;
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

export function DiagnosticFilterBar(props: DiagnosticFilterBarProps) {
  return (
    <Suspense
      fallback={
        <div className="space-y-3">
          <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          <div className="h-8 bg-gray-50 rounded-lg animate-pulse" />
        </div>
      }
    >
      <DiagnosticFilterBarInner {...props} />
    </Suspense>
  );
}
