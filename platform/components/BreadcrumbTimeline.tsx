'use client';

import { useState, useMemo } from 'react';

export interface BreadcrumbItem {
  id?: string;
  category: 'click' | 'navigation' | 'http' | 'console' | 'input' | 'custom';
  message: string;
  timestamp: string | number;
  data?: Record<string, unknown>;
  level?: 'info' | 'warn' | 'error';
}

interface BreadcrumbTimelineProps {
  breadcrumbs: BreadcrumbItem[];
  crashTimestamp?: string | number;
  onSeekReplay?: (relativeMs: number) => void;
  className?: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; bg: string; text: string }> = {
  click:      { label: 'Click',      icon: '🖱️', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
  navigation: { label: 'Route',      icon: '🧭', bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700' },
  http:        { label: 'Network',    icon: '🌐', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  console:    { label: 'Console',    icon: '⚠️', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
  input:      { label: 'Input',      icon: '✍️', bg: 'bg-slate-100 border-slate-200', text: 'text-slate-700' },
  custom:     { label: 'Custom',     icon: '📌', bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700' },
};

export function BreadcrumbTimeline({
  breadcrumbs,
  crashTimestamp,
  onSeekReplay,
  className = '',
}: BreadcrumbTimelineProps) {
  const [filterCat, setFilterCat] = useState<string>('all');
  const [search, setSearch] = useState('');

  const baseCrashTs = useMemo(() => {
    if (crashTimestamp) {
      return typeof crashTimestamp === 'number' ? crashTimestamp : new Date(crashTimestamp).getTime();
    }
    if (breadcrumbs.length > 0) {
      const last = breadcrumbs[breadcrumbs.length - 1];
      return typeof last.timestamp === 'number' ? last.timestamp : new Date(last.timestamp).getTime();
    }
    return Date.now();
  }, [crashTimestamp, breadcrumbs]);

  const items = useMemo(() => {
    return breadcrumbs.map((b) => {
      const ts = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
      const diffSec = ((ts - baseCrashTs) / 1000).toFixed(1);
      const diffLabel = Number(diffSec) >= 0 ? `+${diffSec}s` : `${diffSec}s`;
      return {
        ...b,
        numericTs: ts,
        diffLabel,
        isError: b.level === 'error' || (b.category === 'http' && Number(b.data?.status) >= 400),
      };
    });
  }, [breadcrumbs, baseCrashTs]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filterCat !== 'all' && item.category !== filterCat) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          item.message.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          JSON.stringify(item.data || {}).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, filterCat, search]);

  if (breadcrumbs.length === 0) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400 ${className}`}>
        No breadcrumb events recorded leading to this issue.
      </div>
    );
  }

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xs ${className}`}>
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 sm:w-60">
          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search breadcrumbs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">✕</button>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterCat('all')}
            className={`rounded-md px-2 py-1 transition-colors ${
              filterCat === 'all' ? 'bg-indigo-600 text-white font-medium' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({breadcrumbs.length})
          </button>
          {['click', 'navigation', 'http', 'console'].map((cat) => {
            const count = items.filter((i) => i.category === cat).length;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setFilterCat(cat)}
                className={`rounded-md px-2 py-1 transition-colors ${
                  filterCat === cat ? 'bg-indigo-600 text-white font-medium' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {CATEGORY_CONFIG[cat]?.icon} {CATEGORY_CONFIG[cat]?.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Flight Recorder Timeline Stream */}
      <div className="relative max-h-80 divide-y divide-slate-50 overflow-y-auto font-mono">
        {filtered.map((item, idx) => {
          const cfg = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.custom;
          return (
            <div
              key={idx}
              className={`group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/80 ${
                item.isError ? 'bg-red-50/40' : ''
              }`}
            >
              {/* Relative Offset Chip */}
              <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                item.diffLabel === '0.0s' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {item.diffLabel}
              </span>

              {/* Category Icon Badge */}
              <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                <span>{cfg.icon}</span>
                <span>{cfg.label}</span>
              </span>

              {/* Message & Payload Details */}
              <div className="min-w-0 flex-1">
                <p className="break-all font-sans text-xs text-slate-800 leading-snug">
                  {item.message}
                </p>
                {item.data && Object.keys(item.data).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                    {Object.entries(item.data).map(([k, v]) => (
                      <span key={k} className="rounded bg-slate-100 px-1 py-0.2">
                        <span className="text-slate-400">{k}:</span> {String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Jump to Replay Button */}
              {onSeekReplay && (
                <button
                  onClick={() => {
                    const firstTs = items[0]?.numericTs || baseCrashTs;
                    const relMs = Math.max(0, item.numericTs - firstTs);
                    onSeekReplay(relMs);
                  }}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-all"
                  title="Scrub replay to this event"
                >
                  ▶ Seek
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
