'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api/client';
import { MobileInfo, MobileBadge, isMobileIssue } from '@/components/MobileInfo';
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
import type { Issue, IssueTriageStatus, Project } from '@/lib/types';
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

function formatDomBreadcrumb(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'object') {
          const obj = item as { tag?: string; id?: string; classes?: string[] | string; role?: string; nthOfType?: number };
          let str = obj.tag || 'element';
          if (obj.id) str += `#${obj.id}`;
          if (Array.isArray(obj.classes) && obj.classes.length > 0) {
            str += `.${obj.classes.join('.')}`;
          } else if (typeof obj.classes === 'string' && obj.classes) {
            str += `.${obj.classes}`;
          }
          if (obj.nthOfType && obj.nthOfType > 1) {
            str += `:nth-of-type(${obj.nthOfType})`;
          }
          return str;
        }
        return String(item);
      })
      .filter(Boolean)
      .join(' > ');
  }
  return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
}

async function copyImageToClipboard(imageUrl: string): Promise<boolean> {
  try {
    if (!imageUrl) return false;
    if (imageUrl.startsWith('data:image/')) {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      }
    }

    const res = await fetch(imageUrl, { mode: 'cors' });
    const blob = await res.blob();
    if (blob.type === 'image/png' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (pngBlob && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      return true;
    }
    await navigator.clipboard.writeText(imageUrl);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(imageUrl);
      return true;
    } catch {
      return false;
    }
  }
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];

function Lightbox({ images, initial, onClose }: { images: { src: string; label: string }[]; initial: number; onClose: () => void }) {
  const [idx, setIdx] = useState(initial);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [mounted, setMounted] = useState(false);
  const [copiedImg, setCopiedImg] = useState(false);
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

  const handleCopyImage = async () => {
    setCopiedImg(true);
    await copyImageToClipboard(images[idx].src);
    setTimeout(() => setCopiedImg(false), 2000);
  };

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
          <button
            onClick={handleCopyImage}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium bg-white/15 text-white hover:bg-white/25 border border-white/20 transition-colors"
            title="Copy image to clipboard"
          >
            {copiedImg ? '✓ Copied Image!' : '📋 Copy Image'}
          </button>
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

export default function IssueDetailPage() {
  const routeParams = useParams<{ id: string; issueId: string }>();
  const projectId = routeParams?.id || '';
  const issueId = routeParams?.issueId || '';

  const [activeMediaTab, setActiveMediaTab] = useState<'replay' | 'video' | 'screenshots'>('replay');
  const [activeInspectorTab, setActiveInspectorTab] = useState<'dom' | 'console' | 'network' | 'breadcrumbs' | 'env'>('dom');
  const [currentReplayMs, setCurrentReplayMs] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [copiedCursor, setCopiedCursor] = useState(false);
  const [copiedScreenshotIdx, setCopiedScreenshotIdx] = useState<number | null>(null);
  const [copiedScreenshotHeader, setCopiedScreenshotHeader] = useState(false);

  const qc = useQueryClient();

  // Role comes from the cached project; members cannot use owner-only integrations.
  const { data: project } = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
  });
  const isOwner = project?.role !== 'member';

  const { data: issue, isLoading, isError } = useQuery<Issue>({
    queryKey: ['issue', issueId],
    queryFn: () => api.get<Issue>(`/issues/${issueId}`),
    enabled: Boolean(issueId),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: IssueTriageStatus) =>
      api.patch(`/issues/${issueId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue', issueId] });
      qc.invalidateQueries({ queryKey: ['issues', projectId] });
    },
  });

  // Calculate Breadcrumb Flight Recorder Items
  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    if (!issue) return [];
    const list: BreadcrumbItem[] = [];
    const meta = issue.metadata || {};

    // Recorded User Interaction Steps
    (meta.recordedSteps || []).forEach((step, i) => {
      if (step.type === 'input') {
        list.push({
          id: `step-${i}`,
          category: 'input',
          message: `Entered text into ${step.selector || step.targetTag || 'input'}${step.value && step.value !== '***' ? ` ("${step.value}")` : ''}`,
          timestamp: step.timestamp || issue.created_at,
          data: { selector: step.selector, targetTag: step.targetTag, value: step.value },
        });
      } else if (step.type === 'navigate' || step.url) {
        list.push({
          id: `step-${i}`,
          category: 'navigation',
          message: `Navigated to ${step.url || step.route}`,
          timestamp: step.timestamp || issue.created_at,
          data: { url: step.url || step.route },
        });
      } else {
        list.push({
          id: `step-${i}`,
          category: 'click',
          message: `Clicked ${step.selector || step.targetTag || 'element'}${step.text ? ` ("${step.text.slice(0, 40)}")` : ''}`,
          timestamp: step.timestamp || issue.created_at,
          data: { selector: step.selector, text: step.text },
        });
      }
    });

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

  const screenshots = useMemo(() => {
    if (!issue) return [];
    const list: { src: string; label: string }[] = [];
    if (issue.element_screenshot_url) {
      list.push({ src: issue.element_screenshot_url, label: 'Element Crop' });
    }
    if (issue.screenshot_url) {
      list.push({ src: issue.screenshot_url, label: 'Full Viewport' });
    }
    const meta = issue.metadata || {};
    if (Array.isArray(meta.screenshots)) {
      meta.screenshots.forEach((s: { label?: string; url?: string }) => {
        if (s.url && s.url !== issue.element_screenshot_url && s.url !== issue.screenshot_url) {
          list.push({ src: s.url, label: s.label || 'Screenshot' });
        }
      });
    }
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
        <p className="font-semibold">Failed to load issue #{issueId}</p>
        <Link href={`/projects/${projectId}`} className="mt-2 inline-block text-sm text-indigo-600 underline">
          ← Back to Issues
        </Link>
      </div>
    );
  }

  const meta = issue.metadata || {};
  const isMobile = isMobileIssue(issue);
  const hasReplay = Boolean(issue.replayUrl || issue.replay_storage_path);
  const hasVideo = Boolean(issue.videoUrl || issue.video_storage_path);

  const elementInfo = (issue.element_info || {}) as {
    react?: { componentName?: string; componentTree?: string[]; props?: Record<string, unknown>; source?: { file?: string; line?: number; col?: number } };
    reactComponentName?: string;
    reactSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
    cssSelector?: string;
    selector?: string;
    xpath?: string;
    hierarchy?: string;
    domBreadcrumb?: string;
    tag?: string;
    tagName?: string;
    id?: string;
    text?: string;
    textContent?: string;
    classList?: string[];
    dataAttributes?: Record<string, unknown>;
    dimensions?: { width?: number; height?: number; top?: number; left?: number };
    accessibility?: { role?: string; name?: string };
    semanticContext?: { columnHeader?: string; formName?: string; fieldLabel?: string };
  };

  const reactComp = typeof (elementInfo.react?.componentName || elementInfo.reactComponentName) === 'string'
    ? (elementInfo.react?.componentName || elementInfo.reactComponentName)
    : '';
  const reactTree: string[] = Array.isArray(elementInfo.react?.componentTree)
    ? elementInfo.react.componentTree.map((t) => (typeof t === 'string' ? t : JSON.stringify(t)))
    : [];
  const reactSource = elementInfo.reactSource || (elementInfo.react?.source ? { fileName: elementInfo.react.source.file, lineNumber: elementInfo.react.source.line } : null);
  const sourceLine = reactSource?.fileName ? `${reactSource.fileName}:${reactSource.lineNumber || 1}` : null;
  const cssSelector = typeof (elementInfo.cssSelector || elementInfo.selector) === 'string' ? (elementInfo.cssSelector || elementInfo.selector) : '';
  const xpath = typeof elementInfo.xpath === 'string' ? elementInfo.xpath : '';
  const domHierarchy = formatDomBreadcrumb(elementInfo.domBreadcrumb || elementInfo.hierarchy);
  const elementTag = typeof (elementInfo.tagName || elementInfo.tag) === 'string' ? (elementInfo.tagName || elementInfo.tag) : '';
  const elementText = typeof (elementInfo.text || elementInfo.textContent) === 'string' ? (elementInfo.text || elementInfo.textContent) : '';
  const elementClasses: string[] = Array.isArray(elementInfo.classList)
    ? elementInfo.classList.map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))
    : typeof elementInfo.classList === 'string'
    ? [elementInfo.classList]
    : [];
  const elementId = typeof elementInfo.id === 'string' ? elementInfo.id : '';

  const browserInfo = (issue.browser_info || {}) as {
    browser?: string;
    os?: string;
    viewport?: { width?: number | string; height?: number | string };
    devicePixelRatio?: number | string;
  };

  const copyCursorPrompt = async () => {
    const consoleErrors = meta.consoleErrors || [];
    const networkTx = meta.networkTransactions || [];

    const failedNetworkCalls = networkTx.filter((t) => {
      const s = typeof t.status === 'number' ? t.status : parseInt(String(t.status), 10);
      return !isNaN(s) && s >= 400;
    });

    const recentSuccessfulCalls = networkTx.filter((t) => {
      const s = typeof t.status === 'number' ? t.status : parseInt(String(t.status), 10);
      return !isNaN(s) && s < 400;
    }).slice(-5);

    const recordedSteps = meta.recordedSteps || [];
    const navHistory = meta.navigationHistory || [];
    const pageContext = meta.pageContext || {};

    const sections: string[] = [];

    // 1. Bug Header & Overview
    sections.push(`### 🐛 Bug Report: ${issue.title || issue.description}`);
    sections.push(`- **Target URL / Route**: \`${issue.url || issue.route || 'N/A'}\``);
    if (issue.route && issue.url && issue.route !== issue.url) {
      sections.push(`- **Route Pattern**: \`${issue.route}\``);
    }
    sections.push(`- **Severity**: ${issue.severity || 'Medium'}`);
    if (issue.triage_status) {
      sections.push(`- **Triage Status**: ${issue.triage_status}`);
    }

    // 2. Description & Expected vs Actual
    sections.push(`\n### 📝 Description`);
    sections.push(issue.description || '(No description provided)');
    if (meta.expectedResult || meta.actualResult) {
      if (meta.expectedResult) sections.push(`- **Expected Result**: ${meta.expectedResult}`);
      if (meta.actualResult) sections.push(`- **Actual Result**: ${meta.actualResult}`);
    }

    // 3. Screenshots & Visual Evidence
    if (screenshots.length > 0) {
      const imgLines = screenshots.map((img) => `- **${img.label}**: ![${img.label}](${img.src})`);
      sections.push(`\n### 🖼️ Screenshots & Visual Evidence\n${imgLines.join('\n')}`);
    }

    // 4. Target Element & DOM Context
    const targetElementLines: string[] = [];
    if (reactComp) targetElementLines.push(`- **React Component**: \`<${reactComp}>\``);
    if (reactTree.length > 0) targetElementLines.push(`- **Component Hierarchy**: \`${reactTree.join(' > ')}\``);
    if (sourceLine) targetElementLines.push(`- **Source Location**: \`${sourceLine}\``);
    if (cssSelector) targetElementLines.push(`- **CSS Selector**: \`${cssSelector}\``);
    if (xpath) targetElementLines.push(`- **XPath**: \`${xpath}\``);
    if (domHierarchy) targetElementLines.push(`- **DOM Tree Path**: \`${domHierarchy}\``);
    if (elementTag || elementId || elementClasses.length > 0 || elementText) {
      const attrs = [
        elementTag ? `tag: <${elementTag}>` : '',
        elementId ? `id: #${elementId}` : '',
        elementClasses.length > 0 ? `class: .${elementClasses.join('.')}` : '',
        elementText ? `text: "${elementText.slice(0, 80)}"` : '',
      ].filter(Boolean).join(' | ');
      targetElementLines.push(`- **Element Attributes**: \`${attrs}\``);
    }
    if (elementInfo.accessibility?.role || elementInfo.accessibility?.name) {
      targetElementLines.push(`- **Accessibility**: Role \`${elementInfo.accessibility?.role || 'generic'}\`${elementInfo.accessibility?.name ? ` ("${elementInfo.accessibility.name}")` : ''}`);
    }
    if (targetElementLines.length > 0) {
      sections.push(`\n### 🎯 Target Element & DOM Context\n${targetElementLines.join('\n')}`);
    }

    // 5. Flight Recorder / Steps
    const reproLines: string[] = [];
    if (recordedSteps.length > 0) {
      recordedSteps.forEach((s, idx) => {
        if (s.type === 'input') {
          reproLines.push(`${idx + 1}. [Input] Typed \`${s.value && s.value !== '***' ? s.value : '***'}\` into \`${s.selector || s.targetTag || 'input'}\``);
        } else if (s.type === 'navigate' || s.url) {
          reproLines.push(`${idx + 1}. [Navigate] Navigated to \`${s.url || s.route}\``);
        } else {
          reproLines.push(`${idx + 1}. [Click] Clicked \`${s.selector || s.targetTag || 'element'}\`${s.text ? ` ("${s.text.slice(0, 40)}")` : ''}`);
        }
      });
    } else if (navHistory.length > 0) {
      navHistory.forEach((nav, idx) => {
        reproLines.push(`${idx + 1}. [Navigate] Navigated to \`${nav.url}\``);
      });
    }
    if (reproLines.length > 0) {
      sections.push(`\n### 🐾 Reproduction Flight Recorder\n${reproLines.join('\n')}`);
    }

    // 6. Network Transactions
    const netLines: string[] = [];
    if (failedNetworkCalls.length > 0) {
      netLines.push('**Failed Network Calls (>= 400):**');
      failedNetworkCalls.forEach((t) => {
        netLines.push(`- \`${t.method || 'GET'} ${t.url}\` -> **HTTP ${t.status}** (${t.duration || 0}ms)${t.error ? ` [Error: ${t.error}]` : ''}`);
      });
    }
    if (recentSuccessfulCalls.length > 0) {
      netLines.push('**Recent API Transactions (200 OK):**');
      recentSuccessfulCalls.forEach((t) => {
        let line = `- \`${t.method || 'GET'} ${t.url}\` -> HTTP ${t.status} (${t.duration || 0}ms)`;
        if (t.responseBody) {
          const bodyStr = typeof t.responseBody === 'string' ? t.responseBody : JSON.stringify(t.responseBody);
          line += `\n  - Response body: \`${bodyStr.slice(0, 160)}\``;
        }
        netLines.push(line);
      });
    }
    if (netLines.length > 0) {
      sections.push(`\n### 🌐 Network Activity\n${netLines.join('\n')}`);
    }

    // 7. Console Errors & Warnings
    if (consoleErrors.length > 0) {
      const errLines = consoleErrors.map((e) => `- [${(e.level || 'ERROR').toUpperCase()}] ${e.message}`);
      sections.push(`\n### ⚠️ Console Logs & Errors\n${errLines.join('\n')}`);
    }

    // 8. Environment & State
    const envLines: string[] = [];
    if (browserInfo.browser || browserInfo.os) {
      envLines.push(`- **Browser/OS**: ${browserInfo.browser || 'Chrome'} on ${browserInfo.os || 'OS'} (Viewport: ${browserInfo.viewport?.width || 1440}×${browserInfo.viewport?.height || 900}, DPR: ${browserInfo.devicePixelRatio || 1}x)`);
    }
    if (pageContext.queryParams && Object.keys(pageContext.queryParams).length > 0) {
      envLines.push(`- **Query Params**: \`${JSON.stringify(pageContext.queryParams)}\``);
    }
    if (pageContext.localStorageKeys && pageContext.localStorageKeys.length > 0) {
      envLines.push(`- **LocalStorage Keys**: \`${pageContext.localStorageKeys.join(', ')}\``);
    }
    if (envLines.length > 0) {
      sections.push(`\n### 🖥️ Environment & State\n${envLines.join('\n')}`);
    }

    // 9. AI Diagnostic Hypothesis
    const rcaHypothesis = failedNetworkCalls.length > 0
      ? `The component state failed because upstream endpoint \`${failedNetworkCalls[0].url}\` returned HTTP ${failedNetworkCalls[0].status}. Check error boundary or fallback state handling.`
      : consoleErrors.length > 0
      ? `A client-side runtime error occurred: "${consoleErrors[0].message.slice(0, 120)}". Check for unhandled null/undefined values or missing state checks.`
      : `This is a UI logic, state-management, or data-mapping bug on route \`${issue.route || issue.url || '/'}\`. Inspect the component rendering \`${cssSelector || reactComp || 'target element'}\` to verify why the rendered state/status diverges from expectations.`;

    sections.push(`\n### 💡 Diagnostic Hypothesis\n${rcaHypothesis}`);

    // 10. Task Directive
    sections.push(`\n### 🛠️ Task for Cursor / Copilot
1. Locate the component file for \`${sourceLine || reactComp || cssSelector || issue.route || 'the target element'}\`.
2. Trace the data flow and state rendering for the target element.
3. Diagnose and fix the root cause with defensive checks.`);

    const prompt = sections.join('\n');
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const html = `
          <h2>🐛 Bug Report: ${issue.title || issue.description}</h2>
          <p><b>Target URL:</b> ${issue.url || issue.route || 'N/A'}</p>
          <p><b>Severity:</b> ${issue.severity || 'Medium'}</p>
          ${screenshots.map((s) => `<div><p><b>${s.label}:</b></p><img src="${s.src}" alt="${s.label}" style="max-width: 600px; border-radius: 8px; margin: 8px 0;" /></div>`).join('')}
          <pre style="white-space: pre-wrap; font-family: monospace;">${prompt}</pre>
        `;
        const textBlob = new Blob([prompt], { type: 'text/plain' });
        const htmlBlob = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(prompt);
      }
    } catch {
      await navigator.clipboard.writeText(prompt);
    }
    setCopiedCursor(true);
    setTimeout(() => setCopiedCursor(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href={`/projects/${projectId}`} className="text-xs text-slate-500 hover:text-indigo-600">
              ← Issues
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-mono font-semibold text-slate-400">#{issue.id.slice(0, 8)}</span>
            {isMobile && <MobileBadge />}
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
          {isOwner && (
            <SyncButton
              issueId={issue.id}
              projectId={projectId}
              currentStatus={issue.sync_status}
            />
          )}
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

            {/* Cursor / VS Code / Screenshot Quick Action */}
            <div className="flex items-center gap-2" id="tour-ide-prompt-btn">
              {screenshots.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    setCopiedScreenshotHeader(true);
                    await copyImageToClipboard(screenshots[0].src);
                    setTimeout(() => setCopiedScreenshotHeader(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
                  title="Copy primary screenshot image directly to clipboard"
                >
                  {copiedScreenshotHeader ? '✓ Copied Image!' : '🖼️ Copy Image'}
                </button>
              )}
              <button
                onClick={copyCursorPrompt}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
                title="Copy structured bug context prompt with screenshots for Cursor/Copilot"
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
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        setCopiedScreenshotIdx(i);
                        await copyImageToClipboard(img.src);
                        setTimeout(() => setCopiedScreenshotIdx(null), 2000);
                      }}
                      className="absolute top-2 right-2 rounded-md bg-black/75 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/95 shadow-sm border border-white/15"
                      title="Copy this image to clipboard"
                    >
                      {copiedScreenshotIdx === i ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Description Card with Expected/Actual */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Bug Description</h3>
              <p className="mt-1.5 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{issue.description}</p>
            </div>

            {(meta.expectedResult || meta.actualResult) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                {meta.expectedResult && (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 text-xs">
                    <span className="font-bold text-emerald-800 block text-[11px] uppercase tracking-wide">✓ Expected Behavior</span>
                    <p className="mt-1 text-slate-700 leading-relaxed">{meta.expectedResult}</p>
                  </div>
                )}
                {meta.actualResult && (
                  <div className="rounded-lg border border-rose-100 bg-rose-50/50 p-3 text-xs">
                    <span className="font-bold text-rose-800 block text-[11px] uppercase tracking-wide">✗ Actual Behavior</span>
                    <p className="mt-1 text-slate-700 leading-relaxed">{meta.actualResult}</p>
                  </div>
                )}
              </div>
            )}
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
          {isMobile && <MobileInfo issue={issue} />}

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

                {reactTree.length > 0 && (
                  <div>
                    <span className="font-semibold text-slate-500">Component Hierarchy:</span>
                    <p className="mt-1 font-mono text-[11px] text-indigo-700 bg-indigo-50/60 px-2 py-1 rounded break-all">
                      {reactTree.join(' > ')}
                    </p>
                  </div>
                )}

                {sourceLine && (
                  <div>
                    <span className="font-semibold text-slate-500">Source Location:</span>
                    <p className="mt-1 font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded break-all">
                      {sourceLine}
                    </p>
                  </div>
                )}

                {(elementTag || elementId || elementClasses.length > 0 || elementText) && (
                  <div>
                    <span className="font-semibold text-slate-500">Element Attributes &amp; Text:</span>
                    <div className="mt-1 rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700 space-y-1">
                      {elementTag && <div><span className="text-slate-400">Tag:</span> &lt;{elementTag}&gt;</div>}
                      {elementId && <div><span className="text-slate-400">ID:</span> #{elementId}</div>}
                      {elementClasses.length > 0 && <div><span className="text-slate-400">Classes:</span> .{elementClasses.join(' .')}</div>}
                      {elementText && <div><span className="text-slate-400">Text:</span> &ldquo;{elementText.slice(0, 120)}&rdquo;</div>}
                    </div>
                  </div>
                )}

                {cssSelector && (
                  <div>
                    <span className="font-semibold text-slate-500">CSS Selector (finder):</span>
                    <p className="mt-1 font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded break-all select-all">
                      {cssSelector}
                    </p>
                  </div>
                )}

                {xpath && (
                  <div>
                    <span className="font-semibold text-slate-500">XPath:</span>
                    <p className="mt-1 font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded break-all select-all">
                      {xpath}
                    </p>
                  </div>
                )}

                {domHierarchy && (
                  <div>
                    <span className="font-semibold text-slate-500">DOM Hierarchy:</span>
                    <p className="mt-1 font-mono text-slate-600 bg-slate-50 px-2 py-1 rounded break-all">
                      {domHierarchy}
                    </p>
                  </div>
                )}

                {(elementInfo.accessibility || elementInfo.dimensions) && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                    {elementInfo.accessibility && (
                      <div>
                        <span className="font-semibold text-slate-400 text-[10px] uppercase">A11y Role</span>
                        <p className="mt-0.5 font-mono text-slate-700">
                          {elementInfo.accessibility.role || 'generic'}
                        </p>
                      </div>
                    )}
                    {elementInfo.dimensions && (
                      <div>
                        <span className="font-semibold text-slate-400 text-[10px] uppercase">Dimensions</span>
                        <p className="mt-0.5 font-mono text-slate-700">
                          {elementInfo.dimensions.width}×{elementInfo.dimensions.height}px
                        </p>
                      </div>
                    )}
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
              {!isMobile && (
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
              )}

              <div className="border-t border-slate-100 pt-3 space-y-2">
                {issue.url ? (
                  <div>
                    <span className="font-semibold text-slate-500">Target URL:</span>
                    <a href={issue.url} target="_blank" rel="noreferrer" className="mt-0.5 block font-mono text-indigo-600 underline truncate">
                      {issue.url}
                    </a>
                  </div>
                ) : !isMobile ? (
                  <div>
                    <span className="font-semibold text-slate-500">Target URL:</span>
                    <p className="mt-0.5 font-mono text-slate-700">—</p>
                  </div>
                ) : null}
                {issue.route && issue.route !== issue.url && (
                  <div>
                    <span className="font-semibold text-slate-500">{isMobile ? 'Screen:' : 'Route Pattern:'}</span>
                    <p className="mt-0.5 font-mono text-slate-700">{issue.route}</p>
                  </div>
                )}
              </div>

              {meta.pageContext && (
                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <span className="font-semibold text-slate-500">Page Context &amp; Storage:</span>
                  {meta.pageContext.queryParams && Object.keys(meta.pageContext.queryParams).length > 0 && (
                    <div className="rounded bg-slate-50 p-2 font-mono text-[11px]">
                      <span className="text-slate-400 block text-[10px]">Query Parameters:</span>
                      <pre className="text-slate-700 whitespace-pre-wrap">{JSON.stringify(meta.pageContext.queryParams, null, 2)}</pre>
                    </div>
                  )}
                  {meta.pageContext.localStorageKeys && meta.pageContext.localStorageKeys.length > 0 && (
                    <div className="rounded bg-slate-50 p-2 font-mono text-[11px]">
                      <span className="text-slate-400 block text-[10px]">LocalStorage Keys:</span>
                      <span className="text-slate-700">{meta.pageContext.localStorageKeys.join(', ')}</span>
                    </div>
                  )}
                  {meta.pageContext.sessionStorageKeys && meta.pageContext.sessionStorageKeys.length > 0 && (
                    <div className="rounded bg-slate-50 p-2 font-mono text-[11px]">
                      <span className="text-slate-400 block text-[10px]">SessionStorage Keys:</span>
                      <span className="text-slate-700">{meta.pageContext.sessionStorageKeys.join(', ')}</span>
                    </div>
                  )}
                </div>
              )}

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
