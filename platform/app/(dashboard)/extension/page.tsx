'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

interface ExtensionSettings {
  screenshotMode: 'full' | 'element_crop' | 'element_context' | 'full_highlighted' | 'both'
  captureUrl: boolean
  capturePageTitle: boolean
  captureBrowserInfo: boolean
  captureRoute: boolean
  captureReact: boolean
  captureConsole: boolean
  captureNetwork: boolean
  capturePerformance: boolean
  captureDomHierarchy: boolean
  captureComputedStyles: boolean
  captureXPath: boolean
  captureLocalStorage: boolean
  captureSessionStorage: boolean
  captureCookies: boolean
  captureUserInfo: boolean
  captureNavHistory: boolean
  formExpectedResult: boolean
  formActualResult: boolean
  formPriority: boolean
  formEnvironment: boolean
  formLabels: boolean
  formSprint: boolean
  formAssignee: boolean
}

// ── Screenshot mode SVG preview ──────────────────────────────────────────────
function ModePreview({ mode }: { mode: string }) {
  const page = (
    <>
      <rect x="0" y="0" width="80" height="54" fill="#f3f4f6" />
      <rect x="0" y="0" width="80" height="8" fill="#1e40af" />
      <rect x="3" y="2.5" width="12" height="3" rx="1" fill="#ffffff50" />
      <rect x="56" y="2" width="10" height="4" rx="1" fill="#ffffff30" />
      <rect x="68" y="2" width="9" height="4" rx="1" fill="#ffffff30" />
      <rect x="0" y="8" width="80" height="6" fill="#e5e7eb" />
      <rect x="3" y="10" width="10" height="2" rx="0.5" fill="#9ca3af" />
      <rect x="16" y="10" width="10" height="2" rx="0.5" fill="#9ca3af" />
      <rect x="10" y="20" width="60" height="10" rx="2" fill="#ffffff" stroke="#d1d5db" strokeWidth="0.5" />
      <circle cx="16" cy="25" r="2.5" fill="none" stroke="#9ca3af" strokeWidth="0.8" />
      <line x1="17.8" y1="26.8" x2="19.5" y2="28.5" stroke="#9ca3af" strokeWidth="0.8" strokeLinecap="round" />
      <rect x="22" y="23.5" width="20" height="3" rx="0.5" fill="#e5e7eb" />
      <rect x="3" y="34" width="74" height="5" rx="1" fill="#ffffff" />
      <rect x="5" y="35.5" width="18" height="2" rx="0.5" fill="#e5e7eb" />
      <rect x="3" y="41" width="74" height="5" rx="1" fill="#ffffff" />
    </>
  )
  if (mode === 'full') return <svg viewBox="0 0 80 54" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">{page}<rect x="0" y="0" width="80" height="54" fill="none" stroke="#3b82f6" strokeWidth="1" strokeDasharray="3 2" /></svg>
  if (mode === 'element_crop') return <svg viewBox="10 20 60 10" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">{page}<rect x="10" y="20" width="60" height="10" fill="none" stroke="#3b82f6" strokeWidth="0.8" strokeDasharray="2 1.5" /></svg>
  if (mode === 'element_context') return <svg viewBox="2 12 76 26" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">{page}<rect x="10" y="20" width="60" height="10" fill="none" stroke="#ef4444" strokeWidth="0.8" /><rect x="2" y="12" width="76" height="26" fill="none" stroke="#3b82f6" strokeWidth="0.8" strokeDasharray="2 1.5" /></svg>
  if (mode === 'full_highlighted') return <svg viewBox="0 0 80 54" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">{page}<rect x="9" y="19" width="62" height="12" rx="1" fill="none" stroke="#ef4444" strokeWidth="1.2" /></svg>
  if (mode === 'both') return (
    <svg viewBox="0 0 80 54" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <clipPath id="left-clip"><rect x="0" y="0" width="50" height="54" /></clipPath>
      <g clipPath="url(#left-clip)"><g transform="translate(0,0) scale(0.66 2.08) translate(-2,-12)">{page}<rect x="10" y="20" width="60" height="10" fill="none" stroke="#ef4444" strokeWidth="1.2" /></g></g>
      <rect x="0" y="0" width="50" height="54" fill="none" stroke="#3b82f6" strokeWidth="0.8" strokeDasharray="2 1.5" />
      <line x1="52" y1="2" x2="52" y2="52" stroke="#d1d5db" strokeWidth="0.5" />
      <g transform="translate(53,1) scale(0.34 0.96)">{page}<rect x="9" y="19" width="62" height="12" rx="1" fill="none" stroke="#ef4444" strokeWidth="1.5" /></g>
      <rect x="53" y="1" width="27" height="52" fill="none" stroke="#9ca3af" strokeWidth="0.5" />
    </svg>
  )
  return null
}

const SCREENSHOT_MODES = [
  { value: 'full',             label: 'Full screen',                       description: 'Entire visible tab captured as-is.' },
  { value: 'element_crop',     label: 'Element crop',                      description: 'Screenshot cropped tight to the clicked element.' },
  { value: 'element_context',  label: 'Element + context',                 description: 'Element + 80px surrounding context. Red box marks element.' },
  { value: 'full_highlighted', label: 'Full screen, element highlighted',  description: 'Full tab with a red box drawn around selected element.' },
  { value: 'both',             label: 'Both',                              description: 'Element crop as primary + full screenshot saved.' },
]

// ── Toggle component ─────────────────────────────────────────────────────────
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

function ToggleRow({
  label, description, enabled, onChange, locked, lockedLabel,
}: {
  label: string; description: string; enabled: boolean
  onChange: (v: boolean) => void; locked?: boolean; lockedLabel?: string
}) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-800">{label}</p>
          {locked && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">{lockedLabel ?? 'ALWAYS ON'}</span>}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      {locked
        ? <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <Toggle enabled={enabled} onChange={onChange} />
      }
    </div>
  )
}

// ── Section card ─────────────────────────────────────────────────────────────
function Section({ title, description, badge, badgeColor, children }: {
  title: string; description: string; badge?: string; badgeColor?: string; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          {badge && <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${badgeColor}`}>{badge}</span>}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <div className="px-6 py-2">{children}</div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ExtensionPage() {
  const qc = useQueryClient()
  const [saved, setSaved] = useState(false)

  const { data: settings, isLoading } = useQuery<ExtensionSettings>({
    queryKey: ['workspace', 'settings'],
    queryFn: () => api.get<ExtensionSettings>('/workspaces/settings'),
  })

  const mutation = useMutation({
    mutationFn: (patch: Partial<ExtensionSettings>) =>
      api.patch<ExtensionSettings>('/workspaces/settings', patch),
    onSuccess: (updated) => {
      qc.setQueryData(['workspace', 'settings'], updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  function set<K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) {
    mutation.mutate({ [key]: value } as Partial<ExtensionSettings>)
  }

  const s = settings

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Chrome Extension</h1>
        <p className="text-sm text-gray-500 mt-1">Download, install, and configure the QA Reporter extension.</p>
      </div>

      {/* Download + Status */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Extension status</h2>
            <p className="text-xs text-gray-400 mt-0.5">Connects automatically when you sign in.</p>
          </div>
          <ExtensionConnectionBadge />
        </div>
        <div className="px-6 py-5 flex items-start gap-6">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-gray-800">QA Reporter — Chrome Extension</p>
            <p className="text-xs text-gray-500">MV3 · All websites · Chrome 112+</p>
          </div>
          <a href="/qa-reporter-extension.zip" download className="flex items-center gap-2 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Download .zip
          </a>
        </div>
        <details className="border-t border-gray-100 group">
          <summary className="px-6 py-4 flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 select-none list-none">
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              How to install
            </span>
            <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="px-6 pb-5">
            <ol className="space-y-3">
              {['Download the .zip and unzip it.', 'Open Chrome → chrome://extensions.', 'Enable Developer mode (top-right).', 'Click "Load unpacked" → select the folder.', 'Click the QA Reporter icon to sign in.'].map((step, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-50 text-blue-600 text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span className="text-gray-600">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </details>
      </div>

      {/* Screenshot mode */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Screenshot mode</h2>
          <p className="text-xs text-gray-400 mt-0.5">What gets captured when you click an element.</p>
        </div>
        <div className="divide-y divide-gray-50">
          {isLoading ? (
            <div className="px-6 py-8 text-center text-sm text-gray-400">Loading…</div>
          ) : (
            SCREENSHOT_MODES.map(mode => {
              const active = s?.screenshotMode === mode.value
              return (
                <button key={mode.value} onClick={() => set('screenshotMode', mode.value as ExtensionSettings['screenshotMode'])}
                  className={`w-full px-6 py-4 flex items-center gap-5 text-left transition-colors ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <div className={`flex-shrink-0 w-28 h-20 rounded-lg overflow-hidden border ${active ? 'border-blue-300' : 'border-gray-200'} bg-gray-50`}>
                    <ModePreview mode={mode.value} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${active ? 'text-blue-700' : 'text-gray-800'}`}>{mode.label}</p>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{mode.description}</p>
                  </div>
                  <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${active ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
                    {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* General */}
      <Section title="General" description="Core data captured with every bug report.">
        {isLoading ? <div className="py-4 text-sm text-gray-400">Loading…</div> : <>
          <ToggleRow locked label="Capture Screenshot"        description="Visual capture based on the screenshot mode above."            enabled onChange={() => {}} />
          <ToggleRow locked label="Capture URL"               description="Full URL of the page where the bug was found."                 enabled onChange={() => {}} />
          <ToggleRow        label="Capture Page Title"        description="document.title of the page at the time of capture."            enabled={s?.capturePageTitle  ?? true}  onChange={v => set('capturePageTitle',  v)} />
          <ToggleRow        label="Capture Browser Info"      description="Browser name, version, OS, language, viewport, device pixel ratio." enabled={s?.captureBrowserInfo ?? true} onChange={v => set('captureBrowserInfo', v)} />
          <ToggleRow        label="Capture Route"             description="Current pathname and query parameters."                        enabled={s?.captureRoute      ?? true}  onChange={v => set('captureRoute',      v)} />
        </>}
      </Section>

      {/* Advanced */}
      <Section title="Advanced" description="Richer diagnostic signals for deeper bug context." badge="Default on" badgeColor="bg-blue-50 text-blue-600">
        {isLoading ? <div className="py-4 text-sm text-gray-400">Loading…</div> : <>
          <ToggleRow label="Capture React Metadata"   description="Component name, tree, and props via React fiber introspection. Also captures React Router state and Zustand store keys." enabled={s?.captureReact       ?? true} onChange={v => set('captureReact',       v)} />
          <ToggleRow label="Capture Console Errors"   description="Last 15 console.error / console.warn entries on the page."                  enabled={s?.captureConsole     ?? true} onChange={v => set('captureConsole',     v)} />
          <ToggleRow label="Capture Failed API Calls" description="Non-2xx fetch and XHR requests intercepted in real time."                   enabled={s?.captureNetwork     ?? true} onChange={v => set('captureNetwork',     v)} />
          <ToggleRow label="Capture Performance Metrics" description="First paint, FCP, TTFB, page load, transfer size, and user timing marks." enabled={s?.capturePerformance ?? true} onChange={v => set('capturePerformance', v)} />
          <ToggleRow label="Capture DOM Hierarchy"    description="Ancestor chain (tag, id, classes, role, nth position) up to the root."      enabled={s?.captureDomHierarchy ?? true} onChange={v => set('captureDomHierarchy', v)} />
          <ToggleRow label="Capture Computed Styles"  description="Font, color, display, and layout CSS values on the selected element."        enabled={s?.captureComputedStyles ?? false} onChange={v => set('captureComputedStyles', v)} />
          <ToggleRow label="Capture XPath"            description="Full XPath of the selected element (useful for test automation)."             enabled={s?.captureXPath       ?? true}  onChange={v => set('captureXPath',       v)} />
          <ToggleRow label="Capture Navigation History" description="Last 5 pages visited in this tab before the bug was captured."               enabled={s?.captureNavHistory  ?? true}  onChange={v => set('captureNavHistory',  v)} />
        </>}
      </Section>

      {/* Security */}
      <Section title="Security" description="Sensitive storage data — disabled by default. Only enable in trusted environments." badge="Default off" badgeColor="bg-amber-50 text-amber-600">
        {isLoading ? <div className="py-4 text-sm text-gray-400">Loading…</div> : <>
          <ToggleRow label="Capture Local Storage Keys"   description="Key names (not values) in localStorage at the time of capture."  enabled={s?.captureLocalStorage   ?? false} onChange={v => set('captureLocalStorage',   v)} />
          <ToggleRow label="Capture Session Storage Keys" description="Key names (not values) in sessionStorage at the time of capture." enabled={s?.captureSessionStorage ?? false} onChange={v => set('captureSessionStorage', v)} />
          <ToggleRow label="Capture Cookie Names"         description="Cookie names (not values) present on the page."                   enabled={s?.captureCookies        ?? false} onChange={v => set('captureCookies',        v)} />
          <ToggleRow label="Capture User Information"     description="Logged-in user details from the app's state if accessible."       enabled={s?.captureUserInfo       ?? false} onChange={v => set('captureUserInfo',       v)} />
        </>}
      </Section>

      {/* Bug Form */}
      <Section title="Bug Form" description="Fields shown in the in-page bug report form when you click an element.">
        {isLoading ? <div className="py-4 text-sm text-gray-400">Loading…</div> : <>
          <ToggleRow locked label="Title"           description="One-line description of the bug." enabled onChange={() => {}} />
          <ToggleRow locked label="Description"     description="Freeform notes, steps to reproduce." enabled onChange={() => {}} />
          <ToggleRow locked label="Severity"        description="Low / Medium / High / Critical." enabled onChange={() => {}} />
          <div className="mt-3 mb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Optional fields</div>
          <ToggleRow label="Expected Result" description="What should have happened."               enabled={s?.formExpectedResult ?? true}  onChange={v => set('formExpectedResult', v)} />
          <ToggleRow label="Actual Result"   description="What actually happened."                  enabled={s?.formActualResult   ?? true}  onChange={v => set('formActualResult',   v)} />
          <ToggleRow label="Priority"        description="Low / Medium / High / Critical priority." enabled={s?.formPriority       ?? false} onChange={v => set('formPriority',       v)} />
          <ToggleRow label="Environment"     description="Production / Staging / Development / QA." enabled={s?.formEnvironment    ?? false} onChange={v => set('formEnvironment',    v)} />
          <ToggleRow label="Labels"          description="Comma-separated tags (bug, ui, regression…)." enabled={s?.formLabels     ?? false} onChange={v => set('formLabels',         v)} />
          <ToggleRow label="Sprint"          description="Sprint name or number."                   enabled={s?.formSprint         ?? false} onChange={v => set('formSprint',         v)} />
          <ToggleRow label="Assignee"        description="Email or name of the assignee."           enabled={s?.formAssignee       ?? false} onChange={v => set('formAssignee',       v)} />
        </>}
      </Section>

      {/* Save feedback toast */}
      {saved && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2">
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          Settings saved
        </div>
      )}
    </div>
  )
}

function ExtensionConnectionBadge() {
  const [status, setStatus] = useState<'checking' | 'connected' | 'not_connected'>('checking')

  useEffect(() => {
    const timer = setTimeout(() => setStatus('not_connected'), 500)
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'QA_REPORTER_PONG') {
        clearTimeout(timer)
        setStatus('connected')
        window.removeEventListener('message', onMessage)
      }
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ type: 'QA_REPORTER_PING' }, '*')
    return () => { clearTimeout(timer); window.removeEventListener('message', onMessage) }
  }, [])

  if (status === 'checking') return <span className="text-xs text-gray-400">Checking…</span>
  if (status === 'connected') return (
    <span className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
      Extension connected
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
      Not detected
    </span>
  )
}
