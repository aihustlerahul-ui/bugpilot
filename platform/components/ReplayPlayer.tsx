'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  replayUrl: string
  issueTitle?: string
}

export function ReplayPlayer({ replayUrl, issueTitle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const replayerRef = useRef<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [currentMs, setCurrentMs] = useState(0)
  const [totalMs, setTotalMs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        // Fetch the gzip blob
        const res = await fetch(replayUrl)
        if (!res.ok) throw new Error('Failed to fetch replay')
        const blob = await res.blob()

        // Decompress using browser-native DecompressionStream
        const ds = new DecompressionStream('gzip')
        const decompressed = await new Response(
          blob.stream().pipeThrough(ds)
        ).text()
        const events = JSON.parse(decompressed)

        if (cancelled || !containerRef.current) return

        // Calculate total duration
        if (events.length >= 2) {
          setTotalMs(events[events.length - 1].timestamp - events[0].timestamp)
        }

        // Dynamically import rrweb Replayer (client-side only, avoids SSR issues)
        const rrweb = await import('rrweb')
        if (cancelled) return

        const replayer = new (rrweb as any).Replayer(events, {
          root: containerRef.current,
          skipInactive: true,
          showWarning: false,
          speed: 1,
        })

        replayerRef.current = replayer
        setStatus('ready')
      } catch (err) {
        if (!cancelled) setStatus('error')
      }
    }

    load()
    return () => { cancelled = true }
  }, [replayUrl])

  function togglePlay() {
    if (!replayerRef.current) return
    if (playing) {
      replayerRef.current.pause()
      if (intervalRef.current) clearInterval(intervalRef.current)
      setPlaying(false)
    } else {
      replayerRef.current.play(currentMs)
      intervalRef.current = setInterval(() => {
        const meta = replayerRef.current?.getMetaData?.()
        if (meta) setCurrentMs(meta.currentTime ?? 0)
      }, 200)
      setPlaying(true)
    }
  }

  function handleSpeedChange(s: number) {
    setSpeed(s)
    replayerRef.current?.setConfig?.({ speed: s })
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const ms = Number(e.target.value)
    setCurrentMs(ms)
    replayerRef.current?.pause()
    replayerRef.current?.goto(ms)
    setPlaying(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  function formatTime(ms: number) {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${String(s % 60).padStart(2, '0')}`
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center h-48 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500">
        Could not load replay. The link may have expired.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {issueTitle && (
        <h2 className="text-sm font-medium text-gray-700 truncate">{issueTitle}</h2>
      )}

      {status === 'loading' && (
        <div className="flex items-center justify-center h-48 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-400">
          Loading replay…
        </div>
      )}

      {/* rrweb mounts its iframe here — hidden until ready */}
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50"
        style={{ minHeight: 300, display: status === 'ready' ? 'block' : 'none' }}
      />

      {status === 'ready' && (
        <div className="flex items-center gap-3 px-2">
          <button
            onClick={togglePlay}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 flex-shrink-0"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
                <rect x="0" y="0" width="3.5" height="12" rx="1"/>
                <rect x="6.5" y="0" width="3.5" height="12" rx="1"/>
              </svg>
            ) : (
              <svg width="10" height="12" viewBox="0 0 12 12" fill="currentColor">
                <polygon points="2,1 11,6 2,11"/>
              </svg>
            )}
          </button>

          <input
            type="range"
            min={0}
            max={totalMs}
            value={currentMs}
            onChange={handleScrub}
            className="flex-1 h-1 accent-indigo-600"
          />

          <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
            {formatTime(currentMs)} / {formatTime(totalMs)}
          </span>

          <select
            value={speed}
            onChange={e => handleSpeedChange(Number(e.target.value))}
            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white"
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
        </div>
      )}
    </div>
  )
}
