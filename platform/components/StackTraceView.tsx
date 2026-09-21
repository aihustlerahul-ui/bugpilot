'use client';

import { useState, useMemo } from 'react';

export interface StackFrame {
  raw: string;
  functionName: string;
  fileName: string;
  lineNumber: number | null;
  columnNumber: number | null;
  isVendor: boolean;
}

interface StackTraceViewProps {
  stack?: string | null;
  title?: string;
  className?: string;
}

const VENDOR_PATTERNS = [
  /node_modules/i,
  /webpack-internal/i,
  /react-dom/i,
  /next\/dist/i,
  /@tanstack/i,
  /chunk-[a-z0-9]+/i,
  /\/_next\//i,
  /chrome-extension:\/\//i,
];

export function parseStackTrace(rawStack: string): StackFrame[] {
  if (!rawStack || typeof rawStack !== 'string') return [];
  const lines = rawStack.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Pattern: "at functionName (https://domain.com/path/file.js:12:34)"
    const matchWithFn = trimmed.match(/^at\s+(?:async\s+)?([^\s(]+)\s*\((.*?):(\d+):(\d+)\)$/);
    if (matchWithFn) {
      const [, fn, file, lineStr, colStr] = matchWithFn;
      const isVendor = VENDOR_PATTERNS.some((p) => p.test(file));
      frames.push({
        raw: trimmed,
        functionName: fn,
        fileName: file,
        lineNumber: parseInt(lineStr, 10),
        columnNumber: parseInt(colStr, 10),
        isVendor,
      });
      continue;
    }

    // Pattern: "at https://domain.com/path/file.js:12:34"
    const matchNoFn = trimmed.match(/^at\s+(?:async\s+)?(https?:\/\/[^:]+|webpack-internal:\/\/\/[^:]+|\/[^:]+):(\d+):(\d+)$/);
    if (matchNoFn) {
      const [, file, lineStr, colStr] = matchNoFn;
      const isVendor = VENDOR_PATTERNS.some((p) => p.test(file));
      frames.push({
        raw: trimmed,
        functionName: '<anonymous>',
        fileName: file,
        lineNumber: parseInt(lineStr, 10),
        columnNumber: parseInt(colStr, 10),
        isVendor,
      });
      continue;
    }

    // Fallback line
    frames.push({
      raw: trimmed,
      functionName: '',
      fileName: trimmed,
      lineNumber: null,
      columnNumber: null,
      isVendor: VENDOR_PATTERNS.some((p) => p.test(trimmed)),
    });
  }

  return frames;
}

type FrameGroup =
  | { type: 'app'; frame: StackFrame; index: number }
  | { type: 'vendor_group'; frames: StackFrame[]; startIndex: number };

export function StackTraceView({ stack, title, className = '' }: StackTraceViewProps) {
  const [viewMode, setViewMode] = useState<'smart' | 'raw'>('smart');
  const [expandedVendorGroups, setExpandedVendorGroups] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);

  const frames = useMemo(() => {
    if (!stack) return [];
    return parseStackTrace(stack);
  }, [stack]);

  // Group contiguous vendor frames
  const frameGroups = useMemo(() => {
    const groups: FrameGroup[] = [];
    let currentVendorCluster: StackFrame[] = [];
    let clusterStartIndex = 0;

    frames.forEach((frame, idx) => {
      if (frame.isVendor) {
        if (currentVendorCluster.length === 0) {
          clusterStartIndex = idx;
        }
        currentVendorCluster.push(frame);
      } else {
        if (currentVendorCluster.length > 0) {
          groups.push({
            type: 'vendor_group',
            frames: [...currentVendorCluster],
            startIndex: clusterStartIndex,
          });
          currentVendorCluster = [];
        }
        groups.push({ type: 'app', frame, index: idx });
      }
    });

    if (currentVendorCluster.length > 0) {
      groups.push({
        type: 'vendor_group',
        frames: [...currentVendorCluster],
        startIndex: clusterStartIndex,
      });
    }

    return groups;
  }, [frames]);

  if (!stack) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-center text-xs text-slate-400 ${className}`}>
        No stack trace available
      </div>
    );
  }

  const copyRaw = () => {
    navigator.clipboard.writeText(stack);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleGroup = (startIdx: number) => {
    setExpandedVendorGroups((prev) => ({
      ...prev,
      [startIdx]: !prev[startIdx],
    }));
  };

  const getCleanFileName = (path: string) => {
    try {
      const parts = path.split('?')[0].split('/');
      return parts.slice(-2).join('/');
    } catch {
      return path;
    }
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white font-mono text-xs shadow-xs ${className}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="font-semibold text-slate-800">{title || 'Stack Trace'}</span>
          <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            {frames.length} frames
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-200/70 p-0.5 text-[11px] font-medium">
            <button
              onClick={() => setViewMode('smart')}
              className={`rounded px-2 py-0.5 transition-colors ${
                viewMode === 'smart' ? 'bg-white text-indigo-700 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Smart Fold
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`rounded px-2 py-0.5 transition-colors ${
                viewMode === 'raw' ? 'bg-white text-indigo-700 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Raw
            </button>
          </div>

          <button
            onClick={copyRaw}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Frame Viewer */}
      {viewMode === 'raw' ? (
        <pre className="max-h-80 overflow-auto p-4 text-[11px] leading-relaxed text-slate-800 bg-slate-950 text-slate-100">
          {stack}
        </pre>
      ) : (
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {frameGroups.map((group, gIdx) => {
            if (group.type === 'app') {
              const f = group.frame;
              const cleanFile = getCleanFileName(f.fileName);
              return (
                <div
                  key={`app-${group.index}`}
                  className="group flex items-center justify-between gap-3 bg-red-50/30 px-4 py-2.5 hover:bg-red-50/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-red-700">{f.functionName || '<anonymous>'}</span>
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                        App Code
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-600" title={f.fileName}>
                      {cleanFile}
                      {f.lineNumber != null && (
                        <span className="font-bold text-indigo-600">:{f.lineNumber}:{f.columnNumber}</span>
                      )}
                    </p>
                  </div>

                  {f.lineNumber != null && (
                    <a
                      href={`vscode://file/${f.fileName}:${f.lineNumber}`}
                      onClick={(e) => e.stopPropagation()}
                      title="Open in VS Code"
                      className="rounded p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-700 transition-all"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .32 8.7l3.29 2.8-3.29 2.8a1 1 0 0 0 .007 1.439l1.322 1.202a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 21.06V3.94a1.5 1.5 0 0 0-.85-1.353z" />
                      </svg>
                    </a>
                  )}
                </div>
              );
            }

            // Vendor frames group
            const isExpanded = Boolean(expandedVendorGroups[group.startIndex]);
            return (
              <div key={`vendor-group-${gIdx}`} className="bg-slate-50/50">
                <button
                  onClick={() => toggleGroup(group.startIndex)}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] text-slate-500 hover:bg-slate-100/80 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">{isExpanded ? '▼' : '▶'}</span>
                    <span>
                      {group.frames.length} hidden vendor frame{group.frames.length > 1 ? 's' : ''}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ({group.frames.map((f) => getCleanFileName(f.fileName)).slice(0, 2).join(', ')}…)
                    </span>
                  </div>
                  <span className="text-[10px] text-indigo-600 font-medium">
                    {isExpanded ? 'Collapse' : 'Expand'}
                  </span>
                </button>

                {isExpanded && (
                  <div className="divide-y divide-slate-100/60 bg-white/60 pl-6 pr-4 py-1">
                    {group.frames.map((vf, vIdx) => (
                      <div key={vIdx} className="py-1.5 text-[10px] text-slate-500">
                        <span className="text-slate-700 font-semibold">{vf.functionName || '<anonymous>'}</span>{' '}
                        <span className="text-slate-400 truncate block" title={vf.fileName}>
                          {vf.fileName}:{vf.lineNumber}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
