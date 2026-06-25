'use client'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { ConnectorConfig } from '@/app/(dashboard)/connectors/page'

interface AzureFieldMeta { field: string; label: string; required?: boolean }
interface QASourceMeta { key: string; label: string }
interface FieldsResponse { azureFields: AzureFieldMeta[]; qaSourceFields: QASourceMeta[] }

const DEFAULT_MAPPING: Record<string, string> = {
  'System.Title': 'description',
  'Microsoft.VSTS.TCM.ReproSteps': 'repro_steps',
  'System.Description': 'system_info',
}

interface Props {
  connector: ConnectorConfig
  isConnected: boolean
  isInvalid?: boolean
  existingConfig?: Record<string, string>
  onClose: () => void
}

export function ConnectorPanel({ connector, isConnected, isInvalid, existingConfig, onClose }: Props) {
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const [mapping, setMapping] = useState<Record<string, string>>(DEFAULT_MAPPING)
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  const { data: fieldsMeta } = useQuery<FieldsResponse>({
    queryKey: ['integration', 'azure', 'fields'],
    queryFn: () => api.get<FieldsResponse>('/integrations/azure/fields'),
    enabled: connector.id === 'azure' && connector.available,
  })

  useEffect(() => {
    if (existingConfig) {
      setValues({
        ...Object.fromEntries(connector.fields.map(f => [f.key, ''])),
        orgUrl: existingConfig.org_url ?? '',
        projectName: existingConfig.project_name ?? '',
      })
      if (existingConfig.field_mapping) setMapping(existingConfig.field_mapping as unknown as Record<string, string>)
    } else {
      setValues(Object.fromEntries(connector.fields.map(f => [f.key, ''])))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector.id, existingConfig])

  async function handleSave() {
    if (!connector.available) return
    setStatus('saving')
    setError('')
    try {
      if (connector.id === 'azure') {
        const payload: Record<string, string> = {
          orgUrl: values.orgUrl || values.org_url || '',
          projectName: values.projectName || values.project_name || '',
        }
        if (values.pat?.trim()) payload.pat = values.pat.trim()
        if (!isConnected && !payload.pat) { setStatus('error'); setError('PAT is required'); return }
        await api.post('/integrations/azure', { ...payload, fieldMapping: mapping })
        qc.invalidateQueries({ queryKey: ['integration', 'azure'] })
      }
      setStatus('success')
      setTimeout(onClose, 1200)
    } catch (err: unknown) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{connector.logo}</span>
            <div>
              <h2 className="font-semibold text-gray-900">{connector.name}</h2>
              {isConnected && (
                <span className="flex items-center gap-1.5 text-xs text-green-700 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Connected
                </span>
              )}
              {isInvalid && (
                <span className="flex items-center gap-1.5 text-xs text-red-600 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                  Token invalid — please reconnect
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!connector.available ? (
            <div className="flex flex-col items-center justify-center h-full px-8 text-center">
              <div className="text-5xl mb-4">{connector.logo}</div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">{connector.name} — Coming Soon</h3>
              <p className="text-gray-500 text-sm leading-relaxed">We&apos;re working on this integration. In the meantime, here&apos;s how it will work when ready.</p>
              <div className="mt-8 w-full text-left space-y-4">
                {connector.steps.map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-700">{step.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-6 py-6 space-y-8">
              {/* Steps */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">How to get your credentials</h3>
                <div className="space-y-4">
                  {connector.steps.map((step, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-600 text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{step.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100" />

              {/* Credentials form */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  {isConnected ? 'Update credentials' : 'Enter your credentials'}
                </h3>
                <div className="space-y-4">
                  {connector.fields.map(field => (
                    <div key={field.key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                      <input
                        type={field.type}
                        value={values[field.key] ?? ''}
                        onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                        placeholder={field.type === 'password' && isConnected ? '••••••• (leave blank to keep current)' : field.placeholder}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Field mapping */}
              {fieldsMeta && (
                <>
                  <div className="border-t border-gray-100" />
                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Field mapping</h3>
                    <p className="text-xs text-gray-400 mb-4">Choose which QA Reporter data populates each Azure Bug field.</p>
                    <div className="space-y-3">
                      {fieldsMeta.azureFields.map(af => (
                        <div key={af.field} className="flex items-center gap-3">
                          <div className="w-44 flex-shrink-0">
                            <span className="text-sm font-medium text-gray-700">{af.label}</span>
                            {af.required && <span className="text-red-400 ml-1 text-xs">*</span>}
                          </div>
                          <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <select
                            value={mapping[af.field] ?? ''}
                            onChange={e => setMapping(m => ({ ...m, [af.field]: e.target.value }))}
                            disabled={af.required}
                            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                          >
                            <option value="">— not mapped —</option>
                            {fieldsMeta.qaSourceFields.map(qf => (
                              <option key={qf.key} value={qf.key}>{qf.label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {connector.available && (
          <div className="border-t border-gray-100 px-6 py-4">
            {status === 'success' && (
              <p className="text-green-600 text-sm mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {isConnected ? 'Updated successfully' : 'Connected successfully!'}
              </p>
            )}
            {status === 'error' && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <button
              onClick={handleSave}
              disabled={status === 'saving'}
              className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {status === 'saving' ? 'Testing connection...' : isConnected ? 'Update connection' : 'Test & Connect'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
