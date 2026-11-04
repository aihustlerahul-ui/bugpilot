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

function yesNo(v: unknown): string {
  return typeof v === 'boolean' ? (v ? 'Yes' : 'No') : '';
}

/** Device, screen and tapped-element details for issues captured by the React Native reporter. */
export function MobileInfo({ issue }: { issue: Issue }) {
  const device = (issue.browser_info || {}) as Record<string, unknown>;
  const el = (issue.element_info || {}) as Record<string, unknown>;
  const mobile = ((issue.metadata?.mobile as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;
  const extra = (mobile.extra || null) as Record<string, unknown> | null;
  const collected = Array.isArray(mobile.collected) ? (mobile.collected as string[]) : [];
  const dims = (el.dimensions || null) as { width?: number; height?: number } | null;

  const deviceLabel = [str(device.platform), [str(device.os), str(device.osVersion)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ');
  const model = [str(device.deviceBrand), str(device.deviceModel)].filter(Boolean).join(' ');
  const size =
    dims && typeof dims.width === 'number' && typeof dims.height === 'number'
      ? `${Math.round(dims.width)}×${Math.round(dims.height)}`
      : '';
  const display = [
    str(device.screen),
    device.pixelRatio ? `@${str(device.pixelRatio)}x` : '',
    str(device.orientation),
  ]
    .filter(Boolean)
    .join(' ');
  const network = [
    str(device.networkType),
    device.networkConnected === false ? 'offline' : '',
    device.internetReachable === false ? 'no internet' : '',
    str(device.cellularGeneration),
  ]
    .filter(Boolean)
    .join(' · ');
  const battery = device.batteryPercent !== undefined
    ? `${str(device.batteryPercent)}%${device.lowPowerMode ? ' (low power)' : ''}`
    : '';
  const build = [str(device.bundleId), device.buildNumber ? `build ${str(device.buildNumber)}` : '']
    .filter(Boolean)
    .join(' · ');
  const locale = [str(device.locale), str(device.timezone)].filter(Boolean).join(' · ');
  const runtime = [str(device.jsEngine), device.isDebugBuild === true ? 'debug build' : device.isDebugBuild === false ? 'release build' : '', str(device.executionEnvironment)]
    .filter(Boolean)
    .join(' · ');
  const hasEnv = [model, display, network, battery, build, locale, runtime, str(device.colorScheme), str(device.fontScale), str(device.memoryMb), str(device.updateId)].some(Boolean);

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
      {hasEnv && (
        <div className="grid grid-cols-2 gap-3 border-t border-violet-100 pt-3" data-testid="mobile-env">
          <Row label="Model" value={model} />
          <Row label="Display" value={display} />
          <Row label="Network" value={network} />
          <Row label="Battery" value={battery} />
          <Row label="Build" value={build} mono />
          <Row label="Runtime" value={runtime} />
          <Row label="Locale" value={locale} />
          <Row label="Theme" value={str(device.colorScheme)} />
          <Row label="Font scale" value={str(device.fontScale)} />
          <Row label="Memory (MB)" value={str(device.memoryMb)} />
          <Row label="Physical device" value={yesNo(device.isPhysicalDevice)} />
          <Row label="OTA update" value={str(device.updateId)} mono />
        </div>
      )}
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
      {extra && Object.keys(extra).length > 0 && (
        <div className="border-t border-violet-100 pt-3" data-testid="mobile-extra">
          <span className="font-semibold text-slate-500">App state</span>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(extra).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-slate-500">{k}</dt>
                <dd className="font-mono text-slate-800 break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {collected.length > 0 && (
        <p className="border-t border-violet-100 pt-3 text-slate-500">
          Context collected: {collected.join(', ')}. See the Console, Network and Flight Recorder tabs.
        </p>
      )}
    </div>
  );
}
