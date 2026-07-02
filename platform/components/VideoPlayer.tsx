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
