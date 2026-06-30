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
/** Skip-to-start — vertical bar + left-pointing triangle (standard media icon) */
const IconSkipToStart = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="5" width="2.5" height="14" rx="0.5"/>
    <polygon points="20,12 10,5 10,19"/>
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

// ─── multi-stream types ───────────────────────────────────────────────────────
interface StreamMeta { tabId: number; url: string; title: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface StreamPayload extends StreamMeta { events: any[] }
interface MultiStreamRaw {
  version: 2
  streams: StreamPayload[]
  switches: { at: number; toTabId: number }[]
}

/** Walk an rrweb serialized node tree looking for canvas tags. */
function nodeHasCanvas(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as { tagName?: string; childNodes?: unknown[] }
  if (n.tagName === 'canvas') return true
  return (n.childNodes ?? []).some(nodeHasCanvas)
}

/** True when snapshots contain canvas elements but no captured canvas pixels. */
function streamHasUncapturedCanvas(events: unknown[]): boolean {
  let sawCanvas = false
  let sawCanvasData = false
  for (const ev of events) {
    const e = ev as { type?: number; data?: { node?: unknown; attributes?: Record<string, unknown> } }
    if (e.type === 2 && e.data?.node) {
      if (nodeHasCanvas(e.data.node)) sawCanvas = true
    }
    if (e.data?.attributes?.rr_dataURL) sawCanvasData = true
    const raw = JSON.stringify(ev)
    if (raw.includes('"tagName":"canvas"')) sawCanvas = true
    if (raw.includes('rr_dataURL')) sawCanvasData = true
  }
  return sawCanvas && !sawCanvasData
}

function streamCaptureWarning(events: unknown[], url: string): string | null {
  const isOffice = /sharepoint|office\.com|office365|excel|onedrive/i.test(url)
  const uncaptured = streamHasUncapturedCanvas(events)
  const spanMs = events.length >= 2
    ? ((events[events.length - 1] as { timestamp: number }).timestamp - (events[0] as { timestamp: number }).timestamp)
    : 0
  const spanSec = Math.round(spanMs / 1000)
  // Canvas-only apps produce ~2–8 DOM events/sec without recordCanvas — looks "empty"
  const suspiciouslySparse = events.length < 40 || (spanSec > 8 && events.length < spanSec * 3)

  if (isOffice && (uncaptured || suspiciouslySparse)) {
    return `Excel/Office renders cells on HTML canvas, not regular DOM — ${events.length} events over ~${spanSec || '?'}s is too sparse for the time you spent here. Sheet/tab switches used to wipe the buffer (now fixed). Reload the extension in chrome://extensions and record again.`
  }
  if (uncaptured) {
    return 'This page renders on HTML canvas. This replay was captured without canvas pixels, so the viewport appears blank. Reload the extension and re-record.'
  }
  if (suspiciouslySparse) {
    return `Only ${events.length} events captured across ~${spanSec || '?'}s on this tab — recording may have been reset by in-page navigation. Reload the extension and try again.`
  }
  if (isOffice) {
    return 'Office / Excel may embed cross-origin content that session replay cannot capture. Toolbar chrome should appear; the grid may stay blank if it loaded in a blocked iframe.'
  }
  return null
}

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

  // ─── multi-stream state ──────────────────────────────────────────────────
  const multiContainersRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const multiReplayersRef  = useRef<Map<number, any>>(new Map())
  const streamOffsetsRef   = useRef<Map<number, number>>(new Map())
  const streamDurationsRef = useRef<Map<number, number>>(new Map())
  const playAnchorRef      = useRef({ wallMs: 0, globalMs: 0 })
  const speedRef           = useRef(1)
  const [streams,          setStreams]          = useState<StreamMeta[]>([])
  const [streamWarnings,   setStreamWarnings]   = useState<Map<number, string>>(new Map())
  const [activeTabId,      setActiveTabId]      = useState<number | null>(null)
  const activeTabIdRef     = useRef<number | null>(null)
  const switchesRef        = useRef<{ atRel: number; toTabId: number }[]>([])
  const globalStartRef     = useRef<number>(0)
  // ──────────────────────────────────────────────────────────────────────────

  const setActiveTab = useCallback((tabId: number | null) => {
    activeTabIdRef.current = tabId
    setActiveTabId(tabId)
  }, [])

  /** Shared rrweb Replayer options — replay DOM is our own captured QA data. */
  const replayerOpts = (root: HTMLElement) => ({
    root,
    speed: 1,
    skipInactive: false,
    triggerFocus: true,
    pauseAnimation: true,
    useVirtualDom: true,
    loadTimeout: 0,
    showWarning: false,
    showDebug: false,
    UNSAFE_replayCanvas: true,
    // Required when replay container is moved (e.g. fullscreen overlay) — data is
    // workspace-owned QA capture, not arbitrary third-party replay input.
    UNSAFE_allowUnprotectedRebuild: true,
    mouseTail: { duration: 600, lineCap: 'round', lineWidth: 3, strokeStyle: '#5b5fc7' },
    insertStyleRules: [
      '.replayer-mouse-tail { pointer-events: none !important; }',
      '.replayer-mouse      { z-index: 9999 !important; }',
    ],
  })

  const [status,       setStatus]       = useState<PlayerStatus>('loading')
  const [playing,      setPlaying]      = useState(false)
  const [speed,        setSpeed]        = useState(1)
  const [currentMs,    setCurrentMs]    = useState(0)
  const [totalMs,      setTotalMs]      = useState(0)
  const [skipMsg,      setSkipMsg]      = useState<string | null>(null)
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isScrubbing,  setIsScrubbing]  = useState(false)
  const [speedOpen,    setSpeedOpen]    = useState(false)
  const speedMenuRef   = useRef<HTMLDivElement>(null)
  const [recorded,     setRecorded]     = useState({ w: 0, h: 0 })
  const [scale,        setScale]        = useState(1)
  const [offset,       setOffset]       = useState({ x: 0, y: 0 })

  playingRef.current = playing
  currentMsRef.current = currentMs
  isFullscreenRef.current = isFullscreen
  speedRef.current = speed

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

  /** Stream-local ms → global session ms (multi-tab only). */
  const readGlobalPlaybackMs = useCallback((): number | null => {
    if (multiReplayersRef.current.size === 0) {
      return readPlaybackMs(replayerRef.current)
    }
    const tabId = activeTabIdRef.current
    if (tabId == null) return null
    const local = readPlaybackMs(multiReplayersRef.current.get(tabId))
    if (local == null) return null
    const streamOffset = streamOffsetsRef.current.get(tabId) ?? 0
    return local + streamOffset
  }, [readPlaybackMs])

  const syncCurrentTime = useCallback(() => {
    const t = readGlobalPlaybackMs()
    if (t != null) setTime(t)
  }, [readGlobalPlaybackMs, setTime])

  const stopTimeSync = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  // updateActiveTabForMs — globalMs is 0 … totalMs on the shared session timeline
  const updateActiveTabForMs = useCallback((globalMs: number) => {
    const switches = switchesRef.current
    if (!multiReplayersRef.current.size) return
    let activeId: number | null = null
    multiContainersRef.current.forEach((_, tabId) => {
      if (activeId === null) activeId = tabId
    })
    for (const sw of switches) {
      if (sw.atRel <= globalMs) activeId = sw.toTabId
    }
    if (activeId === null) return
    // Only touch React state when the visible tab actually changes (avoids re-render
    // every RAF frame — that was collapsing the speed menu and causing UI jank).
    if (activeId !== activeTabIdRef.current) {
      setActiveTab(activeId)
      const activeReplayer = multiReplayersRef.current.get(activeId)
      if (activeReplayer) replayerRef.current = activeReplayer
    }
    multiContainersRef.current.forEach((div, tabId) => {
      div.style.display = tabId === activeId ? 'block' : 'none'
    })
  }, [setActiveTab])

  /** Keep each tab's rrweb instance at the correct stream-local offset. */
  const syncReplayersAtGlobalMs = useCallback((globalMs: number, shouldPlay: boolean) => {
    multiReplayersRef.current.forEach((r, tabId) => {
      const streamOffset = streamOffsetsRef.current.get(tabId) ?? 0
      const streamDur    = streamDurationsRef.current.get(tabId) ?? 0
      const localMs      = globalMs - streamOffset
      try {
        if (localMs < 0) {
          r.pause(0)
        } else if (localMs >= streamDur) {
          r.pause(streamDur)
        } else if (shouldPlay) {
          if (!r.service?.state?.matches('playing')) r.play(localMs)
        } else {
          r.pause(localMs)
        }
      } catch { /* ignore stale replayer */ }
    })
  }, [])

  const startTimeSync = useCallback(() => {
    stopTimeSync()
    playAnchorRef.current = { wallMs: performance.now(), globalMs: currentMsRef.current }

    const tick = () => {
      if (multiReplayersRef.current.size > 0) {
        const elapsed  = (performance.now() - playAnchorRef.current.wallMs) * speedRef.current
        let globalMs   = playAnchorRef.current.globalMs + elapsed

        if (globalMs >= totalMsRef.current) {
          globalMs = totalMsRef.current
          setTime(globalMs)
          updateActiveTabForMs(globalMs)
          syncReplayersAtGlobalMs(globalMs, false)
          stopTimeSync()
          setPlaying(false)
          return
        }

        setTime(globalMs)
        updateActiveTabForMs(globalMs)
        syncReplayersAtGlobalMs(globalMs, true)
      } else {
        const t = readPlaybackMs(replayerRef.current)
        if (t != null) {
          setTime(t)
          if (t >= totalMsRef.current - 50) {
            stopTimeSync()
            setPlaying(false)
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopTimeSync, readPlaybackMs, setTime, updateActiveTabForMs, syncReplayersAtGlobalMs])

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

    async function initMultiStream(payload: MultiStreamRaw) {
      if (!payload.streams.length) {
        setErrorMsg('No tab streams found in replay.')
        setStatus('error')
        return
      }

      // Global timeline
      let minTs = Infinity, maxTs = 0
      for (const s of payload.streams) {
        if (s.events.length < 2) continue
        const f = s.events[0].timestamp
        const l = s.events[s.events.length - 1].timestamp
        if (f < minTs) minTs = f
        if (l > maxTs) maxTs = l
      }
      globalStartRef.current = minTs
      const duration = maxTs - minTs
      totalMsRef.current = duration
      setTotalMs(duration)

      // Normalize switch timestamps to ms relative to session start
      switchesRef.current = (payload.switches ?? [])
        .map(sw => ({ atRel: sw.at - minTs, toTabId: sw.toTabId }))
        .sort((a, b) => a.atRel - b.atRel)
      setActiveTab(payload.streams[0].tabId)

      const { Replayer } = await import('rrweb')
      if (cancelled || !containerRef.current) return

      // Ensure container is relative so absolute children stack
      containerRef.current.style.position = 'relative'

      for (const stream of payload.streams) {
        if (stream.events.length < 2) continue

        const div = document.createElement('div')
        div.style.cssText = 'position:absolute;inset:0;display:none;overflow:hidden;'
        div.dataset.tabId = String(stream.tabId)
        containerRef.current.appendChild(div)
        multiContainersRef.current.set(stream.tabId, div)

        const streamOffset = stream.events[0].timestamp - minTs
        const streamDur    = stream.events[stream.events.length - 1].timestamp - stream.events[0].timestamp
        streamOffsetsRef.current.set(stream.tabId, streamOffset)
        streamDurationsRef.current.set(stream.tabId, streamDur)

        const replayer = new Replayer(stream.events, replayerOpts(div))
        // Individual stream finish must NOT stop the global session timeline
        replayer.on('finish', () => { /* master clock drives multi-tab playback */ })
        multiReplayersRef.current.set(stream.tabId, replayer)
      }

      // Finding #7: only expose tabs that actually got a Replayer
      const warnings = new Map<number, string>()
      for (const s of payload.streams) {
        if (!multiReplayersRef.current.has(s.tabId)) continue
        const msg = streamCaptureWarning(s.events, s.url)
        if (msg) warnings.set(s.tabId, msg)
      }
      setStreamWarnings(warnings)
      setStreams(payload.streams.filter(s => multiReplayersRef.current.has(s.tabId)).map(s => ({ tabId: s.tabId, url: s.url, title: s.title })))

      // Show first tab
      const firstTabId = payload.streams[0].tabId
      const firstDiv = multiContainersRef.current.get(firstTabId)
      if (firstDiv) firstDiv.style.display = 'block'
      const firstReplayer = multiReplayersRef.current.get(firstTabId)
      if (firstReplayer) replayerRef.current = firstReplayer

      // Use the largest viewport across streams so scaling fits every tab
      let rw = 0, rh = 0
      for (const stream of payload.streams) {
        const meta = stream.events.find((e: any) => e.type === 4)
        if (meta?.data) {
          rw = Math.max(rw, (meta.data as any).width  || 0)
          rh = Math.max(rh, (meta.data as any).height || 0)
        }
      }
      if (rw && rh) { setRecorded({ w: rw, h: rh }); recomputeScale(rw, rh) }

      setStatus('ready')
    }

    async function load() {
      try {
        const res = await fetch(replayUrl)
        if (!res.ok) throw new Error('fetch failed')
        const blob = await res.blob()
        const ds   = new DecompressionStream('gzip')
        const text = await new Response(blob.stream().pipeThrough(ds)).text()
        const raw: any = JSON.parse(text)

        // Detect v2 multi-stream format
        const isMultiStream = raw?.version === 2 && Array.isArray(raw?.streams)
        if (isMultiStream) {
          if (cancelled || !containerRef.current) return
          await initMultiStream(raw as MultiStreamRaw)
          return
        }

        // --- existing single-stream path ---
        const events: any[] = Array.isArray(raw) ? raw : raw.events ?? []

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
          ...replayerOpts(containerRef.current),
          skipInactive: true,
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
      multiReplayersRef.current.forEach(r => { try { r.pause() } catch { /* */ } })
      multiReplayersRef.current.clear()
      multiContainersRef.current.clear()
      streamOffsetsRef.current.clear()
      streamDurationsRef.current.clear()
      setStreamWarnings(new Map())
      try { replayerRef.current?.pause() } catch { /* ignore */ }
      replayerRef.current = null
    }
  }, [replayUrl, stopTimeSync, syncCurrentTime, recomputeScale, setTime, updateActiveTabForMs])

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
    // Apply scale to every tab's replayer wrapper (multi-stream has one per tab)
    containerRef.current.querySelectorAll<HTMLElement>('.replayer-wrapper').forEach(wrapper => {
      wrapper.style.transformOrigin = 'top left'
      wrapper.style.transform = `translate(${offset.x}px, ${offset.y}px)`
      wrapper.style.zoom      = scale === 1 ? '' : String(scale)
    })
  }, [scale, offset, status, isFullscreen, activeTabId])

  // Fullscreen uses CSS `fixed inset-0` on the wrapper — do NOT reparent to
  // document.body; moving the rrweb iframe triggers sandbox rebuild errors.
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
      if (wasPlaying && multiReplayersRef.current.size > 0) {
        playAnchorRef.current = { wallMs: performance.now(), globalMs: at }
        syncReplayersAtGlobalMs(at, true)
        startTimeSync()
      } else {
        const r = replayerRef.current
        if (wasPlaying && r && !r.service?.state?.matches('playing')) {
          r.play(at)
          startTimeSync()
        }
      }
    })
  }, [isFullscreen, recorded, recomputeScale, startTimeSync, syncReplayersAtGlobalMs])

  // ── controls ────────────────────────────────────────────────────────────────
  const seek = useCallback((ms: number, resume = false) => {
    const clamped = Math.max(0, Math.min(totalMsRef.current, ms))
    stopTimeSync()
    setTime(clamped)

    if (multiReplayersRef.current.size > 0) {
      syncReplayersAtGlobalMs(clamped, false)
      updateActiveTabForMs(clamped)
      if (resume && playingRef.current) {
        playAnchorRef.current = { wallMs: performance.now(), globalMs: clamped }
        syncReplayersAtGlobalMs(clamped, true)
        startTimeSync()
        setPlaying(true)
      } else {
        setPlaying(false)
      }
      return
    }

    const r = replayerRef.current
    if (!r) return
    if (resume && playingRef.current) {
      r.play(clamped)
      startTimeSync()
    } else {
      setPlaying(false)
      r.pause(clamped)
    }
  }, [stopTimeSync, startTimeSync, setTime, updateActiveTabForMs, syncReplayersAtGlobalMs])

  const togglePlay = useCallback(() => {
    if (multiReplayersRef.current.size > 0) {
      // Multi-stream toggle
      if (playingRef.current) {
        multiReplayersRef.current.forEach(r => r.pause())
        stopTimeSync()
        setPlaying(false)
      } else {
        const atEnd = currentMsRef.current >= totalMsRef.current - 50
        const from  = atEnd ? 0 : currentMsRef.current
        if (atEnd) setTime(0)
        playAnchorRef.current = { wallMs: performance.now(), globalMs: from }
        syncReplayersAtGlobalMs(from, true)
        updateActiveTabForMs(from)
        startTimeSync()
        setPlaying(true)
      }
      return
    }

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
  }, [stopTimeSync, startTimeSync, syncCurrentTime, setTime, syncReplayersAtGlobalMs, updateActiveTabForMs])

  const restart = useCallback(() => {
    stopTimeSync()
    setPlaying(false)
    setTime(0)
    if (multiReplayersRef.current.size > 0) {
      multiReplayersRef.current.forEach(r => r.pause(0))
      updateActiveTabForMs(0)
      return
    }
    replayerRef.current?.pause(0)
  }, [stopTimeSync, setTime, updateActiveTabForMs])

  const cycleSpeed = useCallback((dir: 1 | -1) => {
    setSpeed(prev => {
      const idx = SPEEDS.indexOf(prev)
      const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + dir))]
      if (multiReplayersRef.current.size > 0) {
        multiReplayersRef.current.forEach(r => r.setConfig?.({ speed: next }))
      } else {
        replayerRef.current?.setConfig?.({ speed: next })
      }
      return next
    })
  }, [])

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s)
    speedRef.current = s
    if (playingRef.current && multiReplayersRef.current.size > 0) {
      playAnchorRef.current = { wallMs: performance.now(), globalMs: currentMsRef.current }
    }
    if (multiReplayersRef.current.size > 0) {
      multiReplayersRef.current.forEach(r => r.setConfig?.({ speed: s }))
    } else {
      replayerRef.current?.setConfig?.({ speed: s })
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev)
  }, [])

  useEffect(() => {
    if (!speedOpen) return
    function close(e: MouseEvent) {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setSpeedOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [speedOpen])

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

      {/* Tab strip — only shown for multi-stream */}
      {streams.length > 0 && isReady && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-[#0a0c1e] overflow-x-auto flex-shrink-0">
          {streams.map(s => {
            const isActive = s.tabId === activeTabId
            let hostname = s.url
            try { hostname = new URL(s.url).hostname } catch { /* use raw url */ }
            return (
              <button
                key={s.tabId}
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveTab(s.tabId)
                  const activeReplayer = multiReplayersRef.current.get(s.tabId)
                  if (activeReplayer) replayerRef.current = activeReplayer
                  multiContainersRef.current.forEach((div, id) => {
                    div.style.display = id === s.tabId ? 'block' : 'none'
                  })
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs flex-shrink-0 transition-colors ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.08]'
                } ${streamWarnings.has(s.tabId) ? 'ring-1 ring-amber-500/40' : ''}`}
                title={streamWarnings.get(s.tabId) ?? undefined}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-indigo-400' : 'bg-white/20'}`} />
                <span className="max-w-[120px] truncate">{hostname || s.title}</span>
              </button>
            )
          })}
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
          style={{ display: isReady ? 'block' : 'none', overflow: 'hidden', position: 'relative' }}
        />

        {isReady && activeTabId != null && streamWarnings.get(activeTabId) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none px-8">
            <div className="max-w-md rounded-lg bg-black/75 border border-amber-500/30 px-4 py-3 text-center">
              <p className="text-xs text-amber-200/90 font-medium mb-1">Limited capture on this tab</p>
              <p className="text-xs text-white/60 leading-relaxed">{streamWarnings.get(activeTabId)}</p>
            </div>
          </div>
        )}
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
            <CtrlBtn onClick={restart} label="Skip to start (R)"><IconSkipToStart/></CtrlBtn>
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

            <div ref={speedMenuRef} className="relative">
              <button
                type="button"
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setSpeedOpen(o => !o) }}
                className="text-xs bg-white/10 hover:bg-white/20 text-white/70 rounded px-2 py-1 cursor-pointer outline-none min-w-[3rem]"
                aria-label="Playback speed"
                aria-expanded={speedOpen}
                aria-haspopup="listbox"
              >
                {speed}×
              </button>
              {speedOpen && (
                <ul
                  role="listbox"
                  aria-label="Playback speed"
                  className="absolute bottom-full right-0 mb-1 py-1 rounded-lg bg-[#1a1c2e] border border-white/10 shadow-xl z-30 min-w-[4rem]"
                  onMouseDown={e => e.stopPropagation()}
                >
                  {SPEEDS.map(s => (
                    <li key={s} role="option" aria-selected={s === speed}>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          handleSpeedChange(s)
                          setSpeedOpen(false)
                        }}
                        className={`block w-full text-left text-xs px-3 py-1.5 hover:bg-white/10 ${
                          s === speed ? 'text-indigo-400 font-medium' : 'text-white/70'
                        }`}
                      >
                        {s}×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

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
  onClick: (e: React.MouseEvent) => void
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
