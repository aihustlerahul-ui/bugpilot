'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { api } from '@/lib/api/client'
import type { Issue, Project } from '@/lib/types'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  synced: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { data: project } = useQuery<Project>({
    queryKey: ['project', params.id],
    queryFn: () => api.get<Project>(`/projects/${params.id}`),
  })
  const { data: issues = [], isLoading } = useQuery<Issue[]>({
    queryKey: ['issues', params.id],
    queryFn: () => api.get<Issue[]>(`/issues/project/${params.id}`),
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{project?.name ?? '…'}</h1>
      {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}
      {!isLoading && issues.length === 0 && (
        <p className="text-gray-500 text-sm">No issues yet. Report one from the Chrome extension.</p>
      )}
      {issues.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {issues.map(issue => (
            <Link key={issue.id} href={`/projects/${params.id}/issues/${issue.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 truncate">{issue.description}</p>
                <p className="text-xs text-gray-400 mt-0.5">{issue.route ?? issue.url ?? '—'}</p>
              </div>
              <span className={`ml-4 text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[issue.sync_status]}`}>
                {issue.sync_status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
