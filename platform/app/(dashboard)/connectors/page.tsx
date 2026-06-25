'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { ConnectorPanel } from '@/components/ConnectorPanel'

export type ConnectorId = 'azure' | 'jira' | 'trello' | 'monday'

export interface ConnectorConfig {
  id: ConnectorId
  name: string
  description: string
  logo: string
  brandColor: string
  available: boolean
  fields: Array<{
    key: string
    label: string
    type: 'text' | 'password' | 'url'
    placeholder: string
  }>
  steps: Array<{
    title: string
    description: string
  }>
}

const CONNECTORS: ConnectorConfig[] = [
  {
    id: 'azure',
    name: 'Azure DevOps',
    description: 'Create and sync bug work items directly to your Azure DevOps project.',
    logo: '🔷',
    brandColor: 'bg-blue-600',
    available: true,
    fields: [
      { key: 'orgUrl', label: 'Organization URL', type: 'url', placeholder: 'https://dev.azure.com/yourorg' },
      { key: 'projectName', label: 'Project name', type: 'text', placeholder: 'MyProject' },
      { key: 'pat', label: 'Personal Access Token', type: 'password', placeholder: 'Paste your PAT' },
    ],
    steps: [
      { title: 'Open Azure DevOps', description: 'Go to dev.azure.com and sign in to your organization.' },
      { title: 'User Settings → Personal Access Tokens', description: 'Click your profile avatar (top right) → User settings → Personal access tokens.' },
      { title: 'Create a new token', description: 'Click "+ New Token". Give it a name, set expiry, and under Scopes select Work Items → Read & Write.' },
      { title: 'Copy the token', description: "Copy the token immediately — it won't be shown again. Paste it below." },
      { title: 'Find your project name', description: 'Your project name is visible in the URL: dev.azure.com/{org}/{project}. Paste both below.' },
    ],
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Push bugs as Jira issues to any project in your Atlassian workspace.',
    logo: '🔵',
    brandColor: 'bg-blue-500',
    available: false,
    fields: [
      { key: 'domain', label: 'Atlassian domain', type: 'url', placeholder: 'https://yourorg.atlassian.net' },
      { key: 'email', label: 'Account email', type: 'text', placeholder: 'you@company.com' },
      { key: 'apiToken', label: 'API Token', type: 'password', placeholder: 'Paste your Atlassian API token' },
      { key: 'projectKey', label: 'Project key', type: 'text', placeholder: 'e.g. QA' },
    ],
    steps: [
      { title: 'Go to Atlassian account settings', description: 'Visit id.atlassian.com/manage-profile/security/api-tokens while signed in.' },
      { title: 'Create an API token', description: 'Click "Create API token", give it a label (e.g. "QA Reporter"), and click Create.' },
      { title: 'Copy the token', description: 'Copy the token shown — it will not be displayed again.' },
      { title: 'Find your project key', description: 'In Jira, open your project. The key is the prefix shown on issue numbers (e.g. "QA" in QA-123). Visible in Project settings → Details.' },
    ],
  },
  {
    id: 'trello',
    name: 'Trello',
    description: 'Add bug cards to any Trello board automatically when issues are reported.',
    logo: '🟦',
    brandColor: 'bg-sky-500',
    available: false,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your Trello API key' },
      { key: 'token', label: 'Token', type: 'password', placeholder: 'Your Trello token' },
      { key: 'boardId', label: 'Board ID', type: 'text', placeholder: 'e.g. aBcDeFgH' },
      { key: 'listId', label: 'List ID', type: 'text', placeholder: 'Target list ID' },
    ],
    steps: [
      { title: 'Get your API Key', description: 'Go to trello.com/power-ups/admin → New → choose your workspace → find your API key on the page.' },
      { title: 'Generate a Token', description: 'On the same page, click "Token" next to your API key. Authorize QA Reporter when prompted and copy the token.' },
      { title: 'Find your Board ID', description: 'Open your Trello board and add .json to the URL (e.g. trello.com/b/aBcDeFgH/my-board.json). The "id" field at the top is your Board ID.' },
      { title: 'Find your List ID', description: 'In the same JSON, find the list you want cards added to under "lists" and copy its "id".' },
    ],
  },
  {
    id: 'monday',
    name: 'Monday.com',
    description: 'Create items on your Monday.com board for every bug submitted.',
    logo: '🟠',
    brandColor: 'bg-orange-500',
    available: false,
    fields: [
      { key: 'apiToken', label: 'API Token', type: 'password', placeholder: 'Your Monday.com personal API token' },
      { key: 'boardId', label: 'Board ID', type: 'text', placeholder: 'e.g. 1234567890' },
    ],
    steps: [
      { title: 'Open Monday.com', description: 'Sign in to your Monday.com account.' },
      { title: 'Go to your profile', description: 'Click your avatar (bottom-left) → Developers → My Access Tokens.' },
      { title: 'Copy your personal token', description: 'Click "Show" next to your personal API token and copy it.' },
      { title: 'Find your Board ID', description: 'Open your target board. The Board ID is in the URL: monday.com/boards/{BOARD_ID}.' },
    ],
  },
]

export default function ConnectorsPage() {
  const [activeConnector, setActiveConnector] = useState<ConnectorConfig | null>(null)

  const { data: azureIntegration } = useQuery({
    queryKey: ['integration', 'azure'],
    queryFn: () => api.get<{ id: string; config: Record<string, string>; invalid?: boolean } | null>('/integrations/azure').catch(() => null),
  })

  const isConnected = (id: ConnectorId) => id === 'azure' && !!azureIntegration && !azureIntegration.invalid
  const isInvalid = (id: ConnectorId) => id === 'azure' && !!azureIntegration && azureIntegration.invalid

  return (
    <div className="relative">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Connectors</h1>
        <p className="text-sm text-gray-500 mt-1">Connect QA Reporter to your issue tracking tools for automatic sync.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CONNECTORS.map(connector => (
          <button
            key={connector.id}
            onClick={() => setActiveConnector(connector)}
            className="text-left bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-400 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{connector.logo}</span>
                <div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{connector.name}</h3>
                  {!connector.available && (
                    <span className="text-xs text-gray-400 font-medium">Coming soon</span>
                  )}
                </div>
              </div>
              {isConnected(connector.id) ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Connected
                </span>
              ) : isInvalid(connector.id) ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                  Token invalid
                </span>
              ) : connector.available ? (
                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">Not connected</span>
              ) : (
                <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full border border-dashed border-gray-300">Soon</span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-3 leading-relaxed">{connector.description}</p>
          </button>
        ))}
      </div>

      {activeConnector && (
        <ConnectorPanel
          connector={activeConnector}
          isConnected={isConnected(activeConnector.id)}
          isInvalid={isInvalid(activeConnector.id)}
          existingConfig={activeConnector.id === 'azure' ? azureIntegration?.config : undefined}
          onClose={() => setActiveConnector(null)}
        />
      )}
    </div>
  )
}
