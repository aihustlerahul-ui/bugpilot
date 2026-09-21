'use client'

import { useState } from 'react'
import { api } from '@/lib/api/client'

interface WebhookSetupFormProps {
  provider: 'slack' | 'teams'
  title: string
  description: string
  placeholder: string
  existing?: { webhook_url?: string; channel_name?: string }
}

export function WebhookSetupForm({
  provider,
  title,
  description,
  placeholder,
  existing,
}: WebhookSetupFormProps) {
  const [webhookUrl, setWebhookUrl] = useState(existing?.webhook_url ?? '')
  const [channelName, setChannelName] = useState(existing?.channel_name ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handleSave() {
    setStatus('saving')
    setError('')
    try {
      await api.post('/integrations/webhooks', {
        provider,
        webhookUrl,
        channelName: channelName || undefined,
        notifyOnSeverity: ['critical', 'high', 'medium', 'low'],
        notifyOnStatus: ['Incoming', 'In Triage', 'In Dev', 'Resolved'],
      })
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to save webhook')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-lg shadow-2xs">
      <div className="flex items-center gap-2 mb-4">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg font-bold ${provider === 'slack' ? 'bg-emerald-50 text-emerald-600' : 'bg-purple-50 text-purple-600'}`}>
          {provider === 'slack' ? '#' : 'T'}
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>

      <div className="space-y-4 text-sm">
        <div>
          <label className="block font-medium text-gray-700 mb-1">Incoming Webhook URL</label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={placeholder}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block font-medium text-gray-700 mb-1">Channel / Team Name (Optional)</label>
          <input
            type="text"
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder={provider === 'slack' ? '#bugs-qa' : 'Engineering QA'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={!webhookUrl || status === 'saving'}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          {status === 'saving' ? 'Saving...' : 'Save Webhook'}
        </button>

        {status === 'success' && <p className="text-green-600 text-sm font-medium">✓ Webhook active and saved</p>}
        {status === 'error' && <p className="text-red-600 text-sm font-medium">{error}</p>}
      </div>
    </div>
  )
}
