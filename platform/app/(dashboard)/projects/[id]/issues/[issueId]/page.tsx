'use client'
import { useQuery } from '@tanstack/react-query'
import Image from 'next/image'
import { api } from '@/lib/api/client'
import { SyncButton } from '@/components/SyncButton'
import type { Issue } from '@/lib/types'

export default function IssueDetailPage({ params }: { params: { id: string; issueId: string } }) {
  const { data: issue, isLoading } = useQuery<Issue>({
    queryKey: ['issue', params.issueId],
    queryFn: () => api.get<Issue>(`/issues/${params.issueId}`),
  })

  if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>
  if (!issue) return <div className="text-red-500 text-sm">Issue not found</div>

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900 flex-1 mr-4">{issue.description}</h1>
        <SyncButton issueId={issue.id} projectId={params.id} currentStatus={issue.sync_status} />
      </div>
      {issue.external_ticket_url && (
        <a href={issue.external_ticket_url} target="_blank" rel="noopener noreferrer"
          className="inline-block mb-4 text-sm text-blue-600 hover:underline">
          View in Azure DevOps →
        </a>
      )}
      <div className="space-y-4">
        {issue.screenshot_url && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">Screenshot</div>
            <Image src={issue.screenshot_url} alt="Screenshot" width={800} height={600} className="w-full h-auto" unoptimized />
          </div>
        )}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          {issue.url && <Row label="URL" value={issue.url} />}
          {issue.route && <Row label="Route" value={issue.route} />}
          <Row label="Status" value={issue.sync_status} />
          {issue.browser_info && <Row label="Browser" value={JSON.stringify(issue.browser_info)} />}
          {issue.element_info && <Row label="Element" value={JSON.stringify(issue.element_info)} />}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-gray-700 mt-0.5 break-all">{value}</dd>
    </div>
  )
}
