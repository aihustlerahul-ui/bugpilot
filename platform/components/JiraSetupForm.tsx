'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api/client'

export function JiraSetupForm({ existing }: { existing?: { host?: string; email?: string; project_key?: string; issue_type?: string } }) {
  const [host, setHost] = useState(existing?.host ?? '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [projectKey, setProjectKey] = useState(existing?.project_key ?? '')
  const [issueType, setIssueType] = useState(existing?.issue_type ?? 'Bug')
  const [apiToken, setApiToken] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (existing?.host) setHost(existing.host)
    if (existing?.email) setEmail(existing.email)
    if (existing?.project_key) setProjectKey(existing.project_key)
    if (existing?.issue_type) setIssueType(existing.issue_type)
  }, [existing])

  async function handleSave() {
    setStatus('saving')
    setError('')
    try {
      await api.post('/integrations/jira', { host, email, projectKey, issueType, apiToken })
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to connect to Jira')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-lg shadow-2xs">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold">
          J
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">Jira Cloud</h2>
          <p className="text-xs text-gray-500">Sync QA reports directly into Atlassian Jira projects</p>
        </div>
      </div>

      <div className="space-y-4 text-sm">
        <div>
          <label className="block font-medium text-gray-700 mb-1">Jira Host URL</label>
          <input
            type="url"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="https://your-domain.atlassian.net"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block font-medium text-gray-700 mb-1">Atlassian Account Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dev@company.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-gray-700 mb-1">Project Key</label>
            <input
              type="text"
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              placeholder="ENG"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block font-medium text-gray-700 mb-1">Issue Type</label>
            <input
              type="text"
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              placeholder="Bug"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block font-medium text-gray-700 mb-1">Jira API Token</label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="Paste your Jira API Token"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            Generate at id.atlassian.com → Security → API tokens.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={!host || !email || !projectKey || status === 'saving'}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {status === 'saving' ? 'Testing Connection...' : 'Test Connection & Save'}
        </button>

        {status === 'success' && <p className="text-green-600 text-sm font-medium">✓ Connected to Jira Cloud</p>}
        {status === 'error' && <p className="text-red-600 text-sm font-medium">{error}</p>}
      </div>
    </div>
  )
}
