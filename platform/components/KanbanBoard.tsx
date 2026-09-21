'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Issue, IssueTriageStatus } from '@/lib/types';
import { VideoBadge } from '@/components/VideoBadge';
import { PlayIcon, TerminalIcon, LayersIcon } from '@/components/Icons';

export function normalizeTriageStatus(status?: string | null): IssueTriageStatus {
  if (!status) return 'Incoming';
  const s = status.toLowerCase().replace(/[_\s-]+/g, '');
  if (s.includes('triage')) return 'In Triage';
  if (s.includes('confirm')) return 'Confirmed';
  if (s.includes('dev')) return 'In Dev';
  if (s.includes('resolve')) return 'Resolved';
  if (s.includes('close')) return 'Closed';
  return 'Incoming';
}

const TRIAGE_COLUMNS: { id: IssueTriageStatus; label: string; bg: string; dot: string }[] = [
  { id: 'Incoming', label: 'Incoming', bg: 'bg-slate-50', dot: 'bg-slate-400' },
  { id: 'In Triage', label: 'In Triage', bg: 'bg-blue-50/50', dot: 'bg-blue-500' },
  { id: 'Confirmed', label: 'Confirmed', bg: 'bg-indigo-50/50', dot: 'bg-indigo-500' },
  { id: 'In Dev', label: 'In Dev', bg: 'bg-amber-50/50', dot: 'bg-amber-500' },
  { id: 'Resolved', label: 'Resolved', bg: 'bg-emerald-50/50', dot: 'bg-emerald-500' },
  { id: 'Closed', label: 'Closed', bg: 'bg-gray-50', dot: 'bg-gray-400' },
];

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;

const SEVERITY_BADGES: Record<string, { label: string; cls: string }> = {
  Critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  High: { label: 'High', cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  high: { label: 'High', cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  Medium: { label: 'Medium', cls: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  medium: { label: 'Medium', cls: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  Low: { label: 'Low', cls: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
  low: { label: 'Low', cls: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
};

interface KanbanBoardProps {
  issues: Issue[];
  projectId: string;
  onUpdateStatus: (issueId: string, status: IssueTriageStatus) => void;
}

interface CardProps {
  issue: Issue;
  projectId: string;
  onUpdateStatus: (issueId: string, status: IssueTriageStatus) => void;
  isOverlay?: boolean;
}

function KanbanCard({ issue, projectId, onUpdateStatus, isOverlay = false }: CardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { issue } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const meta = issue.metadata || {};
  const consoleErrorCount = (meta.consoleErrors?.length ?? 0) + (meta.networkErrors?.length ?? 0);
  const failedNetworkCount = meta.networkTransactions?.filter(
    (tx: { status?: number | string }) => {
      const s = typeof tx.status === 'number' ? tx.status : parseInt(String(tx.status), 10);
      return !isNaN(s) && s >= 400;
    }
  ).length ?? 0;
  const elementInfo = (issue.element_info || {}) as {
    react?: { componentName?: string };
    reactComponentName?: string;
    reactSource?: { fileName?: string; lineNumber?: number };
  };
  const reactComp = elementInfo.react?.componentName || elementInfo.reactComponentName;
  const sourceLine = elementInfo.reactSource?.fileName
    ? `${elementInfo.reactSource.fileName}:${elementInfo.reactSource.lineNumber}`
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex flex-col rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md ${
        isOverlay ? 'rotate-2 scale-105 shadow-xl ring-2 ring-indigo-500' : ''
      }`}
    >
      {/* Top row: Drag handle & Severity */}
      <div className="flex items-center justify-between gap-2">
        <div
          {...attributes}
          {...listeners}
          className="flex cursor-grab items-center gap-1.5 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
          title="Drag card"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 3a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6-10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
          </svg>
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            SEVERITY_BADGES[issue.severity || 'Medium']?.cls || 'bg-slate-100 text-slate-700'
          }`}>
            {issue.severity || 'Medium'}
          </span>
        </div>

        {/* Sync / Triage Status Pill */}
        <div className="flex items-center gap-1.5">
          {issue.sync_status === 'synced' && issue.external_ticket_id && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
              #{issue.external_ticket_id}
            </span>
          )}
          <select
            value={normalizeTriageStatus(issue.triage_status || issue.status)}
            onChange={(e) => onUpdateStatus(issue.id, e.target.value as IssueTriageStatus)}
            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 focus:border-indigo-500 focus:outline-none"
          >
            {TRIAGE_COLUMNS.map((col) => (
              <option key={col.id} value={col.id}>
                {col.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Thumbnail if available */}
      {(issue.element_screenshot_url || issue.screenshot_url) && (
        <Link
          href={`/projects/${projectId}/issues/${issue.id}`}
          className="relative mt-2 block overflow-hidden rounded-lg border border-slate-100 bg-slate-50 aspect-video max-h-24"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={issue.element_screenshot_url || issue.screenshot_url || ''}
            alt={issue.title || 'Screenshot'}
            className="h-full w-full object-cover object-top transition-transform group-hover:scale-105"
          />
        </Link>
      )}

      {/* Issue Title & Description */}
      <Link
        href={`/projects/${projectId}/issues/${issue.id}`}
        className="mt-2 text-xs font-semibold text-slate-900 line-clamp-2 hover:text-indigo-600"
      >
        {issue.title || issue.description || 'Untitled Bug'}
      </Link>

      {/* React Component & Route Chip */}
      {(reactComp || issue.route) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
          {reactComp && (
            <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono font-medium text-slate-700">
              &lt;{reactComp}&gt;
            </span>
          )}
          {issue.route && (
            <span className="truncate max-w-[120px] font-mono text-slate-400">
              {issue.route}
            </span>
          )}
        </div>
      )}

      {/* Telemetry Chips & IDE Deep Link */}
      <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-500">
        <div className="flex items-center gap-2">
          {issue.replay_storage_path && (
            <span className="inline-flex items-center gap-0.5 text-indigo-600" title="rrweb Replay available">
              <PlayIcon className="h-3 w-3" /> Replay
            </span>
          )}
          {issue.video_storage_path && (
            <span className="inline-flex items-center gap-0.5 text-blue-600" title="Screen Video available">
              <VideoBadge className="scale-75 origin-left" />
            </span>
          )}
          {consoleErrorCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-red-600 font-medium" title={`${consoleErrorCount} errors logged`}>
              <TerminalIcon className="h-3 w-3" /> {consoleErrorCount}
            </span>
          )}
          {failedNetworkCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-amber-600 font-medium" title={`${failedNetworkCount} failed API requests`}>
              <LayersIcon className="h-3 w-3" /> {failedNetworkCount}
            </span>
          )}
        </div>

        {/* VS Code / Cursor deep link */}
        {sourceLine && (
          <a
            href={`vscode://file/${sourceLine}`}
            onClick={(e) => e.stopPropagation()}
            title={`Open in IDE (${sourceLine})`}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .32 8.7l3.29 2.8-3.29 2.8a1 1 0 0 0 .007 1.439l1.322 1.202a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 21.06V3.94a1.5 1.5 0 0 0-.85-1.353z" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

function KanbanColumnDropZone({
  column,
  issues,
  projectId,
  onUpdateStatus,
}: {
  column: { id: IssueTriageStatus; label: string; bg: string; dot: string };
  issues: Issue[];
  projectId: string;
  onUpdateStatus: (issueId: string, status: IssueTriageStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', status: column.id },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[500px] w-72 shrink-0 flex-col rounded-xl border border-slate-200/70 ${
        column.bg
      } p-3 transition-colors ${isOver ? 'ring-2 ring-indigo-400 bg-indigo-50/30' : ''}`}
    >
      {/* Column Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${column.dot}`} />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
            {column.label}
          </h3>
        </div>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600 shadow-xs border border-slate-200/50">
          {issues.length}
        </span>
      </div>

      {/* Cards List */}
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2.5">
          {issues.map((issue) => (
            <KanbanCard
              key={issue.id}
              issue={issue}
              projectId={projectId}
              onUpdateStatus={onUpdateStatus}
            />
          ))}
          {issues.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200/80 p-6 text-center text-xs text-slate-400">
              Drop bugs here
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function KanbanBoard({ issues, projectId, onUpdateStatus }: KanbanBoardProps) {
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [swimlaneBySeverity, setSwimlaneBySeverity] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (event: DragStartEvent) => {
    const issue = event.active.data.current?.issue as Issue | undefined;
    if (issue) setActiveIssue(issue);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveIssue(null);
    const { active, over } = event;
    if (!over) return;

    const activeIssue = active.data.current?.issue as Issue | undefined;
    if (!activeIssue) return;

    let targetStatus: IssueTriageStatus | undefined;

    if (over.data.current?.type === 'column') {
      targetStatus = over.data.current.status as IssueTriageStatus;
    } else if (over.data.current?.issue) {
      const overIssue = over.data.current.issue as Issue;
      targetStatus = normalizeTriageStatus(overIssue.triage_status || overIssue.status);
    }

    const currentStatus = normalizeTriageStatus(activeIssue.triage_status || activeIssue.status);
    if (targetStatus && targetStatus !== currentStatus) {
      onUpdateStatus(activeIssue.id, targetStatus);
    }
  };

  return (
    <div className="space-y-4">
      {/* Kanban Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3" id="tour-severity-swimlanes">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={swimlaneBySeverity}
              onChange={(e) => setSwimlaneBySeverity(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Swimlanes by Severity (Critical at top)
          </label>
        </div>
        <div className="text-xs text-slate-500">
          Showing {issues.length} issues across {TRIAGE_COLUMNS.length} triage stages
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div id="tour-triage-columns">
        {swimlaneBySeverity ? (
          // Swimlanes View (Critical, High, Medium, Low)
          <div className="space-y-8">
            {SEVERITIES.map((severity) => {
              const severityIssues = issues.filter(
                (i) => (i.severity || 'Medium').toLowerCase() === severity.toLowerCase()
              );
              return (
                <div key={severity} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${
                      severity === 'Critical' ? 'bg-red-500' : severity === 'High' ? 'bg-orange-500' : severity === 'Medium' ? 'bg-yellow-500' : 'bg-slate-400'
                    }`} />
                    <h3 className="text-sm font-bold text-slate-900">{severity} Severity</h3>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {severityIssues.length}
                    </span>
                  </div>

                  <div className="flex gap-4 overflow-x-auto pb-2">
                    {TRIAGE_COLUMNS.map((col) => {
                      const colIssues = severityIssues.filter(
                        (i) => normalizeTriageStatus(i.triage_status || i.status) === col.id
                      );
                      return (
                        <KanbanColumnDropZone
                          key={`${severity}-${col.id}`}
                          column={col}
                          issues={colIssues}
                          projectId={projectId}
                          onUpdateStatus={onUpdateStatus}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // Standard Single-Board Grid View
          <div className="flex gap-4 overflow-x-auto pb-4">
            {TRIAGE_COLUMNS.map((col) => {
              const colIssues = issues.filter(
                (i) => normalizeTriageStatus(i.triage_status || i.status) === col.id
              );
              return (
                <KanbanColumnDropZone
                  key={col.id}
                  column={col}
                  issues={colIssues}
                  projectId={projectId}
                  onUpdateStatus={onUpdateStatus}
                />
              );
            })}
          </div>
        )}
        </div>

        <DragOverlay>
          {activeIssue ? (
            <KanbanCard
              issue={activeIssue}
              projectId={projectId}
              onUpdateStatus={onUpdateStatus}
              isOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
