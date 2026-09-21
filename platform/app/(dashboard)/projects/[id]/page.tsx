'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import type { Issue, Project, TeamMember, MemberConflict, IssueTriageStatus } from '@/lib/types';
import { VideoBadge } from '@/components/VideoBadge';
import { DiagnosticFilterBar } from '@/components/DiagnosticFilterBar';
import { TriageStatusBadge } from '@/components/TriageStatusBadge';
import { KanbanBoard } from '@/components/KanbanBoard';
import { VisualGalleryView } from '@/components/VisualGalleryView';
import {
  PlayIcon,
  TerminalIcon,
  LayersIcon,
} from '@/components/Icons';

const SYNC_STATUS_CONFIG = {
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  synced:  { label: 'Synced',  cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  failed:  { label: 'Failed',  cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
};

const SEVERITY_CONFIG: Record<string, { label: string; cls: string }> = {
  Critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  High:     { label: 'High',     cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  high:     { label: 'High',     cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  Medium:   { label: 'Medium',   cls: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  medium:   { label: 'Medium',   cls: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  Low:      { label: 'Low',      cls: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
  low:      { label: 'Low',      cls: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseConflict(err: Error): MemberConflict | null {
  try { return JSON.parse(err.message); } catch { return null; }
}

export default function ProjectPage({ params }: { params: { id: string } }) {
  const [activeTab, setActiveTab] = useState<'issues' | 'members'>('issues');
  const [viewMode, setViewMode] = useState<'table' | 'kanban' | 'gallery'>('table');
  const [filteredIssues, setFilteredIssues] = useState<Issue[] | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberConflict, setMemberConflict] = useState<MemberConflict | null>(null);
  const [memberError, setMemberError] = useState('');

  const qc = useQueryClient();

  const { data: project } = useQuery<Project>({
    queryKey: ['project', params.id],
    queryFn: () => api.get<Project>(`/projects/${params.id}`),
  });

  const { data: issues = [], isLoading, isError } = useQuery<Issue[]>({
    queryKey: ['issues', params.id],
    queryFn: () => api.get<Issue[]>(`/issues/project/${params.id}`),
  });

  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ['project-members', params.id],
    queryFn: () => api.get<TeamMember[]>(`/workspaces/members/project/${params.id}`),
  });

  // Optimistic update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ issueId, status }: { issueId: string; status: IssueTriageStatus }) =>
      api.patch(`/issues/${issueId}/status`, { status }),
    onMutate: async ({ issueId, status }) => {
      await qc.cancelQueries({ queryKey: ['issues', params.id] });
      const prev = qc.getQueryData<Issue[]>(['issues', params.id]);
      if (prev) {
        qc.setQueryData<Issue[]>(['issues', params.id], (old = []) =>
          old.map((i) => (i.id === issueId ? { ...i, triage_status: status } : i))
        );
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        qc.setQueryData(['issues', params.id], context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['issues', params.id] });
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
  });

  // Bulk update status
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ issueIds, status }: { issueIds: string[]; status: IssueTriageStatus }) => {
      await Promise.all(issueIds.map((id) => api.patch(`/issues/${id}/status`, { status })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', params.id] });
      setSelectedIssueIds([]);
    },
  });

  const addMember = useMutation({
    mutationFn: () => api.post(`/workspaces/members/project/${params.id}`, { name: memberName, email: memberEmail }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', params.id] });
      qc.invalidateQueries({ queryKey: ['team-members'] });
      setAddingMember(false); setMemberName(''); setMemberEmail(''); setMemberConflict(null);
    },
    onError: (err: Error) => {
      const c = parseConflict(err);
      if (c) { setMemberConflict(c); return; }
      setMemberError(err.message);
    },
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => api.delete(`/workspaces/members/project/${params.id}/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', params.id] }),
  });

  const displayIssues = filteredIssues !== null ? filteredIssues : issues;

  const toggleSelectAll = () => {
    if (selectedIssueIds.length === displayIssues.length) {
      setSelectedIssueIds([]);
    } else {
      setSelectedIssueIds(displayIssues.map((i) => i.id));
    }
  };

  const toggleSelectIssue = (id: string) => {
    setSelectedIssueIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{project?.name ?? '…'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isLoading ? 'Loading…' : `${issues.length} issue${issues.length !== 1 ? 's' : ''} reported`}
          </p>
        </div>

        {/* View Switcher Tabs when on issues */}
        {activeTab === 'issues' && issues.length > 0 && (
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-xs" id="tour-view-switcher">
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                viewMode === 'table'
                  ? 'bg-white text-indigo-600 shadow-xs ring-1 ring-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />
              </svg>
              Table
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                viewMode === 'kanban'
                  ? 'bg-white text-indigo-600 shadow-xs ring-1 ring-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="18" rx="1" />
                <rect x="14" y="3" width="7" height="10" rx="1" />
              </svg>
              Kanban
            </button>
            <button
              onClick={() => setViewMode('gallery')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                viewMode === 'gallery'
                  ? 'bg-white text-indigo-600 shadow-xs ring-1 ring-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              Gallery
            </button>
          </div>
        )}
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          Failed to load issues. Please refresh.
        </div>
      )}

      {/* Top-level tabs */}
      <div className="flex gap-0 border-b border-gray-200">
        {(['issues', 'members'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-600 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab === 'issues' ? `Issues (${issues.length})` : `Members (${members.length})`}
          </button>
        ))}
      </div>

      {/* Issues tab */}
      {activeTab === 'issues' && (
        <>
          {!isLoading && issues.length === 0 && !isError && (
            <div className="text-center py-20 border border-dashed border-gray-200 rounded-xl bg-white">
              <p className="text-base font-medium text-gray-500">No issues yet</p>
              <p className="text-sm text-gray-400 mt-1">Report one from the Chrome extension to get started.</p>
            </div>
          )}

          {issues.length > 0 && (
            <div className="space-y-4">
              {/* Search & Diagnostic Filter Bar with URL synchronization */}
              <div id="tour-filter-bar">
                <DiagnosticFilterBar
                  issues={issues}
                  onFilteredIssuesChange={(filtered) => setFilteredIssues(filtered)}
                />
              </div>

              {/* Floating Bulk Action Bar */}
              {selectedIssueIds.length > 0 && (
                <div className="sticky top-4 z-20 flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/95 p-3 shadow-lg backdrop-blur-xs">
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[11px] text-white">
                      {selectedIssueIds.length}
                    </span>
                    selected
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-indigo-700">Set Status:</span>
                    {(['In Triage', 'Confirmed', 'In Dev', 'Resolved', 'Closed'] as IssueTriageStatus[]).map((st) => (
                      <button
                        key={st}
                        onClick={() => bulkStatusMutation.mutate({ issueIds: selectedIssueIds, status: st })}
                        className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-indigo-50"
                      >
                        {st}
                      </button>
                    ))}
                    <button
                      onClick={() => setSelectedIssueIds([])}
                      className="ml-2 text-xs text-indigo-600 hover:text-indigo-900 font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Render Selected View: Table / Kanban / Gallery */}
              {viewMode === 'table' && (
                displayIssues.length > 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/80">
                          <th className="px-3 py-3 w-8 text-center">
                            <input
                              type="checkbox"
                              checked={selectedIssueIds.length === displayIssues.length && displayIssues.length > 0}
                              onChange={toggleSelectAll}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-10">#</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Route</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Triage Status</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Severity</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Sync</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Created</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {displayIssues.map((issue, i) => {
                          const syncSt = SYNC_STATUS_CONFIG[issue.sync_status] ?? SYNC_STATUS_CONFIG.pending;
                          const sev = SEVERITY_CONFIG[issue.severity ?? 'Medium'] ?? SEVERITY_CONFIG.Medium;
                          const titleLine = issue.title || issue.description.split('\n')[0];
                          const subLine   = issue.description.split('\n').slice(1).join(' ').trim();
                          const elInfo = (issue.element_info || {}) as { react?: { componentName?: string }; reactComponentName?: string };
                          const reactComp = elInfo.react?.componentName || elInfo.reactComponentName;
                          const hasReplay = Boolean(issue.replayUrl || issue.replay_storage_path);
                          const consoleErrorsCount = issue.metadata?.consoleErrors?.length ?? 0;
                          const isSelected = selectedIssueIds.includes(issue.id);

                          return (
                            <tr key={issue.id} className={`hover:bg-gray-50/60 transition-colors group ${isSelected ? 'bg-indigo-50/40' : ''}`}>
                              <td className="px-3 py-3.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectIssue(issue.id)}
                                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                              </td>
                              <td className="px-4 py-3.5 text-xs text-gray-300 font-mono tabular-nums">{i + 1}</td>
                              <td className="px-4 py-3.5">
                                <div className="space-y-1">
                                  <Link href={`/projects/${params.id}/issues/${issue.id}`} className="block">
                                    <span className="text-gray-900 font-medium group-hover:text-indigo-600 transition-colors line-clamp-1 leading-snug">
                                      {titleLine}
                                    </span>
                                    {subLine && (
                                      <span className="text-gray-400 text-xs line-clamp-1 block">
                                        {subLine}
                                      </span>
                                    )}
                                  </Link>

                                  {/* Telemetry diagnostic chips */}
                                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                    {reactComp && (
                                      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 ring-1 ring-purple-200">
                                        <LayersIcon className="w-2.5 h-2.5" />
                                        &lt;{reactComp}&gt;
                                      </span>
                                    )}
                                    {hasReplay && (
                                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
                                        <PlayIcon className="w-2.5 h-2.5" />
                                        Replay
                                      </span>
                                    )}
                                    {issue.video_storage_path && (
                                      <VideoBadge />
                                    )}
                                    {consoleErrorsCount > 0 && (
                                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 ring-1 ring-red-200">
                                        <TerminalIcon className="w-2.5 h-2.5" />
                                        {consoleErrorsCount} error{consoleErrorsCount > 1 ? 's' : ''}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>

                              <td className="px-4 py-3.5 text-xs text-gray-400 font-mono hidden md:table-cell">
                                <span className="truncate max-w-[140px] block" title={issue.route ?? issue.url ?? ''}>
                                  {issue.route || (issue.url ? new URL(issue.url).pathname : '—')}
                                </span>
                              </td>

                              {/* Triage Status Dropdown Badge */}
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                <TriageStatusBadge
                                  status={issue.triage_status ?? 'incoming'}
                                  onChange={(newStatus) => {
                                    updateStatusMutation.mutate({
                                      issueId: issue.id,
                                      status: newStatus,
                                    });
                                  }}
                                />
                              </td>

                              <td className="px-4 py-3.5 whitespace-nowrap hidden sm:table-cell">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${sev.cls}`}>
                                  {sev.label}
                                </span>
                              </td>

                              <td className="px-4 py-3.5 whitespace-nowrap hidden lg:table-cell">
                                <div className="flex items-center gap-1.5">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${syncSt.cls}`}>
                                    {syncSt.label}
                                  </span>
                                  {issue.sync_status === 'synced' && issue.external_ticket_id && (
                                    <span className="text-[11px] text-gray-400 font-mono">
                                      #{issue.external_ticket_id}
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap hidden lg:table-cell">
                                {formatDate(issue.created_at)}
                              </td>

                              <td className="px-4 py-3.5 text-right">
                                <Link
                                  href={`/projects/${params.id}/issues/${issue.id}`}
                                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                                >
                                  View →
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl bg-white text-gray-400 text-sm">
                    No issues match the selected diagnostic filters.
                  </div>
                )
              )}

              {viewMode === 'kanban' && (
                <KanbanBoard
                  issues={displayIssues}
                  projectId={params.id}
                  onUpdateStatus={(issueId, status) => {
                    updateStatusMutation.mutate({ issueId, status });
                  }}
                />
              )}

              {viewMode === 'gallery' && (
                <VisualGalleryView
                  issues={displayIssues}
                  projectId={params.id}
                  onUpdateStatus={(issueId, status) => {
                    updateStatusMutation.mutate({ issueId, status });
                  }}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Members tab */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Team members assigned to this project can view and manage issues.
            </p>
            {!addingMember && (
              <button
                onClick={() => { setAddingMember(true); setMemberError(''); setMemberConflict(null); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors shadow-xs"
              >
                + Add Member
              </button>
            )}
          </div>

          {/* Add member form */}
          {addingMember && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Add Team Member</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Full name"
                  value={memberName}
                  onChange={e => setMemberName(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={memberEmail}
                  onChange={e => setMemberEmail(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {memberError && (
                <p className="text-xs text-red-600">{memberError}</p>
              )}

              {memberConflict && (
                <p className="text-xs text-amber-600">Member already exists in workspace: {memberConflict.existing?.email || (memberConflict as { email?: string }).email}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => addMember.mutate()}
                  disabled={!memberName.trim() || !memberEmail.trim() || addMember.isPending}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {addMember.isPending ? 'Adding…' : 'Add'}
                </button>
                <button
                  onClick={() => setAddingMember(false)}
                  className="px-3 py-1.5 text-gray-600 hover:text-gray-800 text-xs font-medium rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Members list */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs divide-y divide-gray-100">
            {members.length === 0 ? (
              <div className="text-center py-12 text-sm text-gray-400">
                No members added yet.
              </div>
            ) : (
              members.map((member) => (
                <div key={member.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                      {member.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-500">{member.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeMember.mutate(member.id)}
                    className="text-xs text-red-600 hover:text-red-800 font-medium"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
