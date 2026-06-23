'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export function SyncButton({ issueId, projectId, currentStatus }: {
  issueId: string; projectId: string; currentStatus: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const qc = useQueryClient()

  async function handleSync() {
    setLoading(true)
    setError('')
    try {
      await api.post(`/integrations/azure/sync/${issueId}`, {})
      qc.invalidateQueries({ queryKey: ['issue', issueId] })
      qc.invalidateQueries({ queryKey: ['issues', projectId] })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
    setLoading(false)
  }

  if (currentStatus === 'synced') {
    return <span className="text-sm text-green-600 font-medium">✓ Synced to Azure</span>
  }

  return (
    <div>
      <button onClick={handleSync} disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
        {loading ? 'Syncing...' : 'Sync to Azure'}
      </button>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  )
}
