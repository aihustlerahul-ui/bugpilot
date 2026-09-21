'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { AzureSetupForm } from '@/components/AzureSetupForm'
import { JiraSetupForm } from '@/components/JiraSetupForm'
import { LinearSetupForm } from '@/components/LinearSetupForm'
import { WebhookSetupForm } from '@/components/WebhookSetupForm'

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<'azure' | 'jira' | 'linear' | 'slack' | 'teams'>('azure')

  const { data: azureData } = useQuery({
    queryKey: ['integration', 'azure'],
    queryFn: () => api.get<{ config: Record<string, string> } | null>('/integrations/azure').catch(() => null),
  })

  const { data: jiraData } = useQuery({
    queryKey: ['integration', 'jira'],
    queryFn: () => api.get<{ config: Record<string, string> } | null>('/integrations/jira').catch(() => null),
  })

  const { data: linearData } = useQuery({
    queryKey: ['integration', 'linear'],
    queryFn: () => api.get<{ config: Record<string, string> } | null>('/integrations/linear').catch(() => null),
  })

  const { data: webhooksData } = useQuery({
    queryKey: ['integration', 'webhooks'],
    queryFn: () => api.get<Array<{ provider: string; config: Record<string, string> }>>('/integrations/webhooks').catch(() => []),
  })

  const slackConfig = webhooksData?.find((w) => w.provider === 'slack')?.config
  const teamsConfig = webhooksData?.find((w) => w.provider === 'teams')?.config

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrations &amp; Connectors</h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect BugPilot to your issue trackers and messaging platforms for 2-way sync and alerts.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-2">
        <button
          id="tour-azure-connector"
          onClick={() => setActiveTab('azure')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'azure'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Azure DevOps
        </button>
        <button
          id="tour-jira-connector"
          onClick={() => setActiveTab('jira')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'jira'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Jira Cloud
        </button>
        <button
          id="tour-linear-connector"
          onClick={() => setActiveTab('linear')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'linear'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Linear
        </button>
        <button
          id="tour-webhooks-connector"
          onClick={() => setActiveTab('slack')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'slack'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Slack Webhook
        </button>
        <button
          onClick={() => setActiveTab('teams')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'teams'
              ? 'border-purple-600 text-purple-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          MS Teams Webhook
        </button>
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === 'azure' && <AzureSetupForm existing={azureData?.config} />}
        {activeTab === 'jira' && <JiraSetupForm existing={jiraData?.config} />}
        {activeTab === 'linear' && <LinearSetupForm existing={linearData?.config} />}
        {activeTab === 'slack' && (
          <WebhookSetupForm
            provider="slack"
            title="Slack Webhook"
            description="Send instant alert notifications into your team's Slack channel on new bugs"
            placeholder="https://hooks.slack.com/services/..."
            existing={slackConfig}
          />
        )}
        {activeTab === 'teams' && (
          <WebhookSetupForm
            provider="teams"
            title="Microsoft Teams Webhook"
            description="Post actionable adaptive cards into Microsoft Teams channels"
            placeholder="https://outlook.office.com/webhook/..."
            existing={teamsConfig}
          />
        )}
      </div>
    </div>
  )
}
