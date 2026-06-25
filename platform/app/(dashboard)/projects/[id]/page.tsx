'use client'
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { api } from '@/lib/api/client'
import type { Issue, Project, TeamMember, MemberConflict } from '@/lib/types'

const STATUS_CONFIG = {
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  synced:  { label: 'Synced',  cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  failed:  { label: 'Failed',  cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function parseConflict(err: Error): MemberConflict | null {
  try { return JSON.parse(err.message) } catch { return null }
}

export default function ProjectPage({ params }: { params: { id: string } }) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'synced' | 'failed'>('all')
  const [activeTab, setActiveTab] = useState<'issues' | 'members'>('issues')
  const [memberName, setMemberName] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberConflict, setMemberConflict] = useState<MemberConflict | null>(null)
  const [memberError, setMemberError] = useState('')

  const qc = useQueryClient()

  const { data: project } = useQuery<Project>({
    queryKey: ['project', params.id],
    queryFn: () => api.get<Project>(`/projects/${params.id}`),
  })

  const { data: issues = [], isLoading, isError } = useQuery<Issue[]>({
    queryKey: ['issues', params.id],
    queryFn: () => api.get<Issue[]>(`/issues/project/${params.id}`),
  })

  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ['project-members', params.id],
    queryFn: () => api.get<TeamMember[]>(`/workspaces/members/project/${params.id}`),
  })

  const addMember = useMutation({
    mutationFn: () => api.post(`/workspaces/members/project/${params.id}`, { name: memberName, email: memberEmail }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', params.id] })
      qc.invalidateQueries({ queryKey: ['team-members'] })
      setAddingMember(false); setMemberName(''); setMemberEmail(''); setMemberConflict(null)
    },
    onError: (err: Error) => {
      const c = parseConflict(err)
      if (c) { setMemberConflict(c); return }
      setMemberError(err.message)
    },
  })

  const removeMember = useMutation({
    mutationFn: (memberId: string) => api.delete(`/workspaces/members/project/${params.id}/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', params.id] }),
  })

  const counts = useMemo(() => ({
    all:     issues.length,
    pending: issues.filter(i => i.sync_status === 'pending').length,
    synced:  issues.filter(i => i.sync_status === 'synced').length,
    failed:  issues.filter(i => i.sync_status === 'failed').length,
  }), [issues])

  const filtered = useMemo(() =>
    filter === 'all' ? issues : issues.filter(i => i.sync_status === filter),
    [issues, filter]
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{project?.name ?? '…'}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {isLoading ? 'Loading…' : `${issues.length} issue${issues.length !== 1 ? 's' : ''} reported`}
        </p>
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
                ? 'border-blue-600 text-blue-600'
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
            <>
              {/* Filter tabs */}
              <div className="flex gap-0 border-b border-gray-200">
                {(['all', 'pending', 'synced', 'failed'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      filter === s
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      filter === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {counts[s]}
                    </span>
                  </button>
                ))}
              </div>

              {/* Table */}
              {filtered.length > 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/80">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-10">#</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Route</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Created</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.map((issue, i) => {
                        const st = STATUS_CONFIG[issue.sync_status] ?? STATUS_CONFIG.pending
                        const titleLine = issue.description.split('\n')[0]
                        const subLine   = issue.description.split('\n').slice(1).join(' ').trim()
                        return (
                          <tr key={issue.id} className="hover:bg-gray-50/60 transition-colors group">
                            <td className="px-5 py-4 text-xs text-gray-300 font-mono tabular-nums">{i + 1}</td>
                            <td className="px-5 py-4">
                              <Link href={`/projects/${params.id}/issues/${issue.id}`} className="block">
                                <span className="text-gray-900 font-medium group-hover:text-blue-600 transition-colors line-clamp-1 leading-snug">
                                  {titleLine}
                                </span>
                                {subLine && (
                                  <span className="text-gray-400 text-xs mt-0.5 line-clamp-1 block">
                                    {subLine}
                                  </span>
                                )}
                              </Link>
                            </td>
                            <td className="px-5 py-4 hidden md:table-cell">
                              <span className="text-gray-400 font-mono text-xs truncate max-w-[180px] block">
                                {issue.route ?? issue.url ?? '—'}
                              </span>
                            </td>
                            <td className="px-5 py-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                                {st.label}
                              </span>
                            </td>
                            <td className="px-5 py-4 hidden lg:table-cell text-xs text-gray-400 whitespace-nowrap">
                              {formatDate(issue.created_at)}
                            </td>
                            <td className="px-3 py-4">
                              <Link href={`/projects/${params.id}/issues/${issue.id}`}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-blue-500 text-base">
                                →
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-10 text-sm text-gray-400">
                  No issues match this filter.
                </div>
              )}
            </>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-gray-400 text-sm pt-2">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
              Loading issues…
            </div>
          )}
        </>
      )}

      {/* Members tab */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Members linked to this project appear as assignee options in the extension.</p>
            <button
              onClick={() => setAddingMember(true)}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + Add Member
            </button>
          </div>

          {members.length === 0 && (
            <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl bg-white">
              <p className="text-sm text-gray-500">No members linked. Add members to enable assignment in the extension.</p>
            </div>
          )}

          {members.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                      <td className="px-4 py-3 text-gray-600">{m.email}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => removeMember.mutate(m.id)}
                          className="text-xs text-red-500 hover:underline"
                        >Remove from project</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {addingMember && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Add member to project</h2>
                {memberConflict && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                    {memberConflict.code === 'EMAIL_CONFLICT'
                      ? `This email belongs to ${memberConflict.existing.name}.`
                      : `${memberConflict.existing.name} already exists with email ${memberConflict.existing.email}.`}
                    {' '}
                    <button
                      className="underline font-medium"
                      onClick={() => addMember.mutate()}
                    >Link them instead?</button>
                  </div>
                )}
                <input
                  placeholder="Full name"
                  value={memberName}
                  onChange={e => { setMemberName(e.target.value); setMemberConflict(null); setMemberError('') }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  placeholder="Email address"
                  type="email"
                  value={memberEmail}
                  onChange={e => { setMemberEmail(e.target.value); setMemberConflict(null); setMemberError('') }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {memberError && <p className="text-red-600 text-xs">{memberError}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => { setAddingMember(false); setMemberConflict(null); setMemberError('') }}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                  <button
                    onClick={() => memberName && memberEmail && addMember.mutate()}
                    disabled={addMember.isPending || !memberName || !memberEmail}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addMember.isPending ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
