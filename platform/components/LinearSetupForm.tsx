'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api/client'

export function LinearSetupForm({ existing }: { existing?: { team_id?: string; project_id?: string } }) {
  const [teamId, setTeamId] = useState(existing?.team_id ?? '')
  const [projectId, setProjectId] = useState(existing?.project_id ?? '')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (existing?.team_id) setTeamId(existing.team_id)
    if (existing?.project_id) setProjectId(existing.project_id)
  }, [existing])

  async function handleSave() {
    setStatus('saving')
    setError('')
    try {
      await api.post('/integrations/linear', { teamId, projectId: projectId || undefined, apiKey })
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to connect to Linear')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-lg shadow-2xs">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 font-bold">
          L
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">Linear</h2>
          <p className="text-xs text-gray-500">Sync QA reports directly into Linear team issues</p>
        </div>
      </div>

      <div className="space-y-4 text-sm">
        <div>
          <label className="block font-medium text-gray-700 mb-1">Linear Team ID / Key</label>
          <input
            type="text"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="e.g. ENG or 9d3c-..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block font-medium text-gray-700 mb-1">Project ID (Optional)</label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="e.g. Optional Linear Project ID"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block font-medium text-gray-700 mb-1">Linear Personal API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="lin_api_..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            Generate at linear.app → Settings → My Account → API → Personal API Keys.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={!teamId || (!apiKey && !existing?.team_id) || status === 'saving'}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {status === 'saving' ? 'Testing Connection...' : 'Test Connection & Save'}
        </button>

        {status === 'success' && <p className="text-green-600 text-sm font-medium">✓ Connected to Linear</p>}
        {status === 'error' && <p className="text-red-600 text-sm font-medium">{error}</p>}
      </div>
    </div>
  )
}
