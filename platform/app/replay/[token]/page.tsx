'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ReplayPlayer } from '@/components/ReplayPlayer'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

const SEVERITY_CONFIG: Record<string, string> = {
  Critical: 'bg-red-100 text-red-700',
  High:     'bg-orange-100 text-orange-700',
  Medium:   'bg-yellow-100 text-yellow-700',
  Low:      'bg-gray-100 text-gray-600',
}

interface ReplayData {
  issue: { title: string; severity: string }
  replayUrl: string
  expiresAt: string
}

export default function PublicReplayPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ReplayData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/replay/${token}`)
      .then(res => {
        if (res.status === 401) throw new Error('This replay link has expired.')
        if (res.status === 404) throw new Error('Replay not found.')
        if (!res.ok) throw new Error('Failed to load replay.')
        return res.json()
      })
      .then(setData)
      .catch(err => setError(err.message))
  }, [token])

  const daysLeft = data
    ? Math.max(0, Math.ceil((new Date(data.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-sm font-semibold text-indigo-600 tracking-wide">QA Reporter</span>
          <span className="text-gray-300">·</span>
          <span className="text-sm text-gray-400">Session Replay</span>
        </div>

        {error && (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-400 text-xl">⚠</div>
            <p className="text-gray-700 font-medium">{error}</p>
            <p className="text-sm text-gray-400">Ask the issue owner to generate a new replay link.</p>
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-6">
            {/* Issue info */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-base font-semibold text-gray-900">{data.issue.title}</h1>
                {daysLeft !== null && (
                  <p className="text-xs text-gray-400 mt-1">
                    This link expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${SEVERITY_CONFIG[data.issue.severity] ?? SEVERITY_CONFIG['Low']}`}>
                {data.issue.severity}
              </span>
            </div>

            {/* Player */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <ReplayPlayer replayUrl={data.replayUrl} />
            </div>
          </div>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center h-64 text-sm text-gray-400">
            Loading replay…
          </div>
        )}
      </div>
    </div>
  )
}
