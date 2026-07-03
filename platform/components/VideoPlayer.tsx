'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

interface VideoPlayerProps {
  videoUrl: string
  webcamUrl?: string | null
  issueTitle?: string
}

const SPEEDS = [0.5, 1, 1.5, 2, 4]

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
const WEBCAM_CORNER_KEY = 'qa-video-webcam-corner'
const VALID_CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

function loadSavedCorner(): Corner {
  if (typeof window === 'undefined') return 'bottom-right'
  const saved = window.localStorage.getItem(WEBCAM_CORNER_KEY)
  return (VALID_CORNERS as string[]).includes(saved ?? '') ? (saved as Corner) : 'bottom-right'
}

const WEBCAM_SIZE_KEY = 'qa-video-webcam-size'
const MIN_WEBCAM_SIZE = 80
const MAX_WEBCAM_SIZE = 200
const DEFAULT_WEBCAM_SIZE = 120

function loadSavedWebcamSize(): number {
  if (typeof window === 'undefined') return DEFAULT_WEBCAM_SIZE
  const saved = Number(window.localStorage.getItem(WEBCAM_SIZE_KEY))
  if (!saved || Number.isNaN(saved)) return DEFAULT_WEBCAM_SIZE
  return Math.max(MIN_WEBCAM_SIZE, Math.min(MAX_WEBCAM_SIZE, saved))
}

const CORNER_CLASSES: Record<Corner, string> = {
  'top-left': 'top-3 left-3',
  'top-right': 'top-3 right-3',
  'bottom-left': 'bottom-3 left-3',
  'bottom-right': 'bottom-3 right-3',
}

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
const IconVolumeOn = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <path d="M1 5v4h2.5L7 12V2L3.5 5H1z"/>
    <path d="M9.5 4.5a3 3 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)
const IconVolumeMuted = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <path d="M1 5v4h2.5L7 12V2L3.5 5H1z"/>
    <path d="M9.5 5.5l3 3M12.5 5.5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function VideoPlayer({ videoUrl, webcamUrl, issueTitle }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const webcamRef = useRef<HTMLVideoElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const speedMenuRef = useRef<HTMLDivElement>(null)
  // Hover-preview tooltip on the scrub bar: hoverRatio is 0-1 position along the bar,
  // null when the pointer isn't over it. Separate from the drag/scrub state above —
  // hovering shows a preview without moving playback position.
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)

  const [corner, setCorner] = useState<Corner>(() => loadSavedCorner())
  const [dragging, setDragging] = useState(false)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const [webcamSize, setWebcamSize] = useState<number>(() => loadSavedWebcamSize())
  const [resizing, setResizing] = useState(false)

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [])

  const seek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
    if (webcamRef.current) webcamRef.current.currentTime = time
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = () => { setPlaying(true); webcamRef.current?.play().catch(() => {}) }
    const onPause = () => { setPlaying(false); webcamRef.current?.pause() }
    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onLoadedMetadata = () => setDuration(video.duration)
    const onSeeked = () => { if (webcamRef.current) webcamRef.current.currentTime = video.currentTime }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('seeked', onSeeked)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [])

  const handleVolumeChange = useCallback((v: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = v
    video.muted = v === 0
    setVolume(v)
    setMuted(v === 0)
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }, [])

  const handleSpeedChange = useCallback((s: number) => {
    const video = videoRef.current
    if (video) video.playbackRate = s
    if (webcamRef.current) webcamRef.current.playbackRate = s
    setSpeed(s)
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

  const handleWebcamPointerDown = useCallback((e: React.PointerEvent<HTMLVideoElement>) => {
    e.preventDefault()
    const wrapper = wrapperRef.current
    if (!wrapper) return
    ;(e.target as HTMLVideoElement).setPointerCapture(e.pointerId)
    setDragging(true)

    const rect = wrapper.getBoundingClientRect()

    const onMove = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min(rect.width - webcamSize, ev.clientX - rect.left - webcamSize / 2))
      const y = Math.max(0, Math.min(rect.height - webcamSize, ev.clientY - rect.top - webcamSize / 2))
      setDragPosition({ x, y })
    }

    const onUp = (ev: PointerEvent) => {
      const x = ev.clientX - rect.left
      const y = ev.clientY - rect.top
      const corners: { key: Corner; cx: number; cy: number }[] = [
        { key: 'top-left', cx: 0, cy: 0 },
        { key: 'top-right', cx: rect.width, cy: 0 },
        { key: 'bottom-left', cx: 0, cy: rect.height },
        { key: 'bottom-right', cx: rect.width, cy: rect.height },
      ]
      let nearest = corners[0]
      let nearestDist = Infinity
      for (const c of corners) {
        const dist = Math.hypot(x - c.cx, y - c.cy)
        if (dist < nearestDist) { nearestDist = dist; nearest = c }
      }
      setCorner(nearest.key)
      window.localStorage.setItem(WEBCAM_CORNER_KEY, nearest.key)
      setDragging(false)
      setDragPosition(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [webcamSize])

  const handleResizeHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const wrapper = wrapperRef.current
    if (!wrapper) return
    ;(e.target as HTMLDivElement).setPointerCapture(e.pointerId)
    setResizing(true)

    const rect = wrapper.getBoundingClientRect()
    const startSize = webcamSize

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - (rect.left + rect.width)
      const dy = ev.clientY - (rect.top + rect.height)
      const delta = Math.max(dx, dy)
      const next = Math.max(MIN_WEBCAM_SIZE, Math.min(MAX_WEBCAM_SIZE, startSize + delta))
      setWebcamSize(next)
    }

    const onUp = () => {
      setResizing(false)
      setWebcamSize((current) => {
        window.localStorage.setItem(WEBCAM_SIZE_KEY, String(current))
        return current
      })
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [webcamSize])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape' && isFullscreen) {
        e.preventDefault()
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen])

  const progress = duration ? (currentTime / duration) * 100 : 0

  return (
    <div
      ref={wrapperRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-[200] flex flex-col bg-black'
          : 'relative w-full rounded-lg overflow-hidden ring-1 ring-gray-200 bg-black'
      }
      role={isFullscreen ? 'dialog' : undefined}
      aria-modal={isFullscreen ? true : undefined}
      aria-label={isFullscreen ? (issueTitle ?? 'Screen recording') : undefined}
    >
      <div className={isFullscreen ? 'relative flex-1 min-h-0' : 'relative'}>
        <video
          ref={videoRef}
          src={videoUrl}
          className={isFullscreen ? 'w-full h-full object-contain' : 'w-full block'}
          style={isFullscreen ? undefined : { maxHeight: '480px' }}
          onClick={togglePlay}
        />
        {webcamUrl && (
          <div
            className={`absolute group/webcam ${
              dragPosition ? '' : CORNER_CLASSES[corner]
            } ${dragging || resizing ? 'transition-none' : 'transition-[top,left,right,bottom] duration-150'}`}
            style={
              dragPosition
                ? { width: `${webcamSize}px`, height: `${webcamSize}px`, left: dragPosition.x, top: dragPosition.y }
                : { width: `${webcamSize}px`, height: `${webcamSize}px` }
            }
          >
            <video
              ref={webcamRef}
              src={webcamUrl}
              muted
              onPointerDown={handleWebcamPointerDown}
              className="w-full h-full rounded-full ring-2 ring-white shadow-lg cursor-grab active:cursor-grabbing object-cover"
            />
            <div
              onPointerDown={handleResizeHandlePointerDown}
              className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-white ring-1 ring-gray-300 shadow cursor-nwse-resize opacity-0 group-hover/webcam:opacity-100 transition-opacity"
              title="Drag to resize"
            />
          </div>
        )}
      </div>

      <div className="bg-black/90 shrink-0">
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
                setCurrentTime(ratio * duration)
              }
              scrub(e.clientX)
              const onMove = (ev: MouseEvent) => scrub(ev.clientX)
              const onUp = (ev: MouseEvent) => {
                setIsScrubbing(false)
                const rect = bar.getBoundingClientRect()
                const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                seek(ratio * duration)
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
              setHoverRatio(ratio)
            }}
            onMouseLeave={() => setHoverRatio(null)}
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
            {hoverRatio !== null && (
              <div
                className="absolute bottom-full mb-1.5 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black text-white text-[10px] tabular-nums pointer-events-none whitespace-nowrap"
                style={{ left: `${hoverRatio * 100}%` }}
              >
                {formatTime(hoverRatio * duration)}
              </div>
            )}
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={currentTime}
              onChange={e => setCurrentTime(Number(e.target.value))}
              onMouseUp={e => seek(Number((e.target as HTMLInputElement).value))}
              onTouchStart={() => setIsScrubbing(true)}
              onTouchEnd={e => {
                setIsScrubbing(false)
                seek(Number((e.target as HTMLInputElement).value))
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Seek"
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2">
          <button
            onClick={togglePlay}
            className={`w-8 h-8 flex items-center justify-center rounded-full text-white transition-colors flex-shrink-0 ${
              playing ? 'bg-indigo-500 hover:bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
            aria-label={playing ? 'Pause' : 'Play'}
            aria-pressed={playing}
          >
            {playing ? <IconPause/> : <IconPlay/>}
          </button>

          <span className="text-xs tabular-nums text-white/80 select-none">
            {formatTime(currentTime)} <span className="text-white/40">/ {formatTime(duration)}</span>
          </span>

          <div className="flex-1"/>

          <button
            onClick={toggleMute}
            className="w-8 h-8 flex items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? <IconVolumeMuted/> : <IconVolumeOn/>}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={e => handleVolumeChange(Number(e.target.value))}
            className="w-16 accent-indigo-500"
            aria-label="Volume"
          />

          <div ref={speedMenuRef} className="relative ml-1">
            <button
              type="button"
              onClick={() => setSpeedOpen(o => !o)}
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
              >
                {SPEEDS.map(s => (
                  <li key={s} role="option" aria-selected={s === speed}>
                    <button
                      type="button"
                      onClick={() => { handleSpeedChange(s); setSpeedOpen(false) }}
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

          <button
            onClick={toggleFullscreen}
            className="w-8 h-8 flex items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 ml-1"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <IconExitFullscreen/> : <IconFullscreen/>}
          </button>
        </div>
      </div>
    </div>
  )
}
