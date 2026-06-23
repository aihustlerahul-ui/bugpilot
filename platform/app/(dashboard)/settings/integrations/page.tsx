'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { AzureSetupForm } from '@/components/AzureSetupForm'

export default function IntegrationsPage() {
  const { data: integration } = useQuery({
    queryKey: ['integration', 'azure'],
    queryFn: () => api.get<{ config: Record<string, string> } | null>('/integrations/azure').catch(() => null),
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Integrations</h1>
      <AzureSetupForm existing={integration?.config} />
    </div>
  )
}
