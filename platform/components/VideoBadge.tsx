'use client'

import { useState } from 'react'

interface VideoBadgeProps {
  thumbnailUrl?: string | null
}

export function VideoBadge({ thumbnailUrl }: VideoBadgeProps) {
  const [hovering, setHovering] = useState(false)

  return (
    <span
      className="relative inline-flex items-center justify-center"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-50 text-blue-500 text-xs"
        title="Video attached"
      >
        🎥
      </span>
      {hovering && (
        <span className="absolute z-10 left-1/2 -translate-x-1/2 bottom-full mb-2 rounded-lg shadow-lg border border-gray-200 bg-white p-1">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt="Video preview"
              className="w-28 h-16 object-cover rounded"
            />
          ) : (
            <span className="flex items-center justify-center w-28 h-16 rounded bg-gray-50 text-gray-300 text-2xl">
              🎥
            </span>
          )}
        </span>
      )}
    </span>
  )
}
