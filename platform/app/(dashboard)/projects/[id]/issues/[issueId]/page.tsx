'use client'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { api } from '@/lib/api/client'
import { SyncButton } from '@/components/SyncButton'
import type { Issue } from '@/lib/types'

// ── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  synced:  { label: 'Synced',  cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  failed:  { label: 'Failed',  cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
}

const SEVERITY_CONFIG: Record<string, string> = {
  Critical: 'bg-red-100 text-red-700',
  High:     'bg-orange-100 text-orange-700',
  Medium:   'bg-yellow-100 text-yellow-700',
  Low:      'bg-gray-100 text-gray-600',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatMs(ms?: number) { return ms != null ? `${ms.toLocaleString()} ms` : '—' }
function formatBytes(b?: number) { return b != null ? `${(b / 1024).toFixed(1)} KB` : '—' }

// ── Lightbox ─────────────────────────────────────────────────────────────────
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3]

function Lightbox({ images, initial, onClose }: { images: { src: string; label: string }[]; initial: number; onClose: () => void }) {
  const [idx, setIdx] = useState(initial)
  const [zoomIdx, setZoomIdx] = useState(2)
  const [mounted, setMounted] = useState(false)
  const total = images.length
  const zoom = ZOOM_STEPS[zoomIdx]
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setZoomIdx(2) }, [idx])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIdx(i => (i + 1) % total)
      if (e.key === 'ArrowLeft')  setIdx(i => (i - 1 + total) % total)
      if (e.key === '+' || e.key === '=') setZoomIdx(z => Math.min(z + 1, ZOOM_STEPS.length - 1))
      if (e.key === '-') setZoomIdx(z => Math.max(z - 1, 0))
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY < 0) setZoomIdx(z => Math.min(z + 1, ZOOM_STEPS.length - 1))
      else              setZoomIdx(z => Math.max(z - 1, 0))
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); window.removeEventListener('wheel', onWheel) }
  }, [total, onClose])
  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col" style={{ backgroundColor: 'rgba(0,0,0,0.93)' }}>
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex items-center justify-between px-6 py-3 shrink-0">
        <div className="flex gap-2">
          {images.map((img, i) => (
            <button key={i} onClick={() => setIdx(i)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${i === idx ? 'bg-white text-gray-900 shadow-lg' : 'text-white/50 hover:text-white hover:bg-white/15'}`} style={i === idx ? {} : { border: '1px solid rgba(255,255,255,0.15)' }}>{img.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full px-2 py-1" style={{ border: '1px solid rgba(255,255,255,0.15)' }}>
            <button onClick={() => setZoomIdx(z => Math.max(z - 1, 0))} disabled={zoomIdx === 0} className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-25 text-base">−</button>
            <span className="text-white/60 text-xs w-8 text-center cursor-pointer hover:text-white" onClick={() => setZoomIdx(2)}>{zoom === 1 ? '1×' : `${zoom}×`}</span>
            <button onClick={() => setZoomIdx(z => Math.min(z + 1, ZOOM_STEPS.length - 1))} disabled={zoomIdx === ZOOM_STEPS.length - 1} className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-25 text-base">+</button>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15 text-2xl">×</button>
        </div>
      </div>
      <div className="relative z-10 flex-1 overflow-auto" onClick={e => e.stopPropagation()} style={{ scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
        <div style={{ display: 'inline-flex', minWidth: '100%', minHeight: '100%', alignItems: 'center', justifyContent: 'center', padding: '32px', boxSizing: 'border-box' }}>
          <div style={{ borderRadius: '12px', overflow: 'hidden', boxShadow: '0 0 0 1px rgba(255,255,255,0.07), 0 24px 80px rgba(0,0,0,0.7)', flexShrink: 0 }}>
            <img src={images[idx].src} alt={images[idx].label} onClick={() => setZoomIdx(z => z < ZOOM_STEPS.length - 1 ? z + 1 : 2)} style={{ display: 'block', width: `${zoom * 800}px`, maxWidth: 'none', height: 'auto', cursor: zoom < ZOOM_STEPS.length - 1 ? 'zoom-in' : 'zoom-out', transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)' }} />
          </div>
        </div>
      </div>
      {total > 1 && (
        <>
          <button className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 flex items-center justify-center rounded-full text-white text-2xl hover:bg-white/15" style={{ border: '1px solid rgba(255,255,255,0.2)' }} onClick={e => { e.stopPropagation(); setIdx(i => (i - 1 + total) % total) }}>‹</button>
          <button className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 flex items-center justify-center rounded-full text-white text-2xl hover:bg-white/15" style={{ border: '1px solid rgba(255,255,255,0.2)' }} onClick={e => { e.stopPropagation(); setIdx(i => (i + 1) % total) }}>›</button>
        </>
      )}
      <div className="relative z-10 text-center pb-4 shrink-0">
        <p className="text-white/25 text-xs select-none">{total > 1 ? `${idx + 1} / ${total}  ·  ← → to switch  ·  ` : ''}scroll or +/− to zoom  ·  Esc to close</p>
      </div>
    </div>,
    document.body,
  )
}

// ── Shared UI pieces ──────────────────────────────────────────────────────────
function SectionCard({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm group" open={defaultOpen}>
      <summary className="px-5 py-4 flex items-center justify-between cursor-pointer list-none select-none">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h2>
        <svg className="w-4 h-4 text-gray-300 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </summary>
      <div className="border-t border-gray-100">{children}</div>
    </details>
  )
}

function KVRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5 border-b border-gray-50 last:border-0 px-5">
      <span className="w-36 flex-shrink-0 text-xs font-medium text-gray-400 uppercase tracking-wide pt-0.5">{label}</span>
      <span className="text-sm text-gray-700 break-all flex-1">{value}</span>
    </div>
  )
}

function CodeBlock({ children }: { children: string }) {
  return <code className="text-xs bg-gray-50 text-gray-700 px-1.5 py-0.5 rounded font-mono">{children}</code>
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IssueDetailPage({ params }: { params: { id: string; issueId: string } }) {
  const { data: issue, isLoading } = useQuery<Issue>({
    queryKey: ['issue', params.issueId],
    queryFn: () => api.get<Issue>(`/issues/${params.issueId}`),
  })

  const [lightbox, setLightbox] = useState<{ images: { src: string; label: string }[]; idx: number } | null>(null)
  const closeLightbox = useCallback(() => setLightbox(null), [])

  if (isLoading) return (
    <div className="flex items-center gap-2 text-gray-400 text-sm">
      <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />Loading…
    </div>
  )
  if (!issue) return <div className="text-red-500 text-sm">Issue not found</div>

  const meta = issue.metadata ?? {}
  const metaScreenshots = (meta as Record<string, unknown>).screenshots
  const screenshots: { src: string; label: string }[] = Array.isArray(metaScreenshots) && metaScreenshots.length > 0
    // New path: all images stored in metadata.screenshots (no limit)
    ? (metaScreenshots as { label: string; url: string }[]).filter(s => s.url).map(s => ({ src: s.url, label: s.label }))
    // Legacy fallback: two fixed columns
    : [
        issue.screenshot_url         && { src: issue.screenshot_url,         label: 'Element View' },
        issue.element_screenshot_url && { src: issue.element_screenshot_url, label: 'Full Page' },
      ].filter(Boolean) as { src: string; label: string }[]

  const st  = STATUS_CONFIG[issue.sync_status] ?? STATUS_CONFIG.pending
  const sev = issue.severity ?? 'Medium'
  const el   = (issue.element_info ?? {}) as Record<string, unknown>
  const env  = (issue.browser_info ?? {}) as Record<string, unknown>

  // Derive title and body — handle both old single-field and new split format
  const displayTitle = issue.title || issue.description.split('\n')[0]
  const bodyText = issue.title
    ? issue.description.replace(issue.title, '').replace(/^\n+/, '').trim()
    : issue.description.split('\n').slice(1).join('\n').trim()

  return (
    <>
      {lightbox && <Lightbox images={lightbox.images} initial={lightbox.idx} onClose={closeLightbox} />}

      <div className="max-w-4xl space-y-5 pb-16">
        <Link href={`/projects/${params.id}`} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ← Back to issues
        </Link>

        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${SEVERITY_CONFIG[sev] ?? SEVERITY_CONFIG.Medium}`}>{sev}</span>
                {meta.priority && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">P: {meta.priority}</span>}
                {meta.environment && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{meta.environment}</span>}
                <span className="text-xs text-gray-400">{formatDate(issue.created_at)}</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">{displayTitle}</h1>
              {bodyText && <p className="mt-2 text-sm text-gray-600 leading-relaxed whitespace-pre-line">{bodyText}</p>}

              {/* Optional form fields */}
              {(meta.expectedResult || meta.actualResult) && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {meta.expectedResult && (
                    <div className="bg-green-50 rounded-lg px-4 py-3">
                      <p className="text-xs font-semibold text-green-700 mb-1">Expected</p>
                      <p className="text-sm text-green-900">{meta.expectedResult}</p>
                    </div>
                  )}
                  {meta.actualResult && (
                    <div className="bg-red-50 rounded-lg px-4 py-3">
                      <p className="text-xs font-semibold text-red-700 mb-1">Actual</p>
                      <p className="text-sm text-red-900">{meta.actualResult}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Labels / Sprint / Assignee */}
              <div className="flex flex-wrap gap-2 mt-3">
                {meta.labels?.map(l => <span key={l} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{l}</span>)}
                {meta.sprint    && <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">Sprint: {meta.sprint}</span>}
                {meta.assignee  && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">→ {meta.assignee}</span>}
              </div>
            </div>
            <div className="shrink-0">
              <SyncButton issueId={issue.id} projectId={params.id} currentStatus={issue.sync_status} />
            </div>
          </div>
          {issue.external_ticket_url?.startsWith('https://') && (
            <a href={issue.external_ticket_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium">
              View in Azure DevOps ↗
            </a>
          )}
        </div>

        {/* Screenshots */}
        {screenshots.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Screenshots <span className="text-gray-300 font-normal normal-case">{screenshots.length} image{screenshots.length !== 1 ? 's' : ''}</span></h2>
              <span className="text-xs text-gray-300">Click to enlarge</span>
            </div>
            <div className={`p-4 grid gap-3 ${screenshots.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {screenshots.map((s, i) => (
                <button key={i} onClick={() => setLightbox({ images: screenshots, idx: i })} className="group relative overflow-hidden rounded-lg border border-gray-100 hover:border-blue-300 transition-all hover:shadow-md cursor-zoom-in text-left">
                  <img src={s.src} alt={s.label} className="w-full h-48 object-cover object-top" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">Expand</span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-3">
                    <span className="text-white text-xs font-medium">{s.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Page Context */}
        <SectionCard title="Page Context" defaultOpen>
          <KVRow label="URL"    value={issue.url ?? '—'} />
          <KVRow label="Route"  value={meta.pageContext?.route ?? issue.route ?? '—'} />
          {meta.pageContext?.title && <KVRow label="Page Title" value={meta.pageContext.title} />}
          {meta.pageContext?.hash  && <KVRow label="Hash"       value={meta.pageContext.hash} />}
          {meta.pageContext?.scrollPosition && <KVRow label="Scroll" value={`x: ${meta.pageContext.scrollPosition.x}, y: ${meta.pageContext.scrollPosition.y}`} />}
          {meta.pageContext?.queryParams && Object.keys(meta.pageContext.queryParams).length > 0 && (
            <KVRow label="Query Params" value={
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(meta.pageContext.queryParams).map(([k, v]) => (
                  <span key={k} className="text-xs bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 font-mono">{k}={v}</span>
                ))}
              </div>
            } />
          )}
          <KVRow label="Reported"  value={formatDate(issue.created_at)} />
          {issue.external_ticket_id && <KVRow label="Ticket" value={issue.external_ticket_id} />}
        </SectionCard>

        {/* Environment */}
        {Object.keys(env).length > 0 && (
          <SectionCard title="Environment" defaultOpen>
            {env.browser    && <KVRow label="Browser"   value={String(env.browser)} />}
            {env.os         && <KVRow label="OS"         value={String(env.os)} />}
            {env.language   && <KVRow label="Language"   value={String(env.language)} />}
            {env.devicePixelRatio && <KVRow label="DPR"  value={String(env.devicePixelRatio) + '×'} />}
            {env.viewport && typeof env.viewport === 'object' && (env.viewport as { width?: number; height?: number }).width && (
              <KVRow label="Viewport" value={`${(env.viewport as { width: number; height: number }).width} × ${(env.viewport as { width: number; height: number }).height}`} />
            )}
            {env.userAgent  && <KVRow label="User Agent" value={<span className="text-xs font-mono text-gray-500">{String(env.userAgent)}</span>} />}
          </SectionCard>
        )}

        {/* Element */}
        {Object.keys(el).length > 0 && (
          <SectionCard title="Element">
            {el.tagName    && <KVRow label="Tag"        value={<CodeBlock>{`<${String(el.tagName).toLowerCase()}>`}</CodeBlock>} />}
            {el.id         && <KVRow label="ID"          value={<CodeBlock>{String(el.id)}</CodeBlock>} />}
            {el.textContent && <KVRow label="Text"       value={String(el.textContent)} />}
            {el.cssSelector && <KVRow label="Selector"   value={<CodeBlock>{String(el.cssSelector)}</CodeBlock>} />}
            {el.xpath       && <KVRow label="XPath"      value={<CodeBlock>{String(el.xpath)}</CodeBlock>} />}
            {el.classList && Array.isArray(el.classList) && el.classList.length > 0 && (
              <KVRow label="Classes" value={
                <div className="flex flex-wrap gap-1">{(el.classList as string[]).map(c => <CodeBlock key={c}>.{c}</CodeBlock>)}</div>
              } />
            )}
            {el.accessibility && typeof el.accessibility === 'object' && (
              <KVRow label="Accessibility" value={
                <div className="flex gap-3">
                  {(el.accessibility as { role?: string }).role && <span className="text-xs">role: <CodeBlock>{String((el.accessibility as { role: string }).role)}</CodeBlock></span>}
                  {(el.accessibility as { isFocusable?: boolean }).isFocusable !== undefined && <span className="text-xs">focusable: <CodeBlock>{String((el.accessibility as { isFocusable: boolean }).isFocusable)}</CodeBlock></span>}
                </div>
              } />
            )}
            {el.semanticContext && typeof el.semanticContext === 'object' && Object.keys(el.semanticContext as object).length > 0 && (
              <KVRow label="Semantic" value={
                <div className="space-y-1">
                  {Object.entries(el.semanticContext as Record<string, string>).map(([k, v]) => (
                    <div key={k} className="text-xs"><span className="text-gray-400">{k}:</span> {v}</div>
                  ))}
                </div>
              } />
            )}
            {el.react && typeof el.react === 'object' && (
              <KVRow label="React" value={
                <div className="space-y-1.5">
                  <div className="text-xs"><span className="text-gray-400">Component:</span> <CodeBlock>{String((el.react as { componentName?: string }).componentName ?? '')}</CodeBlock></div>
                  {(el.react as { componentTree?: string[] }).componentTree && (
                    <div className="text-xs text-gray-500 font-mono">{((el.react as { componentTree: string[] }).componentTree).join(' › ')}</div>
                  )}
                  {(el.react as { source?: { file: string; line?: number; col?: number } }).source && (() => {
                    const src = (el.react as { source: { file: string; line?: number; col?: number } }).source
                    const shortPath = src.file.replace(/^.*\/src\//, 'src/')
                    const display = src.line ? `${shortPath}:${src.line}` : shortPath
                    const line = src.line ?? 1
                    const col  = src.col  ?? 1
                    const vscodeUrl = `vscode://file/${src.file}:${line}:${col}`
                    return (
                      <div className="flex flex-col gap-1 mt-0.5">
                        <a
                          href={vscodeUrl}
                          title="Open in VS Code"
                          className="inline-flex items-center gap-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 rounded px-2 py-0.5 font-mono hover:bg-indigo-100 transition-colors w-fit"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          {display}
                        </a>
                        <p className="text-xs text-gray-400">
                          Opens in VS Code · replace <code className="bg-gray-100 px-1 rounded">vscode://</code> with your editor's protocol (e.g. <code className="bg-gray-100 px-1 rounded">cursor://</code>, <code className="bg-gray-100 px-1 rounded">webstorm://</code>)
                        </p>
                      </div>
                    )
                  })()}
                </div>
              } />
            )}
            {el.domBreadcrumb && Array.isArray(el.domBreadcrumb) && el.domBreadcrumb.length > 0 && (
              <KVRow label="DOM Path" value={
                <div className="text-xs font-mono text-gray-500 flex flex-wrap items-center gap-1">
                  {(el.domBreadcrumb as { tag: string; id?: string; classes?: string[]; role?: string }[]).map((node, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-gray-300">›</span>}
                      <span className="bg-gray-50 border border-gray-200 rounded px-1 py-0.5">
                        {node.tag}
                        {node.id && <span className="text-blue-500">#{node.id}</span>}
                        {node.role && <span className="text-purple-500">[{node.role}]</span>}
                        {node.classes?.map(c => <span key={c} className="text-gray-400">.{c}</span>)}
                      </span>
                    </span>
                  ))}
                </div>
              } />
            )}
          </SectionCard>
        )}

        {/* App State */}
        {meta.appState && (
          <SectionCard title="App State">
            {meta.appState.reactRouterState && (
              <KVRow label="React Router" value={
                <div className="text-xs space-y-0.5">
                  <div><span className="text-gray-400">idx:</span> {meta.appState.reactRouterState.idx ?? '—'}</div>
                  <div><span className="text-gray-400">key:</span> <CodeBlock>{String(meta.appState.reactRouterState.key ?? '—')}</CodeBlock></div>
                </div>
              } />
            )}
            {meta.appState.zustandStoreKeys && meta.appState.zustandStoreKeys.length > 0 && (
              <KVRow label="Zustand Stores" value={
                <div className="flex flex-wrap gap-1">{meta.appState.zustandStoreKeys.map(k => <CodeBlock key={k}>{k}</CodeBlock>)}</div>
              } />
            )}
          </SectionCard>
        )}

        {/* Performance Metrics */}
        {meta.performanceMetrics && Object.keys(meta.performanceMetrics).length > 0 && (
          <SectionCard title="Performance Metrics">
            <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'TTFB',              value: formatMs(meta.performanceMetrics.ttfbMs) },
                { label: 'First Paint',       value: formatMs(meta.performanceMetrics.firstPaintMs) },
                { label: 'First Contentful',  value: formatMs(meta.performanceMetrics.firstContentfulPaintMs) },
                { label: 'DOM Loaded',        value: formatMs(meta.performanceMetrics.domContentLoadedMs) },
                { label: 'Page Load',         value: formatMs(meta.performanceMetrics.pageLoadMs) },
                { label: 'Transfer Size',     value: formatBytes(meta.performanceMetrics.transferSizeBytes) },
              ].map(m => (
                <div key={m.label} className="text-center">
                  <p className="text-lg font-semibold text-gray-800">{m.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>
            {meta.performanceMetrics.userTimingMarks && meta.performanceMetrics.userTimingMarks.length > 0 && (
              <div className="border-t border-gray-100 px-5 py-3">
                <p className="text-xs font-medium text-gray-400 mb-2">User Timing Marks</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {meta.performanceMetrics.userTimingMarks.map((m, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="font-mono text-gray-500 truncate mr-4">{m.name}</span>
                      <span className="text-gray-400 flex-shrink-0">{m.time.toLocaleString()} ms</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* Console Errors */}
        {meta.consoleErrors && meta.consoleErrors.length > 0 && (
          <SectionCard title={`Console Errors (${meta.consoleErrors.length})`}>
            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {meta.consoleErrors.map((e, i) => (
                <div key={i} className="px-5 py-2.5 flex gap-3">
                  <span className={`flex-shrink-0 text-xs font-semibold uppercase mt-0.5 ${e.level === 'error' ? 'text-red-500' : 'text-yellow-600'}`}>{e.level}</span>
                  <p className="text-xs font-mono text-gray-600 break-all">{e.message}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Network Errors */}
        {meta.networkErrors && meta.networkErrors.length > 0 && (
          <SectionCard title={`Network Errors (${meta.networkErrors.length})`}>
            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {meta.networkErrors.map((e, i) => (
                <div key={i} className="px-5 py-2.5 flex items-start gap-3">
                  <span className="flex-shrink-0 text-xs font-semibold text-red-500 w-10">{e.status}</span>
                  <span className="flex-shrink-0 text-xs font-mono text-gray-400 w-12">{e.method}</span>
                  <span className="text-xs font-mono text-gray-600 break-all flex-1">{e.url}</span>
                  <span className="flex-shrink-0 text-xs text-gray-400">{e.duration}ms</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Navigation History */}
        {meta.navigationHistory && meta.navigationHistory.length > 0 && (
          <SectionCard title="Navigation History">
            <div className="divide-y divide-gray-50">
              {meta.navigationHistory.map((n, i) => (
                <div key={i} className="px-5 py-2.5 flex justify-between gap-4">
                  <span className="text-xs font-mono text-gray-600 truncate">{n.url}</span>
                  <span className="flex-shrink-0 text-xs text-gray-400">{new Date(n.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Local/Session Storage keys (security-gated, shown if captured) */}
        {(meta.pageContext?.localStorageKeys?.length || meta.pageContext?.sessionStorageKeys?.length || meta.pageContext?.cookieNames?.length) && (
          <SectionCard title="Storage (keys only)">
            {meta.pageContext?.localStorageKeys && meta.pageContext.localStorageKeys.length > 0 && (
              <KVRow label="localStorage" value={
                <div className="flex flex-wrap gap-1">{meta.pageContext.localStorageKeys.map(k => <CodeBlock key={k}>{k}</CodeBlock>)}</div>
              } />
            )}
            {meta.pageContext?.sessionStorageKeys && meta.pageContext.sessionStorageKeys.length > 0 && (
              <KVRow label="sessionStorage" value={
                <div className="flex flex-wrap gap-1">{meta.pageContext.sessionStorageKeys.map(k => <CodeBlock key={k}>{k}</CodeBlock>)}</div>
              } />
            )}
            {meta.pageContext?.cookieNames && meta.pageContext.cookieNames.length > 0 && (
              <KVRow label="Cookies" value={
                <div className="flex flex-wrap gap-1">{meta.pageContext.cookieNames.map(k => <CodeBlock key={k}>{k}</CodeBlock>)}</div>
              } />
            )}
          </SectionCard>
        )}
      </div>
    </>
  )
}
