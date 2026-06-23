'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { api } from '@/lib/api/client'
import type { Project } from '@/lib/types'

export default function ProjectsPage() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [mutationError, setMutationError] = useState('')

  const { data: projects = [], isLoading, isError } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/projects'),
  })

  const createProject = useMutation({
    mutationFn: (name: string) => api.post('/projects', { name, sync_mode: 'manual' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setName(''); setCreating(false) },
    onError: (err: Error) => setMutationError(err.message),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <button onClick={() => setCreating(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          + New Project
        </button>
      </div>
      {creating && (
        <div className="mb-6 flex gap-3">
          <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Project name"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={e => e.key === 'Enter' && name && createProject.mutate(name)} />
          <button onClick={() => name && createProject.mutate(name)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Create</button>
          <button onClick={() => setCreating(false)}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          {mutationError && <p className="text-red-600 text-sm mt-2">{mutationError}</p>}
        </div>
      )}
      {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}
      {isError && <p className="text-red-600 text-sm">Failed to load projects. Please refresh.</p>}
      {!isLoading && projects.length === 0 && <p className="text-gray-500 text-sm">No projects yet.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(p => (
          <Link key={p.id} href={`/projects/${p.id}`}
            className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-400 hover:shadow-sm transition-all">
            <h3 className="font-semibold text-gray-900">{p.name}</h3>
            <p className="text-xs text-gray-500 mt-1 capitalize">Sync: {p.sync_mode}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
