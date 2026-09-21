'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { TeamMember, MemberConflict } from '@/lib/types'

function parseConflict(err: Error): MemberConflict | null {
  try { return JSON.parse(err.message) } catch { return null }
}

function ConflictBanner({ conflict, onLink }: { conflict: MemberConflict; onLink: () => void }) {
  const msg = conflict.code === 'EMAIL_CONFLICT'
    ? `This email belongs to ${conflict.existing.name}. Link them instead?`
    : `${conflict.existing.name} already exists with email ${conflict.existing.email}. Link them instead?`
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-4">
      <span>{msg}</span>
      <button onClick={onLink} className="text-amber-900 font-medium underline whitespace-nowrap">Use existing</button>
    </div>
  )
}

function RoleBadge({ role = 'Member' }: { role?: string }) {
  const r = role.toLowerCase()
  if (r === 'admin' || r === 'owner') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">Admin</span>
  }
  if (r === 'viewer') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">Viewer</span>
  }
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Member</span>
}

function MemberModal({ onClose, editTarget }: { onClose: () => void; editTarget?: TeamMember }) {
  const qc = useQueryClient()
  const [name, setName] = useState(editTarget?.name ?? '')
  const [email, setEmail] = useState(editTarget?.email ?? '')
  const [role, setRole] = useState(editTarget?.role || 'Member')
  const [conflict, setConflict] = useState<MemberConflict | null>(null)
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => editTarget
      ? api.patch(`/workspaces/members/${editTarget.id}`, { name, email, role })
      : api.post('/workspaces/members', { name, email, role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-members'] }); onClose() },
    onError: (err: Error) => {
      const c = parseConflict(err)
      if (c) { setConflict(c); return }
      setError(err.message)
    },
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-900">{editTarget ? 'Edit Member' : 'Add Team Member'}</h2>
        {conflict && <ConflictBanner conflict={conflict} onLink={onClose} />}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Full Name</label>
            <input
              placeholder="e.g. Alex Morgan"
              value={name}
              onChange={e => { setName(e.target.value); setConflict(null); setError('') }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Email Address</label>
            <input
              placeholder="alex@company.com"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setConflict(null); setError('') }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Role &amp; Permissions</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="Admin">Admin (Full project &amp; integrations control)</option>
              <option value="Member">Member (Report, triage, and edit bugs)</option>
              <option value="Viewer">Viewer (Read-only replay &amp; reports)</option>
            </select>
          </div>
        </div>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button
            onClick={() => name && email && save.mutate()}
            disabled={save.isPending || !name || !email}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {save.isPending ? 'Saving…' : 'Save Member'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TeamPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<TeamMember | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null)

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['team-members'],
    queryFn: () => api.get<TeamMember[]>('/workspaces/members'),
  })

  const deleteMember = useMutation({
    mutationFn: (id: string) => api.delete(`/workspaces/members/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-members'] }); setDeleteTarget(null) },
  })

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team &amp; Access Control</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage workspace members, assignment targets, and role permissions.</p>
        </div>
        <button
          onClick={() => { setEditTarget(undefined); setShowModal(true) }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 shadow-2xs transition-colors"
        >
          + Add Member
        </button>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading members…</p>}

      {!isLoading && members.length === 0 && (
        <div className="text-center py-20 border border-dashed border-gray-200 rounded-xl bg-white">
          <p className="text-base font-medium text-gray-500">No team members yet</p>
          <p className="text-sm text-gray-400 mt-1">Add members to assign bugs to them from the extension and web platform.</p>
        </div>
      )}

      {members.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map(m => (
                <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-3 text-gray-600">{m.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={m.role || 'Member'} />
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      onClick={() => { setEditTarget(m); setShowModal(true) }}
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >Edit</button>
                    <button
                      onClick={() => setDeleteTarget(m)}
                      className="text-xs text-red-500 hover:underline font-medium"
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <MemberModal editTarget={editTarget} onClose={() => setShowModal(false)} />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Remove Team Member?</h2>
            <p className="text-sm text-gray-600">
              <strong>{deleteTarget.name}</strong> will be unlinked from assigned issues and project workflows.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={() => deleteMember.mutate(deleteTarget.id)}
                disabled={deleteMember.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteMember.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
