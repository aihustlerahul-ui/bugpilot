# Enhanced Video Player Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native `<video controls>` element on the issue detail page's "Screen Recording" section with a custom-controlled `VideoPlayer` component (play/pause, seek bar with hover-preview, volume, playback speed, and a CSS-overlay fullscreen mode that keeps the synced webcam circle visible).

**Architecture:** A new self-contained component, `platform/components/VideoPlayer.tsx`, following the exact visual/interaction conventions already established by `platform/components/ReplayPlayer.tsx` (same icon style copied locally into the new file, same CSS-based `fixed inset-0` fullscreen — not the native Fullscreen API — same scrub-bar drag pattern). The issue detail page replaces its inline video block with this component.

**Tech Stack:** React 18 (Next.js 14 client component), Tailwind CSS utility classes, plain HTML5 `<video>` element (no new library).

## Global Constraints

- Fullscreen is a CSS `fixed inset-0` overlay toggled by React state — never `element.requestFullscreen()`. This is required so the webcam overlay (a DOM sibling of the main video) stays rendered and visible while fullscreen, matching `ReplayPlayer.tsx`'s existing `isFullscreen` pattern exactly.
- Icons (`IconPlay`, `IconPause`, `IconFullscreen`, `IconExitFullscreen`) are copied locally into `VideoPlayer.tsx`, not imported from `ReplayPlayer.tsx` — this matches how `ReplayPlayer.tsx` itself defines icons locally rather than sharing a common icon module; the codebase has no shared icon file for these components.
- Playback speed options are `[0.5, 1, 1.5, 2, 4]` — the exact same `SPEEDS` array already used in `ReplayPlayer.tsx`, for visual/behavioral consistency between the two player types.
- No test framework exists for `platform/` components (`ReplayPlayer.tsx` itself has no unit tests) — verification is TypeScript compilation (`npx tsc --noEmit`, baseline is `17` pre-existing errors, confirmed via `git stash` comparison — this feature must not change that count) plus a manual test checklist, matching how prior platform-touching tasks in this project were verified.
- `Issue.videoUrl` and `Issue.webcamUrl` are both `string | null | undefined` per the existing `platform/lib/types.ts` `Issue` interface — do not change that interface.
- The webcam overlay is draggable within the player and snaps to one of 4 corners (`top-left`, `top-right`, `bottom-left`, `bottom-right`) on release — computed by nearest-corner distance from the release point, not free-form positioning. The chosen corner persists to `localStorage` under the key `qa-video-webcam-corner` as one global preference shared across every video viewed in this browser (not per-issue). Dragging works identically in both inline and fullscreen layouts, since corner position is always computed relative to the player's own bounding box via `getBoundingClientRect()`.

---

### Task 1: `VideoPlayer.tsx` — core player (play/pause, seek, fullscreen, webcam sync)

**Files:**
- Create: `platform/components/VideoPlayer.tsx`

**Interfaces:**
- Produces: `VideoPlayer` React component with props `{ videoUrl: string; webcamUrl?: string | null; issueTitle?: string }` — the default export, consumed by Task 3 (issue detail page integration). Also produces the shared `SPEEDS` array, `formatTime(seconds: number): string` helper, and icon components (`IconPlay`, `IconPause`, `IconFullscreen`, `IconExitFullscreen`) — all local to this file, extended by Task 2 (volume + speed controls) in the same file.

- [ ] **Step 1: Create the component file with imports, icons, and the time formatter**

```tsx
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

interface VideoPlayerProps {
  videoUrl: string
  webcamUrl?: string | null
  issueTitle?: string
}

const SPEEDS = [0.5, 1, 1.5, 2, 4]

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
```

- [ ] **Step 2: Add the component shell with state, refs, and video event wiring**

```tsx
export function VideoPlayer({ videoUrl, webcamUrl, issueTitle }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const webcamRef = useRef<HTMLVideoElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)

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
      style={isFullscreen ? undefined : { maxHeight: '480px' }}
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
          <video
            ref={webcamRef}
            src={webcamUrl}
            muted
            className="absolute bottom-3 right-3 rounded-full ring-2 ring-white shadow-lg pointer-events-none"
            style={{ width: '120px', height: '120px', objectFit: 'cover' }}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles with no new errors**

Run: `cd platform && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `17` (same as the established baseline — this component isn't wired into the page yet, so it shouldn't introduce or remove any errors on its own; if the count differs, investigate before proceeding).

- [ ] **Step 4: Commit**

```bash
git add platform/components/VideoPlayer.tsx
git commit -m "feat(platform): add VideoPlayer component core (play/pause, seek, fullscreen, webcam sync)"
```

---

### Task 2: Add scrub bar, time display, volume control, and playback speed to `VideoPlayer.tsx`

**Files:**
- Modify: `platform/components/VideoPlayer.tsx`

**Interfaces:**
- Consumes: `SPEEDS`, `formatTime`, `IconVolumeOn`, `IconVolumeMuted`, `videoRef`, `webcamRef`, `seek`, `togglePlay`, `playing`, `currentTime`, `duration`, `progress`, `isScrubbing`/`setIsScrubbing`, `isFullscreen`, `toggleFullscreen` (all from Task 1).
- Produces: the complete control bar UI — no further tasks build on new exports from this file; Task 3 only consumes the top-level `VideoPlayer` component itself.

- [ ] **Step 1: Add volume, speed, and speed-menu state**

```tsx
// platform/components/VideoPlayer.tsx — inside the VideoPlayer component, add alongside
// the existing useState calls from Task 1:
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const speedMenuRef = useRef<HTMLDivElement>(null)
  // Hover-preview tooltip on the scrub bar: hoverRatio is 0-1 position along the bar,
  // null when the pointer isn't over it. Separate from the drag/scrub state above —
  // hovering shows a preview without moving playback position.
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
```

- [ ] **Step 2: Add volume and speed handlers**

```tsx
// platform/components/VideoPlayer.tsx — add alongside the existing handlers from Task 1:
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
```

- [ ] **Step 3: Add the scrub bar and transport control bar to the JSX, replacing the closing `</div>` of the video/webcam wrapper**

```tsx
// platform/components/VideoPlayer.tsx — replace the component's return statement's final
// two lines:
//         )}
//       </div>
//     </div>
//   )
// }
// with:
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
```

- [ ] **Step 4: Verify TypeScript compiles with no new errors**

Run: `cd platform && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `17` (unchanged baseline).

- [ ] **Step 5: Commit**

```bash
git add platform/components/VideoPlayer.tsx
git commit -m "feat(platform): add scrub bar, volume, and playback speed controls to VideoPlayer"
```

---

### Task 3: Integrate `VideoPlayer` into the issue detail page

**Files:**
- Modify: `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`

**Interfaces:**
- Consumes: `VideoPlayer` component from `platform/components/VideoPlayer.tsx` (Tasks 1-2), `issue.videoUrl`, `issue.webcamUrl`, `issue.title` (existing `Issue` type fields).

- [ ] **Step 1: Add the import**

```tsx
// platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx — add alongside the
// existing `import { ReplayPlayer } from '@/components/ReplayPlayer'`:
import { VideoPlayer } from '@/components/VideoPlayer'
```

- [ ] **Step 2: Replace the inline video block**

```tsx
// platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx — replace the entire
// existing "Screen Recording (video)" block:
//
// {/* Screen Recording (video) */}
// {issue.videoUrl && (
//   <div className="flex flex-col gap-2">
//     <div className="flex items-center justify-between px-1">
//       <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Screen Recording</h2>
//     </div>
//     <div className="relative w-full rounded-lg overflow-hidden ring-1 ring-gray-200 bg-black" style={{ maxHeight: '480px' }}>
//       <video
//         controls
//         src={issue.videoUrl}
//         className="w-full block"
//         style={{ maxHeight: '480px' }}
//         onPlay={e => {
//           const webcam = (e.currentTarget.parentElement?.querySelector('video[data-webcam]') as HTMLVideoElement | null)
//           webcam?.play().catch(() => {})
//         }}
//         onPause={e => {
//           const webcam = (e.currentTarget.parentElement?.querySelector('video[data-webcam]') as HTMLVideoElement | null)
//           webcam?.pause()
//         }}
//         onSeeked={e => {
//           const webcam = (e.currentTarget.parentElement?.querySelector('video[data-webcam]') as HTMLVideoElement | null)
//           if (webcam) webcam.currentTime = e.currentTarget.currentTime
//         }}
//       />
//       {issue.webcamUrl && (
//         <video
//           data-webcam
//           src={issue.webcamUrl}
//           muted
//           className="absolute bottom-3 right-3 rounded-full ring-2 ring-white shadow-lg"
//           style={{ width: '120px', height: '120px', objectFit: 'cover' }}
//         />
//       )}
//     </div>
//   </div>
// )}
//
// with:
{issue.videoUrl && (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Screen Recording</h2>
    </div>
    <VideoPlayer videoUrl={issue.videoUrl} webcamUrl={issue.webcamUrl} issueTitle={issue.title ?? undefined} />
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles with no new errors**

Run: `cd platform && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `17` (unchanged baseline — this task only swaps markup, no new type errors expected).

- [ ] **Step 4: Commit**

```bash
git add "platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx"
git commit -m "feat(platform): use VideoPlayer component on the issue detail page"
```

---

### Task 4: Draggable, corner-snapping webcam overlay

**Files:**
- Modify: `platform/components/VideoPlayer.tsx`

**Interfaces:**
- Consumes: `webcamRef`, `wrapperRef` (from Task 1), the webcam `<video>` JSX block (from Task 1, modified here).
- Produces: no new exports — this is an internal interaction addition to the existing `VideoPlayer` component.

- [ ] **Step 1: Add corner state, initialized from `localStorage`**

```tsx
// platform/components/VideoPlayer.tsx — add this type alongside the other top-level
// declarations (near SPEEDS):
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
const WEBCAM_CORNER_KEY = 'qa-video-webcam-corner'
const VALID_CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

function loadSavedCorner(): Corner {
  if (typeof window === 'undefined') return 'bottom-right'
  const saved = window.localStorage.getItem(WEBCAM_CORNER_KEY)
  return (VALID_CORNERS as string[]).includes(saved ?? '') ? (saved as Corner) : 'bottom-right'
}

const CORNER_CLASSES: Record<Corner, string> = {
  'top-left': 'top-3 left-3',
  'top-right': 'top-3 right-3',
  'bottom-left': 'bottom-3 left-3',
  'bottom-right': 'bottom-3 right-3',
}
```

```tsx
// platform/components/VideoPlayer.tsx — inside the VideoPlayer component, add alongside
// the other useState calls from Tasks 1-2:
  const [corner, setCorner] = useState<Corner>(() => loadSavedCorner())
  const [dragging, setDragging] = useState(false)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
```

- [ ] **Step 2: Add the drag handlers**

```tsx
// platform/components/VideoPlayer.tsx — add alongside the other handlers from Tasks 1-2:
  const handleWebcamPointerDown = useCallback((e: React.PointerEvent<HTMLVideoElement>) => {
    e.preventDefault()
    const wrapper = wrapperRef.current
    if (!wrapper) return
    ;(e.target as HTMLVideoElement).setPointerCapture(e.pointerId)
    setDragging(true)

    const rect = wrapper.getBoundingClientRect()
    const webcamSize = 120

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
  }, [])
```

- [ ] **Step 3: Wire the drag handler and live position into the webcam `<video>` element**

```tsx
// platform/components/VideoPlayer.tsx — replace the existing webcam video block from Task 1:
//         {webcamUrl && (
//           <video
//             ref={webcamRef}
//             src={webcamUrl}
//             muted
//             className="absolute bottom-3 right-3 rounded-full ring-2 ring-white shadow-lg pointer-events-none"
//             style={{ width: '120px', height: '120px', objectFit: 'cover' }}
//           />
//         )}
// with:
        {webcamUrl && (
          <video
            ref={webcamRef}
            src={webcamUrl}
            muted
            onPointerDown={handleWebcamPointerDown}
            className={`absolute rounded-full ring-2 ring-white shadow-lg cursor-grab active:cursor-grabbing ${
              dragPosition ? '' : CORNER_CLASSES[corner]
            } ${dragging ? 'transition-none' : 'transition-[top,left,right,bottom] duration-150'}`}
            style={
              dragPosition
                ? { width: '120px', height: '120px', objectFit: 'cover', left: dragPosition.x, top: dragPosition.y }
                : { width: '120px', height: '120px', objectFit: 'cover' }
            }
          />
        )}
```

Note: this removes the `pointer-events-none` class the webcam video had in Task 1 — it needs to receive pointer events now to be draggable. This is intentional; the circle no longer needs to be click-through since dragging is now its primary interaction.

- [ ] **Step 4: Verify TypeScript compiles with no new errors**

Run: `cd platform && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `17` (unchanged baseline).

- [ ] **Step 5: Commit**

```bash
git add platform/components/VideoPlayer.tsx
git commit -m "feat(platform): make webcam overlay draggable with corner-snapping and persisted position"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Manual test — basic playback**

Run `cd platform && npm run dev` and `cd backend && npm run start:dev`. Open an issue with an attached video recording. Confirm the custom control bar renders (no native browser controls visible), click play — video plays, button icon swaps to pause; click pause — playback stops, icon swaps back.

- [ ] **Step 2: Manual test — seek bar**

Click and drag the seek bar to various positions. Confirm the video's playback position jumps to match, the filled portion of the bar updates live while dragging, and the time display (`0:42 / 3:15` format) updates correctly.

- [ ] **Step 3: Manual test — volume and speed**

Drag the volume slider — confirm audio level changes and the mute icon swaps to the muted variant at 0. Click the mute button — confirm it toggles independently of the slider position. Open the speed dropdown, select `2×` — confirm playback visibly speeds up and the button label updates to `2×`.

- [ ] **Step 4: Manual test — fullscreen with webcam overlay**

On an issue that has both `videoUrl` and `webcamUrl` (recorded with Capture Webcam enabled), click the fullscreen button. Confirm the player expands to fill the viewport, the webcam circle remains visible and synced (playing/paused/seeking in lockstep with the main video) throughout, and pressing `Escape` (or clicking the exit-fullscreen button) returns to the normal inline layout.

- [ ] **Step 5: Manual test — no webcam case**

On an issue with only `videoUrl` (no webcam recorded), confirm the player renders and functions identically minus the webcam circle — no broken layout or console errors from the absent `webcamUrl`.

- [ ] **Step 6: Manual test — draggable webcam corner-snapping and persistence**

Drag the webcam circle to each of the 4 corners in turn (inline layout) — confirm it follows the cursor while dragging and snaps cleanly to the nearest corner on release. Reload the page — confirm the circle reopens at the last-snapped corner (persisted via `localStorage`). Repeat the drag test in fullscreen mode — confirm the same drag/snap behavior works identically there. Open a different issue with its own video — confirm it also opens at the same globally-persisted corner (not reset to bottom-right), matching the spec's "one global preference" requirement.

- [ ] **Step 7: Final regression check**

Run: `cd platform && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `17` (unchanged from the pre-feature baseline established at plan-writing time).

Run: `cd backend && npx jest`
Expected: all existing tests still pass (10/10) — this feature touches no backend files, so this is a regression check, not new coverage.

- [ ] **Step 8: Commit final verification notes (if any fixes were needed)**

If any bugs were found and fixed during manual verification, commit those fixes with descriptive messages before considering the feature complete. If no fixes were needed, this task requires no commit.
