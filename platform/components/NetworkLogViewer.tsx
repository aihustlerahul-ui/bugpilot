'use client'
import { useState, useMemo, useRef, useEffect } from 'react'

export interface NetworkEntry {
  id?: string
  method: string
  url: string
  status: number | string
  statusText?: string
  duration: number
  timestamp?: string
  requestHeaders?: Record<string, string>
  requestBody?: string | null
  responseHeaders?: Record<string, string>
  responseBody?: string | null
  error?: string | null
  initiator?: string
}

export function NetworkLogViewer({
  requests: rawRequests,
  transactions,
  currentTimeMs,
  activeTimestamp,
  onRowClick,
}: {
  requests?: NetworkEntry[]
  transactions?: NetworkEntry[]
  currentTimeMs?: number
  activeTimestamp?: number
  onRowClick?: (timestamp: number) => void
}) {
  const requests = useMemo(() => rawRequests || transactions || [], [rawRequests, transactions])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'failed'>('all')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'response' | 'request' | 'headers' | 'curl'>('response')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const isUserScrollingRef = useRef(false)
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isProgrammaticScrollRef = useRef(false)

  const counts = useMemo(() => {
    let s2xx = 0, s3xx = 0, s4xx = 0, s5xx = 0, failed = 0
    requests.forEach(r => {
      const st = String(r.status)
      if (st.startsWith('2')) s2xx++
      else if (st.startsWith('3')) s3xx++
      else if (st.startsWith('4')) s4xx++
      else if (st.startsWith('5')) s5xx++
      else failed++
    })
    return { all: requests.length, s2xx, s3xx, s4xx, s5xx, failed }
  }, [requests])

  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      const st = String(req.status)
      if (statusFilter === '2xx' && !st.startsWith('2')) return false
      if (statusFilter === '3xx' && !st.startsWith('3')) return false
      if (statusFilter === '4xx' && !st.startsWith('4')) return false
      if (statusFilter === '5xx' && !st.startsWith('5')) return false
      if (statusFilter === 'failed' && (st.startsWith('2') || st.startsWith('3') || st.startsWith('4') || st.startsWith('5'))) return false

      if (search.trim()) {
        const q = search.toLowerCase()
        const matchUrl = (req.url || '').toLowerCase().includes(q)
        const matchMethod = (req.method || '').toLowerCase().includes(q)
        const matchStatus = st.includes(q)
        const matchError = (req.error || '').toLowerCase().includes(q)
        const matchReqBody = typeof req.requestBody === 'string' && req.requestBody.toLowerCase().includes(q)
        const matchResBody = typeof req.responseBody === 'string' && req.responseBody.toLowerCase().includes(q)
        const matchReqHeaders = req.requestHeaders && Object.entries(req.requestHeaders).some(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q))
        const matchResHeaders = req.responseHeaders && Object.entries(req.responseHeaders).some(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q))
        return matchUrl || matchMethod || matchStatus || matchError || matchReqBody || matchResBody || Boolean(matchReqHeaders) || Boolean(matchResHeaders)
      }
      return true
    })
  }, [requests, statusFilter, search])

  const activeIdx = useMemo(() => {
    if (activeTimestamp === undefined || Number.isNaN(activeTimestamp)) return -1
    let bestIdx = -1

    // First: check in-flight window
    for (let i = 0; i < filteredRequests.length; i++) {
      const req = filteredRequests[i]
      const start = req.timestamp ? Date.parse(req.timestamp) : NaN
      if (Number.isNaN(start)) continue
      const dur = typeof req.duration === 'number' && req.duration > 0 ? req.duration : 1000
      if (activeTimestamp >= start && activeTimestamp <= start + dur) {
        bestIdx = i
      }
    }
    if (bestIdx !== -1) return bestIdx

    // Second: proximity match within 2500ms
    let minDiff = Infinity
    for (let i = 0; i < filteredRequests.length; i++) {
      const req = filteredRequests[i]
      const start = req.timestamp ? Date.parse(req.timestamp) : NaN
      if (Number.isNaN(start)) continue
      const diff = Math.abs(start - activeTimestamp)
      if (diff < 2500 && diff < minDiff) {
        minDiff = diff
        bestIdx = i
      }
    }
    if (bestIdx !== -1) return bestIdx

    // Third: recent prior request within 6000ms
    let latestStart = -Infinity
    for (let i = 0; i < filteredRequests.length; i++) {
      const req = filteredRequests[i]
      const start = req.timestamp ? Date.parse(req.timestamp) : NaN
      if (Number.isNaN(start)) continue
      const dur = typeof req.duration === 'number' ? req.duration : 0
      if (start <= activeTimestamp && activeTimestamp - start <= 6000 + dur && start > latestStart) {
        latestStart = start
        bestIdx = i
      }
    }
    return bestIdx
  }, [filteredRequests, activeTimestamp])

  const handleContainerScroll = () => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false
      return
    }
    isUserScrollingRef.current = true
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current)
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false
    }, 2500)
  }

  useEffect(() => {
    if (activeIdx < 0 || isUserScrollingRef.current) return
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      if (isUserScrollingRef.current) return
      const rowEl = rowRefs.current.get(activeIdx)
      const container = containerRef.current
      if (rowEl && container) {
        isProgrammaticScrollRef.current = true
        const rowTop = rowEl.offsetTop
        const rowHeight = rowEl.offsetHeight
        const containerScrollTop = container.scrollTop
        const containerHeight = container.clientHeight

        if (rowTop < containerScrollTop || rowTop + rowHeight > containerScrollTop + containerHeight) {
          container.scrollTo({
            top: Math.max(0, rowTop - containerHeight / 2 + rowHeight / 2),
            behavior: 'smooth',
          })
        }
      }
    }, 120)

    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    }
  }, [activeIdx])

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const selectedReq = selectedIdx !== null && selectedIdx >= 0 && selectedIdx < filteredRequests.length
    ? filteredRequests[selectedIdx]
    : null

  const formatPayload = (payload?: string | null): string => {
    if (!payload) return ''
    try {
      const parsed = JSON.parse(payload)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return payload
    }
  }

  const generateCurl = (req: NetworkEntry): string => {
    let curl = `curl -X ${req.method.toUpperCase()} '${req.url}'`
    if (req.requestHeaders) {
      for (const [k, v] of Object.entries(req.requestHeaders)) {
        curl += ` \\\n  -H '${k}: ${v}'`
      }
    }
    if (req.requestBody) {
      const escapedBody = req.requestBody.replace(/'/g, `'\\''`)
      curl += ` \\\n  --data '${escapedBody}'`
    }
    return curl
  }

  const getMethodBadgeClass = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'bg-blue-50 text-blue-700 border-blue-200'
      case 'POST':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200'
      case 'PUT':
      case 'PATCH':
        return 'bg-amber-50 text-amber-700 border-amber-200'
      case 'DELETE':
        return 'bg-rose-50 text-rose-700 border-rose-200'
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200'
    }
  }

  const getStatusBadgeClass = (status: number | string) => {
    const st = String(status)
    if (st.startsWith('2')) return 'bg-emerald-100 text-emerald-800'
    if (st.startsWith('3')) return 'bg-blue-100 text-blue-800'
    if (st.startsWith('4')) return 'bg-orange-100 text-orange-800'
    if (st.startsWith('5')) return 'bg-red-100 text-red-800'
    return 'bg-purple-100 text-purple-800'
  }

  return (
    <div className="flex flex-col text-xs font-sans">
      {/* Controls Header */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2.5 bg-gray-50/50">
        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1 w-full sm:w-72">
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search URL, method, status, body…"
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              setSelectedIdx(null)
            }}
            className="text-xs bg-transparent border-none outline-none w-full text-gray-700 placeholder:text-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 text-xs px-1">✕</button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {currentTimeMs !== undefined && (
            <span className="text-[10px] font-mono font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
              🕒 {(currentTimeMs / 1000).toFixed(1)}s
            </span>
          )}
          <div className="flex flex-wrap bg-gray-200/70 p-0.5 rounded-lg text-xs font-medium">
            <button
              onClick={() => { setStatusFilter('all'); setSelectedIdx(null); }}
              className={`px-2 py-1 rounded-md transition-colors ${statusFilter === 'all' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              All ({counts.all})
            </button>
            {counts.s2xx > 0 && (
              <button
                onClick={() => { setStatusFilter('2xx'); setSelectedIdx(null); }}
                className={`px-2 py-1 rounded-md transition-colors ${statusFilter === '2xx' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-emerald-700'}`}
              >
                2xx ({counts.s2xx})
              </button>
            )}
            {counts.s3xx > 0 && (
              <button
                onClick={() => { setStatusFilter('3xx'); setSelectedIdx(null); }}
                className={`px-2 py-1 rounded-md transition-colors ${statusFilter === '3xx' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-blue-700'}`}
              >
                3xx ({counts.s3xx})
              </button>
            )}
            <button
              onClick={() => { setStatusFilter('4xx'); setSelectedIdx(null); }}
              className={`px-2 py-1 rounded-md transition-colors ${statusFilter === '4xx' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-orange-600'}`}
            >
              4xx ({counts.s4xx})
            </button>
            <button
              onClick={() => { setStatusFilter('5xx'); setSelectedIdx(null); }}
              className={`px-2 py-1 rounded-md transition-colors ${statusFilter === '5xx' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-red-600'}`}
            >
              5xx ({counts.s5xx})
            </button>
            {counts.failed > 0 && (
              <button
                onClick={() => { setStatusFilter('failed'); setSelectedIdx(null); }}
                className={`px-2 py-1 rounded-md transition-colors ${statusFilter === 'failed' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-purple-600'}`}
              >
                Failed ({counts.failed})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
        {/* Request List */}
        <div
          ref={containerRef}
          onScroll={handleContainerScroll}
          className={`divide-y divide-gray-50 overflow-y-auto max-h-96 font-mono text-xs ${selectedReq ? 'lg:col-span-5' : 'lg:col-span-12'}`}
        >
          {filteredRequests.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 font-sans">
              No network requests matching filter.
            </div>
          ) : (
            filteredRequests.map((req, i) => {
              const isSelected = selectedIdx === i
              const isActive = activeIdx === i
              const reqEpochMs = req.timestamp ? Date.parse(req.timestamp) : NaN
              const hasPayload = Boolean(req.requestBody || req.responseBody || req.requestHeaders || req.responseHeaders)

              let rowClass = 'border-l-2 border-transparent hover:bg-gray-50/80'
              if (isSelected && isActive) {
                rowClass = 'bg-indigo-100/90 dark:bg-indigo-900/60 border-l-2 border-indigo-700 dark:border-indigo-300 ring-1 ring-indigo-400 font-medium'
              } else if (isSelected) {
                rowClass = 'bg-indigo-50/70 dark:bg-indigo-950/40 border-l-2 border-indigo-600 dark:border-indigo-400 font-medium'
              } else if (isActive) {
                rowClass = 'bg-indigo-50/80 border-l-2 border-indigo-600 dark:bg-indigo-950/50 dark:border-indigo-400'
              }

              return (
                <div
                  key={i}
                  ref={(el) => {
                    if (el) rowRefs.current.set(i, el)
                    else rowRefs.current.delete(i)
                  }}
                  onClick={() => {
                    setSelectedIdx(isSelected ? null : i)
                    if (!Number.isNaN(reqEpochMs) && onRowClick) {
                      onRowClick(reqEpochMs)
                    }
                  }}
                  className={`px-4 py-2.5 flex items-center justify-between gap-2.5 cursor-pointer transition-colors ${rowClass}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${getStatusBadgeClass(req.status)}`}>
                      {req.status}
                    </span>

                    <span className={`shrink-0 text-[10px] font-bold border px-1.5 py-0.5 rounded ${getMethodBadgeClass(req.method)}`}>
                      {req.method}
                    </span>

                    <span className="text-gray-700 truncate flex-1 text-xs" title={req.url}>
                      {req.url}
                    </span>

                    {hasPayload && (
                      <span className="shrink-0 text-[9px] px-1 py-0.2 text-gray-400 bg-gray-100 rounded font-sans" title="Includes payload / headers">
                        payload
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-gray-400 font-sans">{req.duration}ms</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        copyToClipboard(req.url, `url_${i}`)
                      }}
                      className="text-[10px] bg-white border border-gray-200 hover:border-gray-300 text-gray-500 px-1.5 py-0.5 rounded transition-all"
                    >
                      {copiedKey === `url_${i}` ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Selected Request Detail Panel */}
        {selectedReq && (
          <div className="lg:col-span-7 flex flex-col bg-white overflow-hidden max-h-96">
            {/* Detail Tabs Bar */}
            <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/70 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('response')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeTab === 'response' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  Response Body
                </button>
                <button
                  onClick={() => setActiveTab('request')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeTab === 'request' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  Request Body
                </button>
                <button
                  onClick={() => setActiveTab('headers')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeTab === 'headers' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  Headers
                </button>
                <button
                  onClick={() => setActiveTab('curl')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeTab === 'curl' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  cURL
                </button>
              </div>

              <button
                onClick={() => setSelectedIdx(null)}
                className="text-gray-400 hover:text-gray-600 text-xs px-1.5 py-0.5 rounded hover:bg-gray-200/50"
                title="Close Inspector"
              >
                ✕
              </button>
            </div>

            {/* Detail Body */}
            <div className="p-4 overflow-y-auto flex-1 font-mono text-xs space-y-4">
              {/* General Summary */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-[11px] font-sans border border-gray-100">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getStatusBadgeClass(selectedReq.status)}`}>
                      {selectedReq.status} {selectedReq.statusText || ''}
                    </span>
                    <span className={`text-[10px] font-bold border px-1.5 py-0.5 rounded ${getMethodBadgeClass(selectedReq.method)}`}>
                      {selectedReq.method}
                    </span>
                    <span className="text-gray-500">{selectedReq.duration}ms</span>
                    {selectedReq.initiator && (
                      <span className="text-gray-400">({selectedReq.initiator})</span>
                    )}
                  </div>
                  {selectedReq.timestamp && (
                    <span className="text-gray-400">{new Date(selectedReq.timestamp).toLocaleTimeString()}</span>
                  )}
                </div>
                <div className="font-mono text-xs text-gray-700 break-all select-all pt-1">
                  {selectedReq.url}
                </div>
                {selectedReq.error && (
                  <div className="text-red-600 font-mono text-xs bg-red-50 p-2 rounded border border-red-100 mt-2">
                    <strong>Error:</strong> {selectedReq.error}
                  </div>
                )}
              </div>

              {/* Tab: Response */}
              {activeTab === 'response' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-700 font-sans text-xs">Response Payload</span>
                    {selectedReq.responseBody && (
                      <button
                        onClick={() => copyToClipboard(selectedReq.responseBody || '', 'res_body')}
                        className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-sans transition-colors"
                      >
                        {copiedKey === 'res_body' ? '✓ Copied' : 'Copy Response'}
                      </button>
                    )}
                  </div>
                  {selectedReq.responseBody ? (
                    <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto text-[11px] leading-relaxed max-h-56">
                      {formatPayload(selectedReq.responseBody)}
                    </pre>
                  ) : (
                    <div className="text-gray-400 italic py-6 text-center bg-gray-50 rounded-lg border border-dashed border-gray-200 font-sans">
                      No response body captured for this request.
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Request */}
              {activeTab === 'request' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-700 font-sans text-xs">Request Payload</span>
                    {selectedReq.requestBody && (
                      <button
                        onClick={() => copyToClipboard(selectedReq.requestBody || '', 'req_body')}
                        className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-sans transition-colors"
                      >
                        {copiedKey === 'req_body' ? '✓ Copied' : 'Copy Request'}
                      </button>
                    )}
                  </div>
                  {selectedReq.requestBody ? (
                    <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto text-[11px] leading-relaxed max-h-56">
                      {formatPayload(selectedReq.requestBody)}
                    </pre>
                  ) : (
                    <div className="text-gray-400 italic py-6 text-center bg-gray-50 rounded-lg border border-dashed border-gray-200 font-sans">
                      No request payload sent (e.g. GET request or empty body).
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Headers */}
              {activeTab === 'headers' && (
                <div className="space-y-4">
                  {/* Request Headers */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-gray-700 font-sans text-xs">Request Headers</span>
                      {selectedReq.requestHeaders && Object.keys(selectedReq.requestHeaders).length > 0 && (
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(selectedReq.requestHeaders, null, 2), 'req_headers')}
                          className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-sans"
                        >
                          {copiedKey === 'req_headers' ? '✓ Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                    {selectedReq.requestHeaders && Object.keys(selectedReq.requestHeaders).length > 0 ? (
                      <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100 space-y-1">
                        {Object.entries(selectedReq.requestHeaders).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="text-indigo-600 font-semibold shrink-0 select-all">{k}:</span>
                            <span className="text-gray-700 break-all select-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-gray-400 italic text-[11px] font-sans">No request headers recorded.</div>
                    )}
                  </div>

                  {/* Response Headers */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-gray-700 font-sans text-xs">Response Headers</span>
                      {selectedReq.responseHeaders && Object.keys(selectedReq.responseHeaders).length > 0 && (
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(selectedReq.responseHeaders, null, 2), 'res_headers')}
                          className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-sans"
                        >
                          {copiedKey === 'res_headers' ? '✓ Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                    {selectedReq.responseHeaders && Object.keys(selectedReq.responseHeaders).length > 0 ? (
                      <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100 space-y-1">
                        {Object.entries(selectedReq.responseHeaders).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="text-emerald-600 font-semibold shrink-0 select-all">{k}:</span>
                            <span className="text-gray-700 break-all select-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-gray-400 italic text-[11px] font-sans">No response headers recorded.</div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab: cURL */}
              {activeTab === 'curl' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-700 font-sans text-xs">cURL Command</span>
                    <button
                      onClick={() => copyToClipboard(generateCurl(selectedReq), 'curl')}
                      className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-sans transition-colors"
                    >
                      {copiedKey === 'curl' ? '✓ Copied' : 'Copy cURL'}
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto text-[11px] leading-relaxed max-h-56 select-all">
                    {generateCurl(selectedReq)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
