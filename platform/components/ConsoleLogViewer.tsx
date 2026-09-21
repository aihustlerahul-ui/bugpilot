'use client'
import { useState, useMemo, useRef, useEffect } from 'react'

interface ConsoleEntry {
  level: string
  message: string
  timestamp?: string
}

export function ConsoleLogViewer({
  logs,
  currentTimeMs,
  activeTimestamp,
  onRowClick,
}: {
  logs: ConsoleEntry[]
  currentTimeMs?: number
  activeTimestamp?: number
  onRowClick?: (timestamp: number) => void
}) {
  const [search, setSearch] = useState('')
  const [filterLevel, setFilterLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const isUserScrollingRef = useRef(false)
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isProgrammaticScrollRef = useRef(false)

  const counts = useMemo(() => {
    let error = 0, warn = 0, info = 0
    logs.forEach(l => {
      const lvl = l.level.toLowerCase()
      if (lvl === 'error') error++
      else if (lvl === 'warn' || lvl === 'warning') warn++
      else info++
    })
    return { all: logs.length, error, warn, info }
  }, [logs])

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const lvl = log.level.toLowerCase()
      if (filterLevel !== 'all') {
        if (filterLevel === 'error' && lvl !== 'error') return false
        if (filterLevel === 'warn' && lvl !== 'warn' && lvl !== 'warning') return false
        if (filterLevel === 'info' && (lvl === 'error' || lvl === 'warn' || lvl === 'warning')) return false
      }
      if (search.trim()) {
        const query = search.toLowerCase()
        return log.message.toLowerCase().includes(query) || (log.timestamp && log.timestamp.toLowerCase().includes(query))
      }
      return true
    })
  }, [logs, filterLevel, search])

  const activeIdx = useMemo(() => {
    if (activeTimestamp === undefined || Number.isNaN(activeTimestamp)) return -1
    let bestIdx = -1
    let minDiff = Infinity

    for (let i = 0; i < filteredLogs.length; i++) {
      const ts = filteredLogs[i].timestamp ? Date.parse(filteredLogs[i].timestamp!) : NaN
      if (Number.isNaN(ts)) continue
      const diff = Math.abs(ts - activeTimestamp)
      if (diff < 3000 && diff < minDiff) {
        minDiff = diff
        bestIdx = i
      }
    }

    if (bestIdx === -1) {
      let latestPriorTs = -Infinity
      for (let i = 0; i < filteredLogs.length; i++) {
        const ts = filteredLogs[i].timestamp ? Date.parse(filteredLogs[i].timestamp!) : NaN
        if (Number.isNaN(ts)) continue
        if (ts <= activeTimestamp && activeTimestamp - ts <= 8000 && ts > latestPriorTs) {
          latestPriorTs = ts
          bestIdx = i
        }
      }
    }

    return bestIdx
  }, [filteredLogs, activeTimestamp])

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

  const copySingle = (msg: string, idx: number) => {
    navigator.clipboard.writeText(msg)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  const copyAll = () => {
    const text = filteredLogs.map(l => `[${l.level.toUpperCase()}] ${l.timestamp ? l.timestamp + ' - ' : ''}${l.message}`).join('\n')
    navigator.clipboard.writeText(text)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  return (
    <div className="flex flex-col">
      {/* Controls bar */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2.5 bg-gray-50/50">
        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1 w-full sm:w-64">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text"
            placeholder="Search console logs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-xs bg-transparent border-none outline-none w-full text-gray-700 placeholder:text-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 text-xs px-1">✕</button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {currentTimeMs !== undefined && (
            <span className="text-[10px] font-mono font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
              🕒 {(currentTimeMs / 1000).toFixed(1)}s
            </span>
          )}
          <div className="flex bg-gray-200/70 p-0.5 rounded-lg text-xs font-medium">
            <button
              onClick={() => setFilterLevel('all')}
              className={`px-2 py-1 rounded-md transition-colors ${filterLevel === 'all' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              All ({counts.all})
            </button>
            <button
              onClick={() => setFilterLevel('error')}
              className={`px-2 py-1 rounded-md transition-colors ${filterLevel === 'error' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-red-600'}`}
            >
              Errors ({counts.error})
            </button>
            <button
              onClick={() => setFilterLevel('warn')}
              className={`px-2 py-1 rounded-md transition-colors ${filterLevel === 'warn' ? 'bg-white text-amber-600 shadow-sm' : 'text-gray-500 hover:text-amber-600'}`}
            >
              Warnings ({counts.warn})
            </button>
            {counts.info > 0 && (
              <button
                onClick={() => setFilterLevel('info')}
                className={`px-2 py-1 rounded-md transition-colors ${filterLevel === 'info' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-blue-600'}`}
              >
                Info ({counts.info})
              </button>
            )}
          </div>

          <button
            onClick={copyAll}
            disabled={filteredLogs.length === 0}
            className="text-xs border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 px-2.5 py-1 rounded-lg font-medium transition-colors disabled:opacity-40"
          >
            {copiedAll ? '✓ Copied all' : 'Copy logs'}
          </button>
        </div>
      </div>

      {/* Logs stream */}
      <div
        ref={containerRef}
        onScroll={handleContainerScroll}
        className="divide-y divide-gray-50 max-h-72 overflow-y-auto font-mono text-xs"
      >
        {filteredLogs.length === 0 ? (
          <div className="px-5 py-6 text-center text-gray-400">
            No console logs matching filter.
          </div>
        ) : (
          filteredLogs.map((log, i) => {
            const isError = log.level.toLowerCase() === 'error'
            const isWarn = log.level.toLowerCase() === 'warn' || log.level.toLowerCase() === 'warning'
            const isActive = activeIdx === i
            const logEpochMs = log.timestamp ? Date.parse(log.timestamp) : NaN

            return (
              <div
                key={i}
                ref={(el) => {
                  if (el) rowRefs.current.set(i, el)
                  else rowRefs.current.delete(i)
                }}
                onClick={() => {
                  if (!Number.isNaN(logEpochMs) && onRowClick) {
                    onRowClick(logEpochMs)
                  }
                }}
                className={`px-5 py-2 flex items-start gap-3 group transition-colors ${
                  onRowClick ? 'cursor-pointer' : ''
                } ${
                  isActive
                    ? 'bg-indigo-50/80 border-l-2 border-indigo-600 dark:bg-indigo-950/50 dark:border-indigo-400'
                    : 'border-l-2 border-transparent hover:bg-gray-50/80'
                }`}
              >
                <span
                  className={`flex-shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded mt-0.5 ${
                    isError ? 'bg-red-100 text-red-700' : isWarn ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {log.level}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-gray-700 break-all whitespace-pre-wrap leading-relaxed">{log.message}</p>
                  {log.timestamp && (
                    <span className="text-[10px] text-gray-400 block mt-0.5">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    copySingle(log.message, i)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-[10px] bg-white border border-gray-200 hover:border-gray-300 text-gray-500 px-1.5 py-0.5 rounded transition-all flex-shrink-0"
                >
                  {copiedIdx === i ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
