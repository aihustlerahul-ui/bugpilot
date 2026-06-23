'use client'
import { useState } from 'react'
import { api } from '@/lib/api/client'

export function AzureSetupForm({ existing }: { existing?: { org_url?: string; project_name?: string } }) {
  const [orgUrl, setOrgUrl] = useState(existing?.org_url ?? '')
  const [projectName, setProjectName] = useState(existing?.project_name ?? '')
  const [pat, setPat] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handleSave() {
    setStatus('saving')
    setError('')
    try {
      await api.post('/integrations/azure', { orgUrl, projectName, pat })
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-lg">
      <h2 className="font-semibold text-gray-900 mb-4">Azure DevOps</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization URL</label>
          <input type="url" value={orgUrl} onChange={e => setOrgUrl(e.target.value)}
            placeholder="https://dev.azure.com/yourorg"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Project name</label>
          <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)}
            placeholder="MyProject"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Personal Access Token</label>
          <input type="password" value={pat} onChange={e => setPat(e.target.value)}
            placeholder="Paste your PAT here"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-gray-400 mt-1">
            Generate at Azure DevOps → User Settings → Personal Access Tokens. Needs Work Items (Read &amp; Write) scope.
          </p>
        </div>
        <button onClick={handleSave} disabled={!orgUrl || !projectName || !pat || status === 'saving'}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {status === 'saving' ? 'Testing & Saving...' : 'Test Connection & Save'}
        </button>
        {status === 'success' && <p className="text-green-600 text-sm">✓ Connected and saved</p>}
        {status === 'error' && <p className="text-red-600 text-sm">{error}</p>}
      </div>
    </div>
  )
}
