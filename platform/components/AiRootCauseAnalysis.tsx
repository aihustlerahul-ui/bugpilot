'use client';

import { useState } from 'react';
import type { Issue } from '@/lib/types';

interface AiRootCauseAnalysisProps {
  issue: Issue;
  className?: string;
}

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

export function AiRootCauseAnalysis({ issue, className = '' }: AiRootCauseAnalysisProps) {
  const [activeTab, setActiveTab] = useState<'rca' | 'playwright'>('rca');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedDiff, setCopiedDiff] = useState(false);
  const [copiedPlaywright, setCopiedPlaywright] = useState(false);

  const meta = issue.metadata || {};
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
  };

  const reactComp = typeof (elementInfo.react?.componentName || elementInfo.reactComponentName) === 'string'
    ? (elementInfo.react?.componentName || elementInfo.reactComponentName)
    : '';
  const reactTree: string[] = Array.isArray(elementInfo.react?.componentTree)
    ? elementInfo.react.componentTree.map((t) => (typeof t === 'string' ? t : JSON.stringify(t)))
    : [];
  const reactSource = elementInfo.reactSource || (elementInfo.react?.source ? { fileName: elementInfo.react.source.file, lineNumber: elementInfo.react.source.line } : null);
  const sourceLine = reactSource?.fileName
    ? `${reactSource.fileName}:${reactSource.lineNumber || 1}`
    : null;
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

  const consoleErrors = meta.consoleErrors || [];
  const networkTx = meta.networkTransactions || [];
  const networkErrors = networkTx.filter((tx) => {
    const s = typeof tx.status === 'number' ? tx.status : parseInt(String(tx.status), 10);
    return !isNaN(s) && s >= 400;
  });
  const recentSuccessfulCalls = networkTx.filter((tx) => {
    const s = typeof tx.status === 'number' ? tx.status : parseInt(String(tx.status), 10);
    return !isNaN(s) && s < 400;
  }).slice(-5);

  const primaryError =
    consoleErrors[0]?.message ||
    (networkErrors[0] ? `${networkErrors[0].method} ${networkErrors[0].url} failed with ${networkErrors[0].status}` : 'UI State Mismatch');

  const rootCauseSummary =
    networkErrors.length > 0
      ? `The component ${reactComp ? `<${reactComp}>` : 'target element'} failed during data hydration because upstream API endpoint \`${networkErrors[0].url}\` returned HTTP ${networkErrors[0].status}. The application did not handle the error response gracefully.`
      : consoleErrors.length > 0
      ? `An unhandled JavaScript runtime error occurred in ${reactComp ? `<${reactComp}>` : 'the client'}: "${primaryError.slice(0, 120)}". The error caused React component tree unmounting or state corruption.`
      : `The element \`${cssSelector || (reactComp ? `<${reactComp}>` : 'target element')}\` experienced a UI logic, state management, or data-mapping mismatch on route "${issue.route || issue.url || '/'}".`;

  const suggestedFixSnippet = sourceLine
    ? `// ${sourceLine}\n- const items = data.items.map(i => i.title);\n+ const items = data?.items?.map(i => i.title) ?? [];`
    : `// Safe error boundary & null-check pattern\n- return <div>{data.result}</div>;\n+ return data?.result ? <div>{data.result}</div> : <SkeletonLoader />;`;

  const recordedSteps: Array<{ action?: string; type?: string; label?: string; selector?: string; targetTag?: string; text?: string; value?: string; url?: string; route?: string }> = meta.recordedSteps || [];
  const navHistory = meta.navigationHistory || [];

  const screenshots: Array<{ label: string; src: string }> = [];
  if (issue.element_screenshot_url) screenshots.push({ label: 'Element Screenshot', src: issue.element_screenshot_url });
  if (issue.screenshot_url) screenshots.push({ label: 'Full Page Screenshot', src: issue.screenshot_url });
  if (Array.isArray(meta.screenshots)) {
    meta.screenshots.forEach((s: { label?: string; url?: string; src?: string }, idx: number) => {
      const src = s.url || s.src;
      if (src && !screenshots.some((x) => x.src === src)) {
        screenshots.push({ label: s.label || `Screenshot ${idx + 1}`, src });
      }
    });
  }

  const sections: string[] = [];
  sections.push(`### 🐛 Bug Report: ${issue.title || issue.description}`);
  sections.push(`- **Target URL / Route**: \`${issue.url || issue.route || 'N/A'}\``);
  if (issue.route && issue.url && issue.route !== issue.url) sections.push(`- **Route Pattern**: \`${issue.route}\``);
  sections.push(`- **Severity**: ${issue.severity || 'Medium'}`);
  if (issue.triage_status) sections.push(`- **Triage Status**: ${issue.triage_status}`);

  sections.push(`\n### 📝 Description\n${issue.description || '(No description provided)'}`);
  if (meta.expectedResult || meta.actualResult) {
    if (meta.expectedResult) sections.push(`- **Expected Result**: ${meta.expectedResult}`);
    if (meta.actualResult) sections.push(`- **Actual Result**: ${meta.actualResult}`);
  }

  if (screenshots.length > 0) {
    const shotLines = screenshots.map((s) => `- **${s.label}**: ![${s.label}](${s.src})\n  Direct URL: ${s.src}`);
    sections.push(`\n### 🖼️ Screenshots & Visual Evidence\n${shotLines.join('\n')}`);
  }

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
  if (targetElementLines.length > 0) {
    sections.push(`\n### 🎯 Target Element & DOM Context\n${targetElementLines.join('\n')}`);
  }

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
    sections.push(`\n### 🐾 Flight Recorder (Reproduction Steps)\n${reproLines.join('\n')}`);
  }

  const netLines: string[] = [];
  if (networkErrors.length > 0) {
    netLines.push('**Failed Network Calls (>= 400):**');
    networkErrors.forEach((t) => {
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

  if (consoleErrors.length > 0) {
    const errLines = consoleErrors.map((e) => `- [${(e.level || 'ERROR').toUpperCase()}] ${e.message}`);
    sections.push(`\n### ⚠️ Console Logs & Errors\n${errLines.join('\n')}`);
  }

  sections.push(`\n### 💡 Diagnostic Analysis & Hypothesis\n${rootCauseSummary}`);
  sections.push(`\n### 🛠️ Task for Cursor / Copilot
1. Locate the component corresponding to \`${sourceLine || reactComp || cssSelector || issue.route || 'the target element'}\`.
2. Review state handling and data flow for the target element.
3. Apply a minimal, bug-free fix patch addressing the root cause.`);

  const cursorAiPrompt = sections.join('\n');

  const dynamicStepStatements = recordedSteps.length > 0
    ? recordedSteps.map((s, i) => {
        if (s.type === 'input') {
          return `    // ${i + 2}. Enter text input\n    await page.locator('${s.selector || 'input'}').fill('${s.value !== '***' ? (s.value || '') : 'test@example.com'}');`;
        }
        return `    // ${i + 2}. Click interaction\n    await page.locator('${s.selector || 'button'}').first().click();`;
      }).join('\n\n')
    : `    // 2. Locate the suspect element\n    const target = page.locator('${elementInfo.cssSelector || 'button'}').first();\n    await expect(target).toBeVisible();\n\n    // 3. Trigger action\n    await target.click();`;

  const playwrightTestCode = `import { test, expect } from '@playwright/test';

test.describe('Reproduction: ${issue.title || 'Bug Report'}', () => {
  test('should trigger error state on ${reactComp}', async ({ page }) => {
    // 1. Navigate to target URL
    await page.goto('${issue.url || 'https://app.example.com'}');
    await page.waitForLoadState('networkidle');

${dynamicStepStatements}

    // Assert error state is captured
    await expect(page.locator('body')).toContainText('${primaryError.slice(0, 40).replace(/'/g, "\\'")}');
  });
});`;

  const handleCopyPrompt = async () => {
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const html = `
          <h2>🐛 Bug Report: ${issue.title || issue.description}</h2>
          <p><b>Target URL:</b> ${issue.url || issue.route || 'N/A'}</p>
          <p><b>Severity:</b> ${issue.severity || 'Medium'}</p>
          ${screenshots.map((s) => `<div><p><b>${s.label}:</b></p><img src="${s.src}" alt="${s.label}" style="max-width: 600px; border-radius: 8px; margin: 8px 0;" /></div>`).join('')}
          <pre style="white-space: pre-wrap; font-family: monospace;">${cursorAiPrompt}</pre>
        `;
        const textBlob = new Blob([cursorAiPrompt], { type: 'text/plain' });
        const htmlBlob = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(cursorAiPrompt);
      }
    } catch {
      await navigator.clipboard.writeText(cursorAiPrompt);
    }
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleCopyDiff = () => {
    navigator.clipboard.writeText(suggestedFixSnippet);
    setCopiedDiff(true);
    setTimeout(() => setCopiedDiff(false), 2000);
  };

  const handleCopyPlaywright = () => {
    navigator.clipboard.writeText(playwrightTestCode);
    setCopiedPlaywright(true);
    setTimeout(() => setCopiedPlaywright(false), 2000);
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-indigo-200/90 bg-gradient-to-br from-indigo-50/40 via-white to-purple-50/30 p-5 shadow-xs ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-indigo-100 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <span className="text-sm">✨</span>
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
              AI Diagnostic Copilot
            </h3>
            <p className="text-[11px] text-slate-500">
              Synthesized from DOM Fiber, Console Errors, and Network Waterfall
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyPrompt}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 shadow-2xs hover:bg-indigo-50 transition-colors"
          >
            {copiedPrompt ? '✓ Copied Prompt' : '⚡ Copy for Cursor / VS Code'}
          </button>
        </div>
      </div>

      {/* Subtabs: RCA vs Playwright */}
      <div className="mt-3 flex items-center gap-2 border-b border-indigo-100/60 pb-2">
        <button
          onClick={() => setActiveTab('rca')}
          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
            activeTab === 'rca'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-indigo-50'
          }`}
        >
          🔍 Root Cause Analysis &amp; Fix
        </button>
        <button
          onClick={() => setActiveTab('playwright')}
          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
            activeTab === 'playwright'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-indigo-50'
          }`}
        >
          🎭 Playwright Test Spec (.spec.ts)
        </button>
      </div>

      {/* Body Content */}
      <div className="mt-3.5 space-y-3.5 text-xs">
        {activeTab === 'rca' ? (
          <>
            {/* Cause Explanation Box */}
            <div className="rounded-lg border border-slate-200/80 bg-white p-3.5 shadow-2xs">
              <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">
                Probable Root Cause
              </span>
              <p className="mt-1.5 text-slate-700 leading-relaxed font-sans">
                {rootCauseSummary}
              </p>
            </div>

            {/* Suggested Code Fix */}
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 shadow-md">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pb-2 border-b border-slate-800">
                <span>Proposed Fix ({sourceLine || '<' + reactComp + '>'})</span>
                <button
                  onClick={handleCopyDiff}
                  className="text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {copiedDiff ? '✓ Copied Patch' : 'Copy Patch'}
                </button>
              </div>
              <pre className="mt-2.5 overflow-x-auto font-mono text-[11px] leading-relaxed text-emerald-400">
                {suggestedFixSnippet}
              </pre>
            </div>
          </>
        ) : (
          /* Playwright Spec Tab */
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 shadow-md">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pb-2 border-b border-slate-800">
              <span>reproduce-bug.spec.ts</span>
              <button
                onClick={handleCopyPlaywright}
                className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                {copiedPlaywright ? '✓ Copied Playwright Spec' : 'Copy Playwright Code'}
              </button>
            </div>
            <pre className="mt-2.5 overflow-x-auto font-mono text-[11px] leading-relaxed text-cyan-300">
              {playwrightTestCode}
            </pre>
          </div>
        )}

        {/* Key Signals Badges */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
          <span className="rounded bg-indigo-100 px-2 py-0.5 font-mono font-medium text-indigo-800">
            Component: &lt;{reactComp}&gt;
          </span>
          {sourceLine && (
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700">
              {sourceLine}
            </span>
          )}
          {consoleErrors.length > 0 && (
            <span className="rounded bg-red-100 px-2 py-0.5 font-semibold text-red-800">
              {consoleErrors.length} Error Log{consoleErrors.length > 1 ? 's' : ''}
            </span>
          )}
          {networkErrors.length > 0 && (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
              {networkErrors.length} Failed Request{networkErrors.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
