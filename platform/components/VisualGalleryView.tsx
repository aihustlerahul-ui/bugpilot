'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { Issue, IssueTriageStatus } from '@/lib/types';
import { TriageStatusBadge } from '@/components/TriageStatusBadge';
import { PlayIcon, TerminalIcon, LayersIcon } from '@/components/Icons';
import { VideoBadge } from '@/components/VideoBadge';

const SEVERITY_BADGES: Record<string, { label: string; cls: string }> = {
  Critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  High: { label: 'High', cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  high: { label: 'High', cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  Medium: { label: 'Medium', cls: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  medium: { label: 'Medium', cls: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  Low: { label: 'Low', cls: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
  low: { label: 'Low', cls: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
};

interface VisualGalleryViewProps {
  issues: Issue[];
  projectId: string;
  /** Omit for read-only status badges (e.g. project members, who cannot triage). */
  onUpdateStatus?: (issueId: string, status: IssueTriageStatus) => void;
}

export function VisualGalleryView({ issues, projectId, onUpdateStatus }: VisualGalleryViewProps) {
  const [selectedImage, setSelectedImage] = useState<{ url: string; title: string } | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {issues.map((issue) => {
          const imgUrl = issue.element_screenshot_url || issue.screenshot_url;
          const meta = issue.metadata || {};
          const consoleErrorCount = (meta.consoleErrors?.length ?? 0) + (meta.networkErrors?.length ?? 0);
          const failedNetworkCount = meta.networkTransactions?.filter(
            (tx: { status?: number | string }) => {
              const s = typeof tx.status === 'number' ? tx.status : parseInt(String(tx.status), 10);
              return !isNaN(s) && s >= 400;
            }
          ).length ?? 0;
          const elementInfo = (issue.element_info || {}) as {
            react?: { componentName?: string };
            reactComponentName?: string;
            reactSource?: { fileName?: string; lineNumber?: number };
          };
          const reactComp = elementInfo.react?.componentName || elementInfo.reactComponentName;
          const sourceLine = elementInfo.reactSource?.fileName
            ? `${elementInfo.reactSource.fileName}:${elementInfo.reactSource.lineNumber}`
            : null;

          return (
            <div
              key={issue.id}
              className="group flex flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xs transition-all hover:border-slate-300 hover:shadow-md"
            >
              {/* Image Preview / Lightbox Trigger */}
              <div className="relative aspect-video w-full overflow-hidden bg-slate-100">
                {imgUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgUrl}
                      alt={issue.title || 'Screenshot'}
                      className="h-full w-full object-cover object-top transition-transform group-hover:scale-105 cursor-pointer"
                      onClick={() => setSelectedImage({ url: imgUrl, title: issue.title || issue.description || 'Bug Screenshot' })}
                    />
                    <button
                      onClick={() => setSelectedImage({ url: imgUrl, title: issue.title || issue.description || 'Bug Screenshot' })}
                      className="absolute right-2 top-2 rounded bg-black/60 p-1 text-white opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 hover:bg-black/80"
                      title="Enlarge screenshot"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                      </svg>
                    </button>
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                    No screenshot captured
                  </div>
                )}

                {/* Top badges over image */}
                <div className="absolute left-2 top-2 flex items-center gap-1.5">
                  <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold shadow-xs backdrop-blur-xs ${
                    SEVERITY_BADGES[issue.severity || 'Medium']?.cls || 'bg-slate-100 text-slate-700'
                  }`}>
                    {issue.severity || 'Medium'}
                  </span>
                  {issue.sync_status === 'synced' && issue.external_ticket_id && (
                    <span className="inline-flex items-center rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs">
                      #{issue.external_ticket_id}
                    </span>
                  )}
                </div>
              </div>

              {/* Card Body */}
              <div className="flex flex-1 flex-col p-3.5">
                <Link
                  href={`/projects/${projectId}/issues/${issue.id}`}
                  className="font-semibold text-xs text-slate-900 line-clamp-2 hover:text-indigo-600"
                >
                  {issue.title || issue.description || 'Untitled Bug'}
                </Link>

                {/* React Component & Route */}
                {(reactComp || issue.route) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                    {reactComp && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-medium text-slate-700">
                        &lt;{reactComp}&gt;
                      </span>
                    )}
                    {issue.route && (
                      <span className="truncate max-w-[130px] font-mono text-slate-400">
                        {issue.route}
                      </span>
                    )}
                  </div>
                )}

                {/* Telemetry & Triage Status */}
                <div className="mt-auto pt-3 flex items-center justify-between border-t border-slate-100 text-[10px] text-slate-500">
                  <div className="flex items-center gap-2">
                    {issue.replay_storage_path && (
                      <span className="text-indigo-600" title="rrweb Replay">
                        <PlayIcon className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {issue.video_storage_path && (
                      <span className="text-blue-600" title="Screen Video">
                        <VideoBadge className="scale-75 origin-left" />
                      </span>
                    )}
                    {consoleErrorCount > 0 && (
                      <span className="flex items-center gap-0.5 text-red-600 font-semibold" title={`${consoleErrorCount} errors`}>
                        <TerminalIcon className="h-3.5 w-3.5" /> {consoleErrorCount}
                      </span>
                    )}
                    {failedNetworkCount > 0 && (
                      <span className="flex items-center gap-0.5 text-amber-600 font-semibold" title={`${failedNetworkCount} net fails`}>
                        <LayersIcon className="h-3.5 w-3.5" /> {failedNetworkCount}
                      </span>
                    )}
                    {sourceLine && (
                      <a
                        href={`vscode://file/${sourceLine}`}
                        className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
                        title={`Open in IDE (${sourceLine})`}
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .32 8.7l3.29 2.8-3.29 2.8a1 1 0 0 0 .007 1.439l1.322 1.202a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 21.06V3.94a1.5 1.5 0 0 0-.85-1.353z" />
                        </svg>
                      </a>
                    )}
                  </div>

                  <TriageStatusBadge
                    status={issue.triage_status || 'incoming'}
                    onChange={onUpdateStatus ? (st) => onUpdateStatus(issue.id, st) : undefined}
                    size="sm"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl bg-slate-900 p-2 shadow-2xl">
            <div className="mb-2 flex items-center justify-between px-2 text-white">
              <span className="text-sm font-semibold truncate max-w-md">{selectedImage.title}</span>
              <button
                onClick={() => setSelectedImage(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedImage.url}
              alt={selectedImage.title}
              className="max-h-[80vh] w-auto rounded object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
