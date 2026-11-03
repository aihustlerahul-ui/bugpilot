import React from 'react';
import type { Issue } from '@/lib/types';

export function isMobileIssue(issue: Pick<Issue, 'metadata'>): boolean {
  return issue.metadata?.captureSource === 'rn-reporter';
}

export function MobileBadge() {
  return (
    <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 ring-1 ring-violet-200 font-semibold">
      Mobile
    </span>
  );
}

function str(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <span className="font-semibold text-slate-500">{label}</span>
      <p className={`mt-0.5 text-slate-800 break-words ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  );
}

/** Device, screen and tapped-element details for issues captured by the React Native reporter. */
export function MobileInfo({ issue }: { issue: Issue }) {
  const device = (issue.browser_info || {}) as Record<string, unknown>;
  const el = (issue.element_info || {}) as Record<string, unknown>;
  const dims = (el.dimensions || null) as { width?: number; height?: number } | null;

  const deviceLabel = [str(device.platform), [str(device.os), str(device.osVersion)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ');
  const size =
    dims && typeof dims.width === 'number' && typeof dims.height === 'number'
      ? `${Math.round(dims.width)}×${Math.round(dims.height)}`
      : '';

  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4 text-xs" data-testid="mobile-info">
      <div className="flex items-center gap-2">
        <MobileBadge />
        <span className="font-semibold text-slate-700">Captured in mobile app</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Device" value={deviceLabel} />
        <Row label="App version" value={str(device.appVersion)} />
        <Row label="Screen" value={issue.route || str(el.routeName)} mono />
      </div>
      {(el.testID || el.accessibilityLabel || el.nativeID || el.bugpilotName || el.text || size) && (
        <div className="grid grid-cols-2 gap-3 border-t border-violet-100 pt-3">
          <Row label="testID" value={str(el.testID)} mono />
          <Row label="Accessibility label" value={str(el.accessibilityLabel)} />
          <Row label="nativeID" value={str(el.nativeID)} mono />
          <Row label="Name" value={str(el.bugpilotName)} />
          <Row label="Text" value={str(el.text)} />
          <Row label="Size" value={size} mono />
        </div>
      )}
    </div>
  );
}
