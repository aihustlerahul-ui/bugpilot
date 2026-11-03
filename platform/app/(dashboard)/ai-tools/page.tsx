'use client'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useWorkspaceAccess } from '@/components/useWorkspaceAccess'
import { CheckIcon, AlertTriangleIcon, PlusIcon } from '@/components/Icons'
import type { ApiKeyRow, Project } from '@/lib/types'

interface CreatedKey extends Pick<ApiKeyRow, 'id' | 'name' | 'keyPrefix'> {
  key: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString() : 'Never'
}

function buildSnippet(apiKey: string, workspaceId: string) {
  return JSON.stringify(
    {
      mcpServers: {
        bugpilot: {
          command: 'node',
          args: ['<ABSOLUTE_PATH_TO_REPO>/packages/mcp-server/src/index.js'],
          env: {
            BUGPILOT_API_URL: API_URL,
            BUGPILOT_API_KEY: apiKey,
            BUGPILOT_WORKSPACE_ID: workspaceId,
          },
        },
      },
    },
    null,
    2,
  )
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
    >
      {copied && <CheckIcon className="w-3 h-3 text-emerald-600" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export default function AiToolsPage() {
  const qc = useQueryClient()
  const { workspace } = useWorkspaceAccess()
  const [name, setName] = useState('')
  // Plaintext key lives only in component state: never persisted anywhere.
  const [created, setCreated] = useState<CreatedKey | null>(null)
  const [error, setError] = useState('')
  const [selectedWs, setSelectedWs] = useState('')

  const { data: keys = [], isLoading: keysLoading } = useQuery<ApiKeyRow[]>({
    queryKey: ['api-keys'],
    queryFn: () => api.get<ApiKeyRow[]>('/api-keys'),
  })
  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/projects'),
  })

  // Workspace ids: from accessible projects (works for members) plus own workspace.
  const workspaces = useMemo(() => {
    const ids = new Set<string>()
    if (workspace?.id) ids.add(workspace.id)
    for (const p of projects) if (p.workspace_id) ids.add(p.workspace_id)
    return [...ids].map((id) => ({
      id,
      name: workspace?.id === id ? workspace.name : null,
    }))
  }, [projects, workspace])
  const workspaceId = workspaces.find((w) => w.id === selectedWs)?.id ?? workspaces[0]?.id ?? ''

  const createMut = useMutation({
    mutationFn: (n: string) => api.post<CreatedKey>('/api-keys', { name: n }),
    onSuccess: (res) => {
      setCreated(res)
      setName('')
      setError('')
      qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const revokeMut = useMutation({
    mutationFn: (id: string) => api.post<unknown>(`/api-keys/${id}/revoke`, {}),
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  function revoke(k: ApiKeyRow) {
    if (window.confirm(`Revoke "${k.name}"? Tools using this key will stop working immediately.`)) {
      revokeMut.mutate(k.id)
    }
  }

  const snippetKey = created ? created.key : 'bp_live_...'
  const snippet = workspaceId ? buildSnippet(snippetKey, workspaceId) : ''

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Connect your AI tool</h1>
        <p className="text-sm text-gray-500 mt-1">
          Create an API key and add the MCP config below to your AI coding tool (Claude Code, Cursor, etc.)
          so it can read and update BugPilot issues.
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Create */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">1. Create an API key</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) createMut.mutate(name.trim())
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name, e.g. My laptop"
            maxLength={60}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!name.trim() || createMut.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <PlusIcon className="w-4 h-4" />
            {createMut.isPending ? 'Creating…' : 'Create key'}
          </button>
        </form>

        {created && (
          <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 space-y-2">
            <div className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Copy this key now. It is shown only once and cannot be shown again after you dismiss this or
                reload the page.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate px-3 py-2 text-xs bg-white border border-amber-200 rounded-md font-mono">
                {created.key}
              </code>
              <CopyButton text={created.key} />
            </div>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="text-xs font-medium text-amber-900 underline"
            >
              I have saved it, dismiss
            </button>
          </div>
        )}
      </section>

      {/* Keys list */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <h2 className="text-sm font-semibold text-gray-900 px-5 py-3 border-b border-gray-100">Your API keys</h2>
        {keysLoading ? (
          <p className="px-5 py-4 text-sm text-gray-500">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500">No keys yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 text-left">
              <tr>
                <th className="px-5 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Key</th>
                <th className="px-2 py-2 font-medium">Last used</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="px-5 py-2.5 font-medium text-gray-900">{k.name}</td>
                  <td className="px-2 py-2.5 font-mono text-xs text-gray-600">{k.keyPrefix}…</td>
                  <td className="px-2 py-2.5 text-gray-600">{fmt(k.lastUsedAt)}</td>
                  <td className="px-2 py-2.5">
                    {k.revokedAt ? (
                      <span className="text-xs font-medium text-gray-500">Revoked</span>
                    ) : (
                      <span className="text-xs font-medium text-emerald-600">Active</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {!k.revokedAt && (
                      <button
                        type="button"
                        onClick={() => revoke(k)}
                        disabled={revokeMut.isPending}
                        className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Snippet */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">2. Add this to your tool&apos;s mcp.json</h2>
        {projectsLoading ? (
          <p className="text-sm text-gray-500">Loading workspace…</p>
        ) : !workspaceId ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            We could not find a workspace for your account. Ask a workspace owner to add you to a project,
            then reload this page.
          </p>
        ) : (
          <>
            {workspaces.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                Workspace
                <select
                  value={workspaceId}
                  onChange={(e) => setSelectedWs(e.target.value)}
                  className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name ?? w.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {workspaces.length === 1 && (
              <p className="text-xs text-gray-500">
                Workspace: {workspaces[0].name ?? workspaces[0].id}
              </p>
            )}
            <div className="relative">
              <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto">{snippet}</pre>
              <div className="absolute top-2 right-2">
                <CopyButton text={snippet} />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Replace <code>&lt;ABSOLUTE_PATH_TO_REPO&gt;</code> with the path to your BugPilot checkout.
              {!created && ' Use the key you created above in place of bp_live_...'}
            </p>
          </>
        )}
      </section>
    </div>
  )
}
