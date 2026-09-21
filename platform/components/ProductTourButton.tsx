'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useProductTour, TourType, TOURS } from '@/lib/useProductTour'

export function ProductTourButton() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const { startTour } = useProductTour()
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Auto-detect best tour for current route
  function getContextTour(): TourType {
    if (!pathname) return 'dashboard'
    if (pathname.includes('/issues/')) return 'issueDetail'
    if (pathname.includes('/projects/')) return 'kanban'
    if (pathname.includes('/extension')) return 'extensionSettings'
    if (pathname.includes('/connectors') || pathname.includes('/integrations')) return 'connectors'
    return 'dashboard'
  }

  const currentTourType = getContextTour()
  const currentTour = TOURS[currentTourType]

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleStart(tourType: TourType) {
    setOpen(false)
    setTimeout(() => {
      startTour(tourType)
    }, 150)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100/80 transition-all shadow-sm"
        title="Interactive Product Tours & Guides"
      >
        <span className="text-sm">💡</span>
        <span>Guide &amp; Tours</span>
        <svg
          className={`w-3.5 h-3.5 text-blue-600 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-900 uppercase tracking-wider">Product Walkthroughs</p>
            <p className="text-[11px] text-gray-500">Interactive step-by-step feature guides</p>
          </div>

          <div className="py-1 space-y-1">
            {/* Context Recommended Tour */}
            <button
              type="button"
              onClick={() => handleStart(currentTourType)}
              className="w-full px-3 py-2 text-left rounded-lg bg-blue-50/80 hover:bg-blue-100 border border-blue-200/60 transition-colors flex items-start gap-2.5"
            >
              <span className="text-base mt-0.5">✨</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-900">{currentTour.name}</span>
                  <span className="text-[9px] bg-blue-200 text-blue-800 font-bold px-1.5 py-0.5 rounded uppercase">Current page</span>
                </div>
                <p className="text-[11px] text-blue-700 mt-0.5 line-clamp-1">{currentTour.description}</p>
              </div>
            </button>

            {/* Other Available Tours */}
            {(Object.keys(TOURS) as TourType[])
              .filter((t) => t !== currentTourType)
              .map((tourKey) => {
                const tour = TOURS[tourKey]
                return (
                  <button
                    key={tourKey}
                    type="button"
                    onClick={() => handleStart(tourKey)}
                    className="w-full px-3 py-2 text-left rounded-lg hover:bg-gray-50 transition-colors flex items-start gap-2.5 text-gray-700"
                  >
                    <span className="text-base mt-0.5">📖</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-gray-800 block">{tour.name}</span>
                      <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{tour.description}</p>
                    </div>
                  </button>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}
