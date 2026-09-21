'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { SyncButton } from '@/components/SyncButton';
import { ReplayPlayer, type ReplayMarker } from '@/components/ReplayPlayer';
import { VideoPlayer } from '@/components/VideoPlayer';
import { ConsoleLogViewer } from '@/components/ConsoleLogViewer';
import { NetworkLogViewer } from '@/components/NetworkLogViewer';
import { TriageStatusBadge } from '@/components/TriageStatusBadge';
import { AiRootCauseAnalysis } from '@/components/AiRootCauseAnalysis';
import { AiVisualAnomalyAnalysis } from '@/components/AiVisualAnomalyAnalysis';
import { StackTraceView } from '@/components/StackTraceView';
import { BreadcrumbTimeline, type BreadcrumbItem } from '@/components/BreadcrumbTimeline';
import type { Issue, IssueTriageStatus } from '@/lib/types';
import { PlayIcon } from '@/components/Icons';

// ── Helpers ──────────────────────────────────────────────────────────────────
const SEVERITY_CONFIG: Record<string, string> = {
  Critical: 'bg-red-100 text-red-700',
  critical: 'bg-red-100 text-red-700',
  High:     'bg-orange-100 text-orange-700',
  high:     'bg-orange-100 text-orange-700',
  Medium:   'bg-yellow-100 text-yellow-700',
  medium:   'bg-yellow-100 text-yellow-700',
  Low:      'bg-slate-100 text-slate-600',
  low:      'bg-slate-100 text-slate-600',
};

function formatMs(ms?: number) { return ms != null ? `${ms.toLocaleString()} ms` : '—'; }

// ── Lightbox ─────────────────────────────────────────────────────────────────
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];

function Lightbox({ images, initial, onClose }: { images: { src: string; label: string }[]; initial: number; onClose: () => void }) {
  const [idx, setIdx] = useState(initial);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [mounted, setMounted] = useState(false);
  const total = images.length;
  const zoom = ZOOM_STEPS[zoomIdx];

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setZoomIdx(2); }, [idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx(i => (i + 1) % total);
      if (e.key === 'ArrowLeft')  setIdx(i => (i - 1 + total) % total);
      if (e.key === '+' || e.key === '=') setZoomIdx(z => Math.min(z + 1, ZOOM_STEPS.length - 1));
      if (e.key === '-') setZoomIdx(z => Math.max(z - 1, 0));
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) setZoomIdx(z => Math.min(z + 1, ZOOM_STEPS.length - 1));
      else              setZoomIdx(z => Math.max(z - 1, 0));
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, [total, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black/95 backdrop-blur-md">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex items-center justify-between px-6 py-3 shrink-0">
        <div className="flex gap-2">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                i === idx ? 'bg-white text-gray-900 shadow-lg' : 'text-white/50 hover:text-white hover:bg-white/15 border border-white/15'
              }`}
            >
              {img.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full px-2 py-1 border border-white/15">
            <button onClick={() => setZoomIdx(z => Math.max(z - 1, 0))} disabled={zoomIdx === 0} className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-25 text-base">−</button>
            <span className="text-white/60 text-xs w-8 text-center cursor-pointer hover:text-white" onClick={() => setZoomIdx(2)}>{zoom === 1 ? '1×' : `${zoom}×`}</span>
            <button onClick={() => setZoomIdx(z => Math.min(z + 1, ZOOM_STEPS.length - 1))} disabled={zoomIdx === ZOOM_STEPS.length - 1} className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-25 text-base">+</button>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15 text-2xl">×</button>
        </div>
      </div>
      <div className="relative z-10 flex-1 overflow-auto p-8 flex items-center justify-center" onClick={e => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[idx].src}
          alt={images[idx].label}
          onClick={() => setZoomIdx(z => z < ZOOM_STEPS.length - 1 ? z + 1 : 2)}
          style={{ width: `${zoom * 800}px`, maxWidth: 'none' }}
          className="rounded-xl shadow-2xl transition-all cursor-zoom-in"
        />
      </div>
    </div>,
    document.body
  );
}

export default function IssueDetailPage({ params }: { params: { id: string; issueId: string } }) {
  const [activeMediaTab, setActiveMediaTab] = useState<'replay' | 'video' | 'screenshots'>('replay');
  const [activeInspectorTab, setActiveInspectorTab] = useState<'dom' | 'console' | 'network' | 'breadcrumbs' | 'env'>('dom');
  const [currentReplayMs, setCurrentReplayMs] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [copiedCursor, setCopiedCursor] = useState(false);

  const qc = useQueryClient();

  const { data: issue, isLoading, isError } = useQuery<Issue>({
    queryKey: ['issue', params.issueId],
    queryFn: () => api.get<Issue>(`/issues/${params.issueId}`),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: IssueTriageStatus) =>
      api.patch(`/issues/${params.issueId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue', params.issueId] });
      qc.invalidateQueries({ queryKey: ['issues', params.id] });
    },
  });

  // Calculate Breadcrumb Flight Recorder Items
  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    if (!issue) return [];
    const list: BreadcrumbItem[] = [];
    const meta = issue.metadata || {};

    // Navigation Events
    (meta.navigationHistory || []).forEach((nav, i) => {
      list.push({
        id: `nav-${i}`,
        category: 'navigation',
        message: `Navigated to ${nav.url}`,
        timestamp: nav.timestamp,
        data: { url: nav.url },
      });
    });

    // Network Transactions
    (meta.networkTransactions || []).forEach((tx, i) => {
      const s = typeof tx.status === 'number' ? tx.status : parseInt(String(tx.status), 10);
      list.push({
        id: `http-${i}`,
        category: 'http',
        message: `${tx.method || 'GET'} ${tx.url}`,
        timestamp: tx.timestamp || issue.created_at,
        level: !isNaN(s) && s >= 400 ? 'error' : 'info',
        data: { status: tx.status, duration: `${tx.duration}ms` },
      });
    });

    // Console Errors
    (meta.consoleErrors || []).forEach((err, i) => {
      list.push({
        id: `err-${i}`,
        category: 'console',
        message: err.message || 'Console Log',
        timestamp: err.timestamp || issue.created_at,
        level: err.level === 'warn' ? 'warn' : 'error',
      });
    });

    return list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [issue]);

  // Calculate Replay Timeline Markers
  const markers = useMemo<ReplayMarker[]>(() => {
    if (!issue) return [];
    const list: ReplayMarker[] = [];
    const meta = issue.metadata || {};
    const createdTs = new Date(issue.created_at).getTime();
    const replayBaseTs = createdTs - 60000; // estimated session start

    // Console Errors
    (meta.consoleErrors || []).forEach((err: { timestamp?: string; message?: string }, i: number) => {
      const errTs = err.timestamp ? new Date(err.timestamp).getTime() : replayBaseTs + (i + 1) * 10000;
      const relMs = Math.max(0, errTs - replayBaseTs);
      list.push({
        type: 'error',
        relativeMs: relMs,
        label: err.message ? err.message.slice(0, 40) : 'Console Error',
        details: err.message,
      });
    });

    // Failed Network Requests (4xx / 5xx)
    (meta.networkTransactions || [])
      .filter((tx) => {
        const s = typeof tx.status === 'number' ? tx.status : parseInt(String(tx.status), 10);
        return !isNaN(s) && s >= 400;
      })
      .forEach((tx) => {
        const s = typeof tx.status === 'number' ? tx.status : parseInt(String(tx.status), 10);
        const txTs = tx.timestamp ? new Date(tx.timestamp).getTime() : replayBaseTs + 15000;
        const relMs = Math.max(0, txTs - replayBaseTs);
        const urlStr = String(tx.url || '');
        list.push({
          type: 'network_error',
          relativeMs: relMs,
          label: `${s} ${urlStr.split('/').pop() || urlStr}`,
          details: `${tx.method || 'GET'} ${urlStr} failed with ${s}`,
        });
      });

    return list;
  }, [issue]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (isError || !issue) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
        <p className="font-semibold">Failed to load issue #{params.issueId}</p>
        <Link href={`/projects/${params.id}`} className="mt-2 inline-block text-sm text-indigo-600 underline">
          ← Back to Issues
        </Link>
      </div>
    );
  }

  const meta = issue.metadata || {};
  const hasReplay = Boolean(issue.replayUrl || issue.replay_storage_path);
  const hasVideo = Boolean(issue.videoUrl || issue.video_storage_path);
  const screenshots = [
    ...(issue.element_screenshot_url ? [{ src: issue.element_screenshot_url, label: 'Element Crop' }] : []),
    ...(issue.screenshot_url ? [{ src: issue.screenshot_url, label: 'Full Viewport' }] : []),
  ];

  const elementInfo = (issue.element_info || {}) as {
    react?: { componentName?: string };
    reactComponentName?: string;
    reactSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
    cssSelector?: string;
    xpath?: string;
    hierarchy?: string;
  };
  const reactComp = elementInfo.react?.componentName || elementInfo.reactComponentName || '';
  const reactSource = elementInfo.reactSource;
  const sourceLine = reactSource?.fileName ? `${reactSource.fileName}:${reactSource.lineNumber}` : null;

  const browserInfo = (issue.browser_info || {}) as {
    browser?: string;
    os?: string;
    viewport?: { width?: number | string; height?: number | string };
    devicePixelRatio?: number | string;
  };

  const copyCursorPrompt = () => {
    const prompt = `### Bug Context: ${issue.title || issue.description}
URL: ${issue.url || 'N/A'}
React Component: <${reactComp || 'Unknown'}>
Source File: ${sourceLine || 'N/A'}
Severity: ${issue.severity || 'Medium'}

Console Errors:
${(meta.consoleErrors || []).map((e: { message?: string }) => `- ${e.message}`).join('\n') || 'None'}

Failed Network Calls:
${(meta.networkTransactions || []).filter((t) => {
  const s = typeof t.status === 'number' ? t.status : parseInt(String(t.status), 10);
  return !isNaN(s) && s >= 400;
}).map((t) => `- ${t.method || 'GET'} ${t.url} (${t.status})`).join('\n') || 'None'}

Please diagnose and suggest the fix patch.`;

    navigator.clipboard.writeText(prompt);
    setCopiedCursor(true);
    setTimeout(() => setCopiedCursor(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href={`/projects/${params.id}`} className="text-xs text-slate-500 hover:text-indigo-600">
              ← Issues
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-mono font-semibold text-slate-400">#{issue.id.slice(0, 8)}</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">{issue.title || issue.description}</h1>
        </div>

        {/* Triage & Sync Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">Triage:</span>
            <TriageStatusBadge
              status={issue.triage_status || 'incoming'}
              onChange={(st) => updateStatusMutation.mutate(st)}
            />
          </div>
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_CONFIG[issue.severity || 'Medium'] || 'bg-slate-100 text-slate-700'}`}>
            {issue.severity || 'Medium'}
          </span>
          <SyncButton
            issueId={issue.id}
            projectId={params.id}
            currentStatus={issue.sync_status}
          />
        </div>
      </div>

      {/* 2-Column Split Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Media Hub (60% width on desktop) */}
        <div className="lg:col-span-7 space-y-4" id="tour-media-hub">
          {/* Media Mode Switcher */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div className="flex gap-2">
              {hasReplay && (
                <button
                  onClick={() => setActiveMediaTab('replay')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    activeMediaTab === 'replay'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <PlayIcon className="h-3.5 w-3.5" /> Replay (rrweb)
                </button>
              )}
              {hasVideo && (
                <button
                  onClick={() => setActiveMediaTab('video')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    activeMediaTab === 'video'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  📹 Screen Video
                </button>
              )}
              {screenshots.length > 0 && (
                <button
                  onClick={() => setActiveMediaTab('screenshots')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    activeMediaTab === 'screenshots'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  🖼 Screenshots ({screenshots.length})
                </button>
              )}
            </div>

            {/* Cursor / VS Code Quick Action */}
            <div className="flex items-center gap-2" id="tour-ide-prompt-btn">
              <button
                onClick={copyCursorPrompt}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
                title="Copy structured bug context prompt for Cursor/Copilot"
              >
                {copiedCursor ? '✓ Copied Prompt!' : '⚡ Copy for Cursor'}
              </button>
              {sourceLine && (
                <a
                  href={`vscode://file/${sourceLine}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-2xs hover:bg-slate-800"
                  title={`Open ${sourceLine} in VS Code`}
                >
                  VS Code ↗
                </a>
              )}
            </div>
          </div>

          {/* Media Player Viewport */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-950 shadow-md">
            {activeMediaTab === 'replay' && hasReplay && (
              <ReplayPlayer
                replayUrl={issue.replayUrl || ''}
                issueTitle={issue.title || issue.description}
                markers={markers}
                onTimeUpdate={(ms) => setCurrentReplayMs(ms)}
              />
            )}

            {activeMediaTab === 'video' && hasVideo && (
              <VideoPlayer
                videoUrl={issue.videoUrl || issue.video_storage_path || ''}
                webcamUrl={issue.webcamUrl || (issue as { webcam_storage_path?: string }).webcam_storage_path || null}
                issueTitle={issue.title || issue.description}
              />
            )}

            {activeMediaTab === 'screenshots' && screenshots.length > 0 && (
              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 bg-slate-900">
                {screenshots.map((img, i) => (
                  <div
                    key={i}
                    onClick={() => setLightboxIndex(i)}
                    className="group relative aspect-video cursor-zoom-in overflow-hidden rounded-xl border border-white/10 bg-black/40"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.src} alt={img.label} className="h-full w-full object-cover object-top transition-transform group-hover:scale-105" />
                    <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {img.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Description Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Bug Description</h3>
            <p className="mt-2 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{issue.description}</p>
          </div>

          {/* AI Root Cause Analysis (RCA) Panel */}
          <div id="tour-ai-rca-panel">
            <AiRootCauseAnalysis issue={issue} />
          </div>

          {/* AI Screenshot Visual Anomaly Analysis */}
          <AiVisualAnomalyAnalysis issue={issue} />
        </div>

        {/* RIGHT COLUMN: Tabbed DevTools Inspector (40% width) */}
        <div className="lg:col-span-5 space-y-4" id="tour-devtools-tabs">
          {/* Inspector Tab Selector */}
          <div className="flex border-b border-slate-200 overflow-x-auto">
            {[
              { id: 'dom', label: 'DOM & React' },
              { id: 'console', label: `Console (${meta.consoleErrors?.length ?? 0})` },
              { id: 'network', label: `Network (${meta.networkTransactions?.length ?? 0})` },
              { id: 'breadcrumbs', label: `Flight Recorder (${breadcrumbs.length})` },
              { id: 'env', label: 'Environment' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveInspectorTab(tab.id as 'dom' | 'console' | 'network' | 'breadcrumbs' | 'env')}
                className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  activeInspectorTab === tab.id
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab 1: DOM & React Inspection + Stack Trace */}
          {activeInspectorTab === 'dom' && (
            <div className="space-y-4">
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs text-xs">
                <div>
                  <span className="font-semibold text-slate-500">React Component:</span>
                  <p className="mt-1 font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                    &lt;{reactComp || 'Not detected (or non-React)'}&gt;
                  </p>
                </div>

                {sourceLine && (
                  <div>
                    <span className="font-semibold text-slate-500">Source Location:</span>
                    <p className="mt-1 font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded break-all">
                      {sourceLine}
                    </p>
                  </div>
                )}

                {elementInfo.cssSelector && (
                  <div>
                    <span className="font-semibold text-slate-500">CSS Selector (finder):</span>
                    <p className="mt-1 font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded break-all select-all">
                      {elementInfo.cssSelector}
                    </p>
                  </div>
                )}

                {elementInfo.xpath && (
                  <div>
                    <span className="font-semibold text-slate-500">XPath:</span>
                    <p className="mt-1 font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded break-all select-all">
                      {elementInfo.xpath}
                    </p>
                  </div>
                )}

                {elementInfo.hierarchy && (
                  <div>
                    <span className="font-semibold text-slate-500">DOM Hierarchy:</span>
                    <p className="mt-1 font-mono text-slate-600 bg-slate-50 px-2 py-1 rounded break-all">
                      {elementInfo.hierarchy}
                    </p>
                  </div>
                )}
              </div>

              {/* Smart Stack Trace View */}
              {meta.consoleErrors && meta.consoleErrors.length > 0 && (
                <StackTraceView
                  stack={meta.consoleErrors[0]?.message}
                  title="JavaScript Error Stack"
                />
              )}
            </div>
          )}

          {/* Tab 2: Synchronized Console Log Stream */}
          {activeInspectorTab === 'console' && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
              <ConsoleLogViewer
                logs={meta.consoleErrors || []}
                currentTimeMs={currentReplayMs}
              />
            </div>
          )}

          {/* Tab 3: Synchronized Network Requests */}
          {activeInspectorTab === 'network' && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
              <NetworkLogViewer
                transactions={meta.networkTransactions || []}
                currentTimeMs={currentReplayMs}
              />
            </div>
          )}

          {/* Tab 4: Breadcrumb Flight Recorder */}
          {activeInspectorTab === 'breadcrumbs' && (
            <BreadcrumbTimeline
              breadcrumbs={breadcrumbs}
              crashTimestamp={issue.created_at}
              onSeekReplay={(ms) => {
                setCurrentReplayMs(ms);
                setActiveMediaTab('replay');
              }}
            />
          )}

          {/* Tab 5: Environment & Performance Specs */}
          {activeInspectorTab === 'env' && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="font-semibold text-slate-500">Browser:</span>
                  <p className="text-slate-800 font-medium">{String(browserInfo.browser || 'Chrome')}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500">OS:</span>
                  <p className="text-slate-800 font-medium">{String(browserInfo.os || 'Mac OS')}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500">Viewport:</span>
                  <p className="font-mono text-slate-800">
                    {String(browserInfo.viewport?.width ?? 1440)}×{String(browserInfo.viewport?.height ?? 900)}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500">Device DPR:</span>
                  <p className="font-mono text-slate-800">{String(browserInfo.devicePixelRatio ?? 1)}x</p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <span className="font-semibold text-slate-500">URL:</span>
                <a href={issue.url || '#'} target="_blank" rel="noreferrer" className="mt-1 block font-mono text-indigo-600 underline truncate">
                  {issue.url || '—'}
                </a>
              </div>

              {meta.performanceMetrics && (
                <div className="border-t border-slate-100 pt-3">
                  <span className="font-semibold text-slate-500">Performance Timings:</span>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-400">TTFB</span>
                      <span className="font-mono font-bold text-slate-800">{formatMs(meta.performanceMetrics.ttfbMs)}</span>
                    </div>
                    <div className="rounded bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-400">First Paint</span>
                      <span className="font-mono font-bold text-slate-800">{formatMs(meta.performanceMetrics.firstPaintMs)}</span>
                    </div>
                    <div className="rounded bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-400">Page Load</span>
                      <span className="font-mono font-bold text-slate-800">{formatMs(meta.performanceMetrics.pageLoadMs)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxIndex !== null && (
        <Lightbox
          images={screenshots}
          initial={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
