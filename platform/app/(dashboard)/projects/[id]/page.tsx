'use client';

import { useState, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import type { Issue, Project, TeamMember, MemberConflict, IssueTriageStatus } from '@/lib/types';
import { MobileBadge, isMobileIssue } from '@/components/MobileInfo';
import { VideoBadge } from '@/components/VideoBadge';
import { DiagnosticFilterBar } from '@/components/DiagnosticFilterBar';
import { TriageStatusBadge } from '@/components/TriageStatusBadge';
import { KanbanBoard } from '@/components/KanbanBoard';
import { VisualGalleryView } from '@/components/VisualGalleryView';
import {
  PlayIcon,
  TerminalIcon,
  LayersIcon,
  TrashIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
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

function safePathname(url: string | null | undefined): string {
  if (!url) return '—';
  try { return new URL(url).pathname; } catch { return url; }
}

function parseConflict(err: Error): MemberConflict | null {
  try { return JSON.parse(err.message); } catch { return null; }
}

function ProjectPageContent() {
  const routeParams = useParams<{ id: string }>();
  const projectId = routeParams?.id || '';

  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState<'issues' | 'members' | 'settings'>(
    requestedTab === 'settings' ? 'settings' : requestedTab === 'members' ? 'members' : 'issues'
  );
  const [viewMode, setViewMode] = useState<'table' | 'kanban' | 'gallery'>('table');
  const [viewModeInitialized, setViewModeInitialized] = useState(false);
  const [filteredIssues, setFilteredIssues] = useState<Issue[] | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberConflict, setMemberConflict] = useState<MemberConflict | null>(null);
  const [memberError, setMemberError] = useState('');

  // Settings form states
  const [settingsName, setSettingsName] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsSyncMode, setSettingsSyncMode] = useState<'auto' | 'manual'>('manual');
  const [settingsDefaultView, setSettingsDefaultView] = useState<'table' | 'kanban' | 'gallery'>('table');
  const [settingsSavedSuccess, setSettingsSavedSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const qc = useQueryClient();

  // Save as last active project in localStorage
  useEffect(() => {
    if (projectId && typeof window !== 'undefined') {
      localStorage.setItem('last_active_project_id', projectId);
    }
  }, [projectId]);

  // Sync tab with URL parameter if it changes
  useEffect(() => {
    if (requestedTab === 'settings') setActiveTab('settings');
    else if (requestedTab === 'members') setActiveTab('members');
  }, [requestedTab]);

  const { data: project } = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
  });

  // Populate settings form when project data is loaded
  useEffect(() => {
    if (project) {
      setSettingsName(project.name);
      setSettingsDescription((project.settings?.description as string) || '');
      setSettingsSyncMode(project.sync_mode || 'manual');
      const defView = (project.settings?.default_view as 'table' | 'kanban' | 'gallery') || 'table';
      setSettingsDefaultView(defView);

      if (!viewModeInitialized) {
        setViewMode(defView);
        setViewModeInitialized(true);
      }
    }
  }, [project, viewModeInitialized]);


  const { data: issues = [], isLoading, isError } = useQuery<Issue[]>({
    queryKey: ['issues', projectId],
    queryFn: () => api.get<Issue[]>(`/issues/project/${projectId}`),
  });

  // Members (invited testers) cannot manage the team or project settings.
  const isOwner = project?.role !== 'member';

  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get<TeamMember[]>(`/workspaces/members/project/${projectId}`),
    enabled: Boolean(project) && isOwner,
    retry: false,
  });

  // A member who lands on ?tab=settings|members falls back to the issues tab.
  const visibleTab = isOwner ? activeTab : 'issues';

  // Optimistic update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ issueId, status }: { issueId: string; status: IssueTriageStatus }) =>
      api.patch(`/issues/${issueId}/status`, { status }),
    onMutate: async ({ issueId, status }) => {
      await qc.cancelQueries({ queryKey: ['issues', projectId] });
      const prev = qc.getQueryData<Issue[]>(['issues', projectId]);
      if (prev) {
        qc.setQueryData<Issue[]>(['issues', projectId], (old = []) =>
          old.map((i) => (i.id === issueId ? { ...i, triage_status: status } : i))
        );
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        qc.setQueryData(['issues', projectId], context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['issues', projectId] });
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
  });

  // Bulk update status
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ issueIds, status }: { issueIds: string[]; status: IssueTriageStatus }) => {
      await Promise.all(issueIds.map((id) => api.patch(`/issues/${id}/status`, { status })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', projectId] });
      setSelectedIssueIds([]);
    },
  });

  const addMember = useMutation({
    mutationFn: () => api.post(`/workspaces/members/project/${projectId}`, { name: memberName, email: memberEmail }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', projectId] });
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
    mutationFn: (memberId: string) => api.delete(`/workspaces/members/project/${projectId}/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', projectId] }),
  });

  const updateProjectMutation = useMutation({
    mutationFn: (payload: { name?: string; sync_mode?: 'auto' | 'manual'; settings?: Record<string, unknown> }) =>
      api.patch<Project>(`/projects/${projectId}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSettingsSavedSuccess(true);
      setSettingsError('');
      setTimeout(() => setSettingsSavedSuccess(false), 3000);
    },
    onError: (err: Error) => {
      setSettingsError(err.message || 'Failed to update project settings');
    },
  });


  const deleteProjectMutation = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      if (typeof window !== 'undefined') {
        localStorage.removeItem('last_active_project_id');
      }
      setShowDeleteModal(false);
      router.push('/projects?all=true');
    },
    onError: (err: Error) => {
      setSettingsError(err.message || 'Failed to delete project');
    },
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
        {visibleTab === 'issues' && issues.length > 0 && (
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
        {(isOwner ? (['issues', 'members', 'settings'] as const) : (['issues'] as const)).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              visibleTab === tab
                ? 'border-indigo-600 text-indigo-600 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab === 'issues'
              ? `Issues (${issues.length})`
              : tab === 'members'
              ? `Members (${members.length})`
              : 'Settings'}
          </button>
        ))}
      </div>


      {/* Issues tab */}
      {visibleTab === 'issues' && (
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
                                  <Link href={`/projects/${projectId}/issues/${issue.id}`} className="block">
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
                                    {isMobileIssue(issue) && <MobileBadge />}
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
                                  {issue.route || safePathname(issue.url)}
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
                                  href={`/projects/${projectId}/issues/${issue.id}`}
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
                  projectId={projectId}
                  onUpdateStatus={(issueId, status) => {
                    updateStatusMutation.mutate({ issueId, status });
                  }}
                />
              )}

              {viewMode === 'gallery' && (
                <VisualGalleryView
                  issues={displayIssues}
                  projectId={projectId}
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
      {visibleTab === 'members' && (
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

      {/* Settings tab */}
      {visibleTab === 'settings' && (

        <div className="max-w-4xl space-y-6 animate-in fade-in-50 duration-150">
          {settingsSavedSuccess && (
            <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 rounded-xl shadow-2xs">
              <CheckCircleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Project settings saved successfully.</span>
            </div>
          )}

          {settingsError && (
            <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-xl">
              <AlertTriangleIcon className="w-4 h-4 text-red-600 shrink-0" />
              <span>{settingsError}</span>
            </div>
          )}

          {/* General Information Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-5">
            <div>
              <h2 className="text-base font-semibold text-gray-900">General Settings</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Update the project name, description, and sync behaviors.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Project Name
                </label>
                <input
                  type="text"
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  placeholder="Project name"
                  className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={settingsDescription}
                  onChange={(e) => setSettingsDescription(e.target.value)}
                  placeholder="Briefly describe what this project covers (e.g. User onboarding flow, iOS frontend, QA staging app)..."
                  className="w-full max-w-lg px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Sync Mode
                </label>
                <div className="flex flex-col sm:flex-row gap-3 max-w-lg">
                  <label
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all flex-1 ${
                      settingsSyncMode === 'manual'
                        ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sync_mode"
                      value="manual"
                      checked={settingsSyncMode === 'manual'}
                      onChange={() => setSettingsSyncMode('manual')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-semibold text-gray-900">Manual Sync</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Issues stay in BugPilot until manually pushed to connected issue trackers.
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all flex-1 ${
                      settingsSyncMode === 'auto'
                        ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sync_mode"
                      value="auto"
                      checked={settingsSyncMode === 'auto'}
                      onChange={() => setSettingsSyncMode('auto')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-semibold text-gray-900">Auto Sync</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Automatically create tickets in configured connectors (Azure/Jira/Linear).
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100 flex items-center justify-end">
              <button
                type="button"
                onClick={() =>
                  updateProjectMutation.mutate({
                    name: settingsName.trim(),
                    sync_mode: settingsSyncMode,
                    settings: {
                      description: settingsDescription.trim(),
                      default_view: settingsDefaultView,
                    },
                  })
                }
                disabled={!settingsName.trim() || updateProjectMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
              >
                {updateProjectMutation.isPending ? 'Saving…' : 'Save General Settings'}
              </button>
            </div>
          </div>

          {/* Default View Mode Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-5">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Default View Mode</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Choose the default layout displayed when opening this project.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: 'table',
                  title: 'Table View',
                  desc: 'Dense tabular list of issues with quick diagnostic chips and triage status dropdowns.',
                  icon: (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />
                    </svg>
                  ),
                },
                {
                  id: 'kanban',
                  title: 'Kanban Board',
                  desc: 'Columns grouped by Triage Status (Incoming, In Dev, Resolved, etc.).',
                  icon: (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="18" rx="1" />
                      <rect x="14" y="3" width="7" height="10" rx="1" />
                    </svg>
                  ),
                },
                {
                  id: 'gallery',
                  title: 'Visual Gallery',
                  desc: 'Large screenshot cards for instant visual bug triage.',
                  icon: (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  ),
                },
              ].map((layout) => {
                const isSelected = settingsDefaultView === layout.id;
                return (
                  <button
                    key={layout.id}
                    type="button"
                    onClick={() => {
                      const newView = layout.id as 'table' | 'kanban' | 'gallery';
                      setSettingsDefaultView(newView);
                      updateProjectMutation.mutate({
                        settings: {
                          description: settingsDescription.trim(),
                          default_view: newView,
                        },
                      });
                    }}

                    className={`flex flex-col text-left p-4 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-600/30'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <div className={isSelected ? 'text-indigo-600' : 'text-gray-500'}>
                        {layout.icon}
                      </div>
                      {isSelected && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-gray-900">{layout.title}</div>
                    <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                      {layout.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Danger Zone Card */}
          <div className="bg-red-50/40 border border-red-200 rounded-xl p-6 shadow-xs space-y-4">
            <div>
              <h2 className="text-base font-semibold text-red-900">Danger Zone</h2>
              <p className="text-xs text-red-700/80 mt-0.5">
                Irreversible actions for this project and all associated bug reports.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-red-100">
              <div>
                <p className="text-xs font-semibold text-gray-900">Delete this project</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Once deleted, all issues, screenshots, replays, and assignments cannot be recovered.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmText('');
                  setShowDeleteModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-2xs shrink-0"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                <span>Delete Project</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in-50 duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangleIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Delete Project</h3>
                <p className="text-xs text-gray-500">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              Are you sure you want to delete <strong className="text-gray-900">{project?.name}</strong>? All {issues.length} reported issue(s), session replays, and project member associations will be permanently removed.
            </p>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Type <strong>{project?.name}</strong> to confirm:
              </label>
              <input
                type="text"
                autoFocus
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={project?.name}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteProjectMutation.mutate()}
                disabled={deleteConfirmText !== project?.name || deleteProjectMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors shadow-2xs"
              >
                {deleteProjectMutation.isPending ? 'Deleting…' : 'I understand, delete this project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><p className="text-gray-400 text-sm">Loading project…</p></div>}>
      <ProjectPageContent />
    </Suspense>
  );
}


