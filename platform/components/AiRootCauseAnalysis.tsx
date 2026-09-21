'use client';

import { useState } from 'react';
import type { Issue } from '@/lib/types';

interface AiRootCauseAnalysisProps {
  issue: Issue;
  className?: string;
}

export function AiRootCauseAnalysis({ issue, className = '' }: AiRootCauseAnalysisProps) {
  const [activeTab, setActiveTab] = useState<'rca' | 'playwright'>('rca');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedDiff, setCopiedDiff] = useState(false);
  const [copiedPlaywright, setCopiedPlaywright] = useState(false);

  const meta = issue.metadata || {};
  const elementInfo = (issue.element_info || {}) as {
    react?: { componentName?: string };
    reactComponentName?: string;
    reactSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
    cssSelector?: string;
  };
  const reactComp = elementInfo.react?.componentName || elementInfo.reactComponentName || 'UnknownComponent';
  const sourceLine = elementInfo.reactSource?.fileName
    ? `${elementInfo.reactSource.fileName}:${elementInfo.reactSource.lineNumber}`
    : null;

  const consoleErrors = meta.consoleErrors || [];
  const networkErrors = (meta.networkTransactions || []).filter((tx) => {
    const s = typeof tx.status === 'number' ? tx.status : parseInt(String(tx.status), 10);
    return !isNaN(s) && s >= 400;
  });

  const primaryError =
    consoleErrors[0]?.message ||
    (networkErrors[0] ? `${networkErrors[0].method} ${networkErrors[0].url} failed with ${networkErrors[0].status}` : 'UI Render Exception');

  const rootCauseSummary =
    networkErrors.length > 0
      ? `The component <${reactComp}> failed during data hydration because an upstream API endpoint returned HTTP ${networkErrors[0].status}. The client application did not gracefully handle the error response, triggering a cascading render failure.`
      : consoleErrors.length > 0
      ? `An unhandled JavaScript runtime error occurred in <${reactComp}>: "${primaryError.slice(0, 120)}". The error caused React component tree unmounting or state corruption.`
      : `The element ${elementInfo.cssSelector || '<' + reactComp + '>'} experienced an unexpected layout or state mismatch on route "${issue.route || issue.url || '/'}".`;

  const suggestedFixSnippet = sourceLine
    ? `// ${sourceLine}\n- const items = data.items.map(i => i.title);\n+ const items = data?.items?.map(i => i.title) ?? [];`
    : `// Safe error boundary & null-check pattern\n- return <div>{data.result}</div>;\n+ return data?.result ? <div>{data.result}</div> : <SkeletonLoader />;`;

  const domContext = meta.domContext || null;
  const recordedSteps: Array<{ action?: string; type?: string; label?: string; selector?: string; value?: string }> = meta.recordedSteps || [];

  const cursorAiPrompt = `You are debugging a verified bug in BugPilot.

### Bug Overview
- Title: ${issue.title || issue.description}
- URL / Route: ${issue.url || issue.route || 'N/A'}
- React Component: <${reactComp}>
- Source File: ${sourceLine || 'N/A'}
- Severity: ${issue.severity || 'Medium'}
${domContext ? `- 50-Token DOM Context: ${domContext.rawSummary || JSON.stringify(domContext)}` : ''}

### Telemetry Signals
- Console Errors:
${consoleErrors.map((e) => `  - [${e.level.toUpperCase()}] ${e.message}`).join('\n') || '  (None logged)'}

- Failed Network Calls:
${networkErrors.map((n) => `  - ${n.method} ${n.url} -> ${n.status}`).join('\n') || '  (None logged)'}

### Diagnostic Root Cause
${rootCauseSummary}

### Task
Please inspect ${sourceLine || reactComp} and provide a minimal, bug-free patch addressing the root cause.`;

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

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(cursorAiPrompt);
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
