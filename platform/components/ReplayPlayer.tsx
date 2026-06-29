'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import 'rrweb/dist/style.css'

interface Props {
  replayUrl:  string
  issueTitle?: string
}

type PlayerStatus = 'loading' | 'ready' | 'error' | 'skipping'

const SPEEDS = [0.5, 1, 1.5, 2, 4]
const SCALE_RETRY_MAX = 12

// ─── icons ───────────────────────────────────────────────────────────────────
const IconPlay = () => (
  <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
    <polygon points="2,1 11,7 2,13"/>
  </svg>
)
const IconPause = () => (
  <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
    <rect x="0" y="0" width="4" height="14" rx="1.5"/>
    <rect x="8" y="0" width="4" height="14" rx="1.5"/>
  </svg>
)
const IconSkipBack = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <polygon points="7,1 1,7 7,13"/>
    <rect x="7" y="1" width="6" height="12" rx="1"/>
  </svg>
)
const IconSkipFwd = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <polygon points="7,1 13,7 7,13"/>
    <rect x="1" y="1" width="6" height="12" rx="1"/>
  </svg>
)
const IconRestart = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M2 7A5 5 0 1 1 4.5 3.5"/>
    <polyline points="1,1 4.5,3.5 1,6"/>
  </svg>
)
const IconFullscreen = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>
  </svg>
)
const IconExitFullscreen = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 1v4H1M9 1v4h4M9 13v-4h4M5 13v-4H1"/>
  </svg>
)

export function ReplayPlayer({ replayUrl, issueTitle }: Props) {
  const anchorRef      = useRef<HTMLDivElement>(null)
  const wrapperRef     = useRef<HTMLDivElement>(null)
  const viewportRef  = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const replayerRef  = useRef<any>(null)
  const rafRef       = useRef<number | null>(null)
  const totalMsRef   = useRef(0)
  const playingRef   = useRef(false)
  const currentMsRef = useRef(0)
  const isFullscreenRef = useRef(false)
  const placeholderHRef = useRef(240)

  const [status,       setStatus]       = useState<PlayerStatus>('loading')
  const [playing,      setPlaying]      = useState(false)
  const [speed,        setSpeed]        = useState(1)
  const [currentMs,    setCurrentMs]    = useState(0)
  const [totalMs,      setTotalMs]      = useState(0)
  const [skipMsg,      setSkipMsg]      = useState<string | null>(null)
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isScrubbing,  setIsScrubbing]  = useState(false)
  const [recorded,     setRecorded]     = useState({ w: 0, h: 0 })
  const [scale,        setScale]        = useState(1)
  const [offset,       setOffset]       = useState({ x: 0, y: 0 })

  playingRef.current = playing
  currentMsRef.current = currentMs
  isFullscreenRef.current = isFullscreen

  const setTime = useCallback((ms: number) => {
    const total = totalMsRef.current
    const clamped = Math.max(0, Math.min(total, ms))
    currentMsRef.current = clamped
    setCurrentMs(clamped)
  }, [])

  /** rrweb getCurrentTime() is invalid (negative) until baselineTime is set — read safely */
  const readPlaybackMs = useCallback((replayer: any): number | null => {
    if (!replayer?.service) return null
    const total = totalMsRef.current
    const ctx = replayer.service.state.context as {
      timeOffset: number
      baselineTime: number
      events: { timestamp: number }[]
    }
    const baseTs = ctx.events?.[0]?.timestamp ?? 0
    const inRange = (t: number) => typeof t === 'number' && !Number.isNaN(t) && t >= 0 && t <= total + 500

    const relativeFromCtx = () =>
      ctx.baselineTime > 0 ? ctx.baselineTime - baseTs : ctx.timeOffset

    if (replayer.service.state.matches('playing')) {
      const t = replayer.getCurrentTime()
      if (inRange(t)) return t
      const est = relativeFromCtx() + (replayer.timer?.timeOffset ?? 0)
      return inRange(est) ? est : null
    }

    const rel = relativeFromCtx()
    if (inRange(rel)) return rel
    const t = replayer.getCurrentTime()
    return inRange(t) ? t : null
  }, [])

  const syncCurrentTime = useCallback(() => {
    const t = readPlaybackMs(replayerRef.current)
    if (t != null) setTime(t)
  }, [readPlaybackMs, setTime])

  const stopTimeSync = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const startTimeSync = useCallback(() => {
    stopTimeSync()
    const tick = () => {
      syncCurrentTime()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopTimeSync, syncCurrentTime])

  const recomputeScale = useCallback(function scaleLoop(rw: number, rh: number, attempt = 0) {
    if (!containerRef.current || !rw || !rh) return

    const fs = isFullscreenRef.current

    if (fs) {
      const viewport = viewportRef.current
      if (!viewport) {
        if (attempt < SCALE_RETRY_MAX) requestAnimationFrame(() => scaleLoop(rw, rh, attempt + 1))
        return
      }
      const cw = viewport.clientWidth
      const ch = viewport.clientHeight
      // Never fall through to inline scaling while fullscreen — wait for layout
      if (!cw || ch === 0) {
        if (attempt < SCALE_RETRY_MAX) requestAnimationFrame(() => scaleLoop(rw, rh, attempt + 1))
        return
      }
      // object-fit: contain — fills width when viewport is narrower; letterboxes when wider
      const s = Math.min(cw / rw, ch / rh)
      const scaledW = rw * s
      const scaledH = rh * s
      containerRef.current.style.width  = '100%'
      containerRef.current.style.height = '100%'
      setScale(s)
      setOffset({ x: (cw - scaledW) / 2, y: (ch - scaledH) / 2 })
      return
    }

    const cw = containerRef.current.clientWidth || containerRef.current.offsetWidth
    if (!cw) return
    const s = Math.min(1, cw / rw)
    containerRef.current.style.width  = '100%'
    containerRef.current.style.height = `${Math.round(rh * s)}px`
    placeholderHRef.current = Math.round(rh * s)
    setScale(s)
    setOffset({ x: 0, y: 0 })
  }, [])

  // ── load replayer ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(replayUrl)
        if (!res.ok) throw new Error('fetch failed')
        const blob = await res.blob()
        const ds   = new DecompressionStream('gzip')
        const text = await new Response(blob.stream().pipeThrough(ds)).text()
        const events: any[] = JSON.parse(text)

        if (cancelled || !containerRef.current) return
        if (events.length < 2) { setErrorMsg('Replay too short.'); setStatus('error'); return }

        const duration = events[events.length - 1].timestamp - events[0].timestamp
        totalMsRef.current = duration
        setTotalMs(duration)

        const metaEvent = events.find((e: any) => e.type === 4)
        if (metaEvent?.data) {
          const rw = metaEvent.data.width  || 0
          const rh = metaEvent.data.height || 0
          setRecorded({ w: rw, h: rh })
          recomputeScale(rw, rh)
        }

        const { Replayer } = await import('rrweb')
        if (cancelled) return

        const replayer = new Replayer(events, {
          root:           containerRef.current,
          speed:          1,
          skipInactive:   true,
          triggerFocus:   true,
          pauseAnimation: true,
          useVirtualDom:  true,
          loadTimeout:    0,
          showWarning:    false,
          showDebug:      false,
          UNSAFE_replayCanvas: false,
          mouseTail: { duration: 600, lineCap: 'round', lineWidth: 3, strokeStyle: '#5b5fc7' },
          insertStyleRules: [
            '.replayer-mouse-tail { pointer-events: none !important; }',
            '.replayer-mouse      { z-index: 9999 !important; }',
          ],
        })

        replayer.on('finish', () => {
          stopTimeSync()
          setPlaying(false)
          setSkipMsg(null)
          setTime(totalMsRef.current)
        })
        replayer.on('pause', syncCurrentTime)
        replayer.on('skip-start', (p: unknown) => {
          setStatus('skipping')
          setSkipMsg(`Skipping inactivity… (${(p as { speed?: number })?.speed ?? ''}×)`)
        })
        replayer.on('skip-end', () => { setStatus('ready'); setSkipMsg(null) })
        replayer.on('state-change', syncCurrentTime)
        replayer.on('event-cast', syncCurrentTime)
        replayer.on('resize', (p: unknown) => {
          const { width: rw, height: rh } = p as { width: number; height: number }
          setRecorded({ w: rw, h: rh })
          recomputeScale(rw, rh)
        })

        replayerRef.current = replayer
        setStatus('ready')
      } catch {
        if (!cancelled) { setErrorMsg('Could not load replay.'); setStatus('error') }
      }
    }

    load()
    return () => {
      cancelled = true
      stopTimeSync()
      try { replayerRef.current?.pause() } catch { /* ignore */ }
      replayerRef.current = null
    }
  }, [replayUrl, stopTimeSync, syncCurrentTime, recomputeScale, setTime])

  useEffect(() => {
    if (!recorded.w) return
    const el = isFullscreen ? viewportRef.current : containerRef.current
    if (!el) {
      requestAnimationFrame(() => recomputeScale(recorded.w, recorded.h))
      return
    }
    const ro = new ResizeObserver(() => recomputeScale(recorded.w, recorded.h))
    ro.observe(el)
    recomputeScale(recorded.w, recorded.h)
    return () => ro.disconnect()
  }, [recorded, recomputeScale, isFullscreen])

  useEffect(() => {
    if (!containerRef.current) return
    const wrapper = containerRef.current.querySelector<HTMLElement>('.replayer-wrapper')
    if (!wrapper) return
    // zoom scales iframe + mouse together (transform-only scale desyncs the cursor)
    wrapper.style.transform = `translate(${offset.x}px, ${offset.y}px)`
    wrapper.style.zoom      = scale === 1 ? '' : String(scale)
  }, [scale, offset, status, isFullscreen])

  // Reparent to body in fullscreen — escapes ancestor transform clipping without remounting rrweb
  useEffect(() => {
    const el = wrapperRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return

    if (isFullscreen) {
      document.body.appendChild(el)
    } else if (el.parentNode !== anchor) {
      anchor.appendChild(el)
    }

    return () => {
      if (el.parentNode === document.body && anchor.isConnected) {
        anchor.appendChild(el)
      }
    }
  }, [isFullscreen])

  // CSS overlay fullscreen — keep one DOM tree so rrweb is never remounted
  useEffect(() => {
    if (!isFullscreen) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [isFullscreen])

  // After layout change, rescale and resume if we were mid-playback
  useEffect(() => {
    if (!recorded.w) return
    const wasPlaying = playingRef.current
    const at = currentMsRef.current
    requestAnimationFrame(() => {
      recomputeScale(recorded.w, recorded.h)
      const r = replayerRef.current
      if (wasPlaying && r && !r.service?.state?.matches('playing')) {
        r.play(at)
        startTimeSync()
      }
    })
  }, [isFullscreen, recorded, recomputeScale, startTimeSync])

  // ── controls ────────────────────────────────────────────────────────────────
  const seek = useCallback((ms: number, resume = false) => {
    const r = replayerRef.current
    if (!r) return
    const clamped = Math.max(0, Math.min(totalMsRef.current, ms))
    stopTimeSync()
    setTime(clamped)
    if (resume && playingRef.current) {
      r.play(clamped)
      startTimeSync()
    } else {
      setPlaying(false)
      r.pause(clamped)
    }
  }, [stopTimeSync, startTimeSync, setTime])

  const togglePlay = useCallback(() => {
    const r = replayerRef.current
    if (!r) return
    if (playingRef.current) {
      r.pause()
      stopTimeSync()
      syncCurrentTime()
      setPlaying(false)
      return
    }
    // At end — restart like a normal video player
    const atEnd = currentMsRef.current >= totalMsRef.current - 50
    const from = atEnd ? 0 : currentMsRef.current
    if (atEnd) setTime(0)
    r.play(from)
    startTimeSync()
    setPlaying(true)
  }, [stopTimeSync, startTimeSync, syncCurrentTime, setTime])

  const restart = useCallback(() => {
    stopTimeSync()
    setPlaying(false)
    setTime(0)
    replayerRef.current?.pause(0)
  }, [stopTimeSync, setTime])

  const cycleSpeed = useCallback((dir: 1 | -1) => {
    setSpeed(prev => {
      const idx = SPEEDS.indexOf(prev)
      const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + dir))]
      replayerRef.current?.setConfig?.({ speed: next })
      return next
    })
  }, [])

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s)
    replayerRef.current?.setConfig?.({ speed: s })
  }, [])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!replayerRef.current || status === 'loading' || status === 'error') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          seek(Math.max(0, currentMsRef.current - 10_000))
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(Math.min(totalMsRef.current, currentMsRef.current + 10_000))
          break
        case 'ArrowUp':
          e.preventDefault()
          cycleSpeed(1)
          break
        case 'ArrowDown':
          e.preventDefault()
          cycleSpeed(-1)
          break
        case 'f':
        case 'F':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'Escape':
          if (isFullscreenRef.current) {
            e.preventDefault()
            setIsFullscreen(false)
          }
          break
        case 'r':
        case 'R':
          e.preventDefault()
          restart()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, togglePlay, seek, cycleSpeed, toggleFullscreen, restart])

  function formatTime(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const progress = totalMs ? (currentMs / totalMs) * 100 : 0
  const isReady  = status === 'ready' || status === 'skipping'
  const resBadge = recorded.w ? `${recorded.w}×${recorded.h}` : null

  const playerShell = (
    <div
      ref={wrapperRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-[200] flex flex-col bg-[#0f1124]'
          : 'flex flex-col rounded-xl overflow-hidden bg-[#0f1124] shadow-lg'
      }
      role={isFullscreen ? 'dialog' : undefined}
      aria-modal={isFullscreen ? true : undefined}
      aria-label={isFullscreen ? 'Session replay' : undefined}
    >
      {issueTitle && !isFullscreen && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
          <span className="text-xs text-white/60 truncate">{issueTitle}</span>
          {resBadge && (
            <span className="ml-auto text-[10px] text-white/30 font-mono flex-shrink-0">{resBadge}</span>
          )}
        </div>
      )}

      {/* viewport — click to play/pause */}
      <div
        ref={viewportRef}
        className={`relative bg-[#1a1c2e] overflow-hidden cursor-pointer group/viewport ${
          isFullscreen ? 'flex-1 min-h-0' : ''
        }`}
        style={isFullscreen ? undefined : { minHeight: 240 }}
        onClick={() => togglePlay()}
      >
        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-indigo-400 rounded-full animate-spin"/>
            <span className="text-xs text-white/40">Loading replay…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-8">
            <span className="text-sm text-white/60">{errorMsg ?? 'Could not load replay.'}</span>
          </div>
        )}

        {skipMsg && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-indigo-600/90 text-xs text-white font-medium pointer-events-none">
            {skipMsg}
          </div>
        )}

        {/* play overlay when paused */}
        {isReady && !playing && !isScrubbing && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center text-white opacity-0 group-hover/viewport:opacity-100 transition-opacity">
              <svg width="20" height="22" viewBox="0 0 12 14" fill="currentColor"><polygon points="2,1 11,7 2,13"/></svg>
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className={isFullscreen ? 'absolute inset-0' : 'w-full'}
          style={{ display: isReady ? 'block' : 'none', overflow: 'hidden' }}
        />
      </div>

      {isFullscreen && resBadge && (
        <span className="absolute top-3 right-3 z-20 text-[10px] text-white/30 font-mono pointer-events-none">
          {resBadge}
        </span>
      )}

      {isReady && (
        <div className="bg-[#0f1124] border-t border-white/10 shrink-0">
          {/* scrub bar */}
          <div className="px-3 pt-3 pb-1">
            <div
              className="relative h-2 rounded-full bg-white/15 cursor-pointer group/scrub"
              onMouseDown={e => {
                if (e.button !== 0) return
                setIsScrubbing(true)
                const bar = e.currentTarget
                const scrub = (clientX: number) => {
                  const rect = bar.getBoundingClientRect()
                  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
                  setTime(ratio * totalMsRef.current)
                }
                scrub(e.clientX)
                const onMove = (ev: MouseEvent) => scrub(ev.clientX)
                const onUp = (ev: MouseEvent) => {
                  setIsScrubbing(false)
                  const rect = bar.getBoundingClientRect()
                  const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                  seek(ratio * totalMsRef.current, playingRef.current)
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-indigo-500 pointer-events-none"
                style={{ width: `${progress}%` }}
              />
              <div
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md pointer-events-none transition-opacity ${
                  playing || isScrubbing ? 'opacity-100' : 'opacity-0 group-hover/scrub:opacity-100'
                }`}
                style={{ left: `${progress}%` }}
              />
              <input
                type="range"
                min={0}
                max={totalMs || 1}
                step={1}
                value={currentMs}
                onChange={e => setTime(Number(e.target.value))}
                onMouseDown={() => setIsScrubbing(true)}
                onMouseUp={e => {
                  setIsScrubbing(false)
                  seek(Number((e.target as HTMLInputElement).value), playingRef.current)
                }}
                onTouchStart={() => setIsScrubbing(true)}
                onTouchEnd={e => {
                  setIsScrubbing(false)
                  seek(Number((e.target as HTMLInputElement).value), playingRef.current)
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="Seek"
                aria-valuetext={`${formatTime(currentMs)} of ${formatTime(totalMs)}`}
              />
            </div>
          </div>

          {/* transport controls */}
          <div className="flex items-center gap-1 px-3 py-2">
            <CtrlBtn onClick={restart} label="Restart (R)"><IconRestart/></CtrlBtn>
            <CtrlBtn onClick={() => seek(currentMs - 10_000)} label="Back 10s (←)">
              <span className="flex items-center gap-px text-[10px] font-bold">
                <IconSkipBack/><span className="hidden sm:inline">10</span>
              </span>
            </CtrlBtn>

            <button
              onClick={togglePlay}
              className={`w-9 h-9 flex items-center justify-center rounded-full text-white transition-colors flex-shrink-0 mx-1 ${
                playing ? 'bg-indigo-500 hover:bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-500'
              }`}
              aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
              aria-pressed={playing}
            >
              {playing ? <IconPause/> : <IconPlay/>}
            </button>

            <CtrlBtn onClick={() => seek(currentMs + 10_000)} label="Forward 10s (→)">
              <span className="flex items-center gap-px text-[10px] font-bold">
                <span className="hidden sm:inline">10</span><IconSkipFwd/>
              </span>
            </CtrlBtn>

            <span className="ml-2 text-xs tabular-nums flex-shrink-0 select-none" aria-live="polite">
              <span className={playing ? 'text-white' : 'text-white/80'}>{formatTime(currentMs)}</span>
              <span className="text-white/40"> / {formatTime(totalMs)}</span>
            </span>

            {playing && (
              <span className="ml-1 text-[10px] uppercase tracking-wider text-indigo-400 font-medium select-none">
                Playing
              </span>
            )}

            <div className="flex-1"/>

            <select
              value={speed}
              onChange={e => handleSpeedChange(Number(e.target.value))}
              className="text-xs bg-white/10 hover:bg-white/20 text-white/70 border-0 rounded px-2 py-1 cursor-pointer outline-none"
              aria-label="Playback speed"
            >
              {SPEEDS.map(s => (
                <option key={s} value={s} className="bg-gray-900">{s}×</option>
              ))}
            </select>

            <CtrlBtn
              onClick={e => { e.stopPropagation(); toggleFullscreen() }}
              label={isFullscreen ? 'Exit fullscreen (F / Esc)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? <IconExitFullscreen/> : <IconFullscreen/>}
            </CtrlBtn>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div
      ref={anchorRef}
      aria-hidden={isFullscreen || undefined}
      className={isFullscreen ? 'rounded-xl border border-dashed border-gray-200 bg-gray-50/80' : undefined}
      style={isFullscreen ? { minHeight: placeholderHRef.current || 240 } : undefined}
    >
      {playerShell}
    </div>
  )
}

function CtrlBtn({ onClick, label, children }: {
  onClick: () => void
  label:   string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-8 h-8 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
    >
      {children}
    </button>
  )
}
