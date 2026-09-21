'use client';

import React, { useState } from 'react';

export interface SparklineDataPoint {
  date: string;
  count: number;
}

interface SparklineChartProps {
  data: SparklineDataPoint[];
  width?: number;
  height?: number;
  strokeColor?: string;
  fillColor?: string;
  className?: string;
}

export function SparklineChart({
  data,
  width = 160,
  height = 48,
  strokeColor = '#3b82f6',
  fillColor = 'rgba(59, 130, 246, 0.12)',
  className = '',
}: SparklineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className={`flex items-center justify-center text-xs text-gray-400 ${className}`} style={{ width, height }}>
        No trend data
      </div>
    );
  }

  const padding = 6;
  const effectiveWidth = width - padding * 2;
  const effectiveHeight = height - padding * 2;

  const counts = data.map((d) => d.count);
  const max = Math.max(...counts, 1);
  const min = 0;

  const points = data.map((d, index) => {
    const x = padding + (index / (data.length - 1 || 1)) * effectiveWidth;
    const y = padding + effectiveHeight - ((d.count - min) / (max - min)) * effectiveHeight;
    return { x, y, data: d };
  });

  const pathD = points.reduce((acc, point, i) => {
    return i === 0 ? `M ${point.x} ${point.y}` : `${acc} L ${point.x} ${point.y}`;
  }, '');

  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  return (
    <div className={`relative inline-block ${className}`} style={{ width, height }}>
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity={0.4} />
            <stop offset="100%" stopColor={fillColor} stopOpacity={0.0} />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <path d={areaD} fill="url(#sparkline-gradient)" />
        {/* Line */}
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Hover / data points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hoverIndex === i ? 4 : 2.5}
              fill="#ffffff"
              stroke={strokeColor}
              strokeWidth={hoverIndex === i ? 2.5 : 1.5}
              className="transition-all duration-150 cursor-pointer"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          </g>
        ))}
      </svg>
      {/* Tooltip on point hover */}
      {hoverIndex !== null && (
        <div
          className="absolute z-20 -top-7 px-1.5 py-0.5 text-[10px] font-medium bg-gray-900 text-white rounded shadow-sm pointer-events-none transform -translate-x-1/2 whitespace-nowrap"
          style={{
            left: `${(points[hoverIndex].x / width) * 100}%`,
          }}
        >
          {points[hoverIndex].data.count} issues ({points[hoverIndex].data.date.slice(5)})
        </div>
      )}
    </div>
  );
}
