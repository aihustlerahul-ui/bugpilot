// QA Reporter — Background Service Worker (MV3)
'use strict';

const API_URL = 'http://localhost:4000';

// Override fetch to omit credentials/cookies for local API requests to avoid HTTP 431 (Request Header Fields Too Large)
const _originalFetch = fetch;
globalThis.fetch = function (input, init) {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else if (input && typeof input === 'object' && 'url' in input) {
    url = input.url;
  }

  if (url.startsWith(API_URL)) {
    if (input && typeof input === 'object' && !(input instanceof URL) && 'clone' in input) {
      const clonedInput = new Request(input, { credentials: 'omit' });
      return _originalFetch(clonedInput, init);
    }
    init = { ...init, credentials: 'omit' };
  }
  return _originalFetch(input, init);
};


// ── Replay compression ────────────────────────────────────────────────────────
async function compressReplayEvents(events) {
  try {
    const json = JSON.stringify(events);
    const encoded = new TextEncoder().encode(json);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(encoded);
    writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    // Convert to base64 for JSON transport
    const bytes = new Uint8Array(compressed);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (err) {
    console.warn('[QA] replay compress failed:', err.message);
    return null;
  }
}

// ── Multi-stream compression ──────────────────────────────────────────────────
async function compressMultiStream(payload) {
  try {
    const json = JSON.stringify(payload);
    const encoded = new TextEncoder().encode(json);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(encoded);
    writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    const bytes = new Uint8Array(compressed);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (err) {
    console.warn('[QA] multistream compress failed:', err.message);
    return null;
  }
}

// ── Sanitization Engine & PII Redaction ───────────────────────────────────────
const SanitizationEngine = {
  RE_CREDIT_CARD: /\b(?:\d[ -]*?){13,19}\b/g,
  RE_EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  RE_SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  RE_AUTH_HEADER: /(["']?Authorization["']?\s*:\s*["']?(?:Bearer|Basic)\s+)[^"'\r\n\s]+/gi,
  RE_COOKIE_HEADER: /(["']?Cookie["']?\s*:\s*["']?)[^"'\r\n]+/gi,
  RE_URL_PARAMS: /([?&](?:token|access_token|refresh_token|auth|password|pwd|secret|apikey|api_key|api-key|sessionId|jwt|client_secret|private_key|privatekey)=)([^&#\s]+)/gi,

  sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(SanitizationEngine.RE_CREDIT_CARD, '[REDACTED_CARD]')
      .replace(SanitizationEngine.RE_EMAIL, '[REDACTED_EMAIL]')
      .replace(SanitizationEngine.RE_SSN, '[REDACTED_SSN]')
      .replace(SanitizationEngine.RE_AUTH_HEADER, '$1[REDACTED_AUTH]')
      .replace(SanitizationEngine.RE_COOKIE_HEADER, '$1[REDACTED_COOKIE]')
      .replace(SanitizationEngine.RE_URL_PARAMS, '$1[REDACTED]');
  },

  sanitizeObject(obj, depth = 0) {
    if (!obj || depth > 8) return obj;
    if (typeof obj === 'string') return SanitizationEngine.sanitizeString(obj);
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(item => SanitizationEngine.sanitizeObject(item, depth + 1));
    }
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = SanitizationEngine.sanitizeObject(v, depth + 1);
    }
    return res;
  }
};

// ── Chunked upload helper for payloads > 5MB ──────────────────────────────────
async function uploadDataWithChunking({ data, type, projectId, issueId, onProgress }) {
  const CHUNK_SIZE = 1.5 * 1024 * 1024; // 1.5MB chunks
  const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
  let { qa_token: token } = await chrome.storage.local.get(['qa_token']);

  const headers = () => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  });

  // 1. Init chunk upload session
  let initRes = await fetch(`${API_URL}/api/issues/upload-chunk/init`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ project_id: projectId, type, total_chunks: totalChunks, total_size: data.length }),
  });
  if (initRes.status === 401) {
    token = await tryRefreshToken();
    initRes = await fetch(`${API_URL}/api/issues/upload-chunk/init`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ project_id: projectId, type, total_chunks: totalChunks, total_size: data.length }),
    });
  }
  if (!initRes.ok) throw new Error(`Init chunk upload failed: ${initRes.status}`);
  const { uploadId } = await initRes.json();

  // 2. Upload each chunk with retries
  for (let i = 0; i < totalChunks; i++) {
    const chunkData = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    let success = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        let chunkRes = await fetch(`${API_URL}/api/issues/upload-chunk`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ upload_id: uploadId, chunk_index: i, chunk_data: chunkData }),
        });
        if (chunkRes.status === 401) {
          token = await tryRefreshToken();
          chunkRes = await fetch(`${API_URL}/api/issues/upload-chunk`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ upload_id: uploadId, chunk_index: i, chunk_data: chunkData }),
          });
        }
        if (chunkRes.ok) {
          success = true;
          break;
        }
        lastError = new Error(`HTTP ${chunkRes.status}`);
      } catch (e) {
        lastError = e;
      }
      await new Promise(r => setTimeout(r, attempt * 400));
    }

    if (!success) {
      throw new Error(`Failed to upload chunk ${i + 1}/${totalChunks}: ${lastError?.message || 'network error'}`);
    }
    if (typeof onProgress === 'function') onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  // 3. Complete chunk upload session
  let compRes = await fetch(`${API_URL}/api/issues/upload-chunk/complete`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ upload_id: uploadId, issue_id: issueId }),
  });
  if (compRes.status === 401) {
    token = await tryRefreshToken();
    compRes = await fetch(`${API_URL}/api/issues/upload-chunk/complete`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ upload_id: uploadId, issue_id: issueId }),
    });
  }
  if (!compRes.ok) throw new Error(`Complete chunk upload failed: ${compRes.status}`);
  return await compRes.json();
}

// ── Offline Pending Sync Queue ────────────────────────────────────────────────
async function enqueuePendingSyncIssue(issue, errorReason) {
  const { qa_pending_sync_queue = [] } = await chrome.storage.local.get(['qa_pending_sync_queue']);
  const queueItem = {
    id: issue.id || 'issue_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    issue,
    queuedAt: Date.now(),
    retries: 0,
    lastError: errorReason || 'Offline / network failure',
    status: 'pending_sync',
  };
  const updated = [queueItem, ...qa_pending_sync_queue];
  await chrome.storage.local.set({ qa_pending_sync_queue: updated });
  console.log('[QA] Queued issue for offline sync:', queueItem.id);
  return queueItem;
}

async function processPendingSyncQueue() {
  const { qa_pending_sync_queue = [] } = await chrome.storage.local.get(['qa_pending_sync_queue']);
  if (!qa_pending_sync_queue.length) return;

  console.log('[QA] Processing pending sync queue:', qa_pending_sync_queue.length, 'items');
  const remaining = [];
  for (const item of qa_pending_sync_queue) {
    try {
      await postIssue(item.issue, { skipQueueFallback: true });
      console.log('[QA] Successfully synced pending issue:', item.id);
    } catch (err) {
      console.warn('[QA] Failed syncing pending issue', item.id, err?.message);
      item.retries = (item.retries || 0) + 1;
      item.lastError = err?.message || 'Sync failed';
      remaining.push(item);
    }
  }
  await chrome.storage.local.set({ qa_pending_sync_queue: remaining });
}

// ── Service worker watchdog & keepalive alarm ─────────────────────────────────
try {
  chrome.alarms.create('qa_keepalive_alarm', { periodInMinutes: 0.5 });
} catch (_) {}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'qa_keepalive_alarm') {
    await processPendingSyncQueue();
  }
});
// not on the initial load complete event that follows a fresh inject.
const lastRecordedUrlByTab = new Map();
/** Events flushed before same-tab re-inject (SharePoint/Excel sheet switches wipe the live buffer). */
const tabEventBuffers = new Map();
const reinjectDebounce  = new Map();

async function rememberRecordedTabUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url) lastRecordedUrlByTab.set(tabId, tab.url);
  } catch (_) {}
}

// ── Inject rrweb recorder into a tab ─────────────────────────────────────────
/** Ensure bug-capture hover UI is active on a tab (inject content script if missing). */
async function ensureBugCaptureOnTab(tabId) {
  try {
    await waitForTabComplete(tabId);
    const res = await chrome.tabs.sendMessage(tabId, { type: 'START_REPORTING' });
    if (res?.ok) return true;
  } catch (_) {}
  try {
    await waitForTabComplete(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content-styles.css'] });
    await new Promise(r => setTimeout(r, 300));
    const res = await chrome.tabs.sendMessage(tabId, { type: 'START_REPORTING' });
    return res?.ok === true;
  } catch (e) {
    console.warn('[QA] ensureBugCaptureOnTab failed for tab', tabId, e?.message);
    return false;
  }
}

/** Pull live events into tabEventBuffers before a re-inject wipes the content script. */
async function flushTabEventsToBuffer(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_REPLAY_EVENTS' });
    if (res?.ok && res.events?.length > 0) {
      const existing = tabEventBuffers.get(tabId) || [];
      tabEventBuffers.set(tabId, existing.concat(res.events));
      console.log('[QA] flushTabEvents: tab', tabId, '| +', res.events.length, '| buffer:', tabEventBuffers.get(tabId).length);
    }
  } catch (e) {
    console.warn('[QA] flushTabEvents failed for tab', tabId, e?.message);
  }
}

function mergeTabEvents(tabId, liveEvents) {
  const buffered = tabEventBuffers.get(tabId) || [];
  const live = liveEvents || [];
  if (!buffered.length) return live;
  if (!live.length) return buffered;
  return buffered.concat(live);
}

/** Same page, hash/fragment only — SPA docs; rrweb keeps recording without re-inject. */
function isHashOnlyNavigation(prevUrl, nextUrl) {
  if (!prevUrl || !nextUrl) return false;
  try {
    const a = new URL(prevUrl);
    const b = new URL(nextUrl);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search && a.href !== b.href;
  } catch {
    return false;
  }
}

async function injectReplayIntoTab(tabId, { preserveEvents = false } = {}) {
  try {
    if (preserveEvents) await flushTabEventsToBuffer(tabId);
    await waitForTabComplete(tabId);
    const { qa_replay_window_ms } = await chrome.storage.local.get(['qa_replay_window_ms']);
    const windowMs = qa_replay_window_ms || 2 * 60 * 1000;
    console.log('[QA] inject: starting for tab', tabId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['rrweb-record.min.js'] });
    console.log('[QA] inject: rrweb-record.min.js done for tab', tabId);
    // Pass window size from background — replay-recorder must not call chrome.storage
    // (storage.local.get uses runtime.sendMessage and throws when context is stale).
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (ms) => { window.__qaReplayWindowMs = ms; },
      args: [windowMs],
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['replay-recorder.js'] });
    console.log('[QA] inject: replay-recorder.js done for tab', tabId);
    await new Promise(r => setTimeout(r, 500));
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING_REPLAY' }).catch(e => {
      console.warn('[QA] inject: PING_REPLAY failed for tab', tabId, e?.message);
      return null;
    });
    console.log('[QA] inject: ping result for tab', tabId, ping);
    if (ping?.started === true) await rememberRecordedTabUrl(tabId);
    return ping?.started === true;
  } catch (err) {
    console.warn('[QA] injectReplayIntoTab FAILED for tab', tabId, err?.message);
    return false;
  }
}

// Wait up to 5s for a tab to finish loading before we try to inject scripts.
function waitForTabComplete(tabId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function check() {
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (tab.status === 'complete') { resolve(); return; }
        if (Date.now() >= deadline) { resolve(); return; } // proceed anyway after timeout
        setTimeout(check, 150);
      });
    }
    check();
  });
}

// ── Save recording to storage ─────────────────────────────────────────────────
async function saveRecording(tabId) {
  let saved = false;
  try {
    const { qa_screen_recording_started_at } =
      await chrome.storage.local.get(['qa_screen_recording_started_at']);
    const replayRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_REPLAY_EVENTS' });
    if (replayRes?.error) console.warn('[QA] replay recorder error:', replayRes.error);
    if (replayRes?.ok && replayRes.events?.length > 0) {
      const evts = mergeTabEvents(tabId, replayRes.events);
      tabEventBuffers.delete(tabId);
      const data = await compressReplayEvents(evts);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const firstTs = evts[0].timestamp;
      const lastTs  = evts[evts.length - 1].timestamp;
      let duration = Math.round((lastTs - firstTs) / 1000);
      // Canvas-heavy pages (Excel) may emit few timestamped events — use wall clock too
      if (qa_screen_recording_started_at) {
        const wallSec = Math.round((Date.now() - qa_screen_recording_started_at) / 1000);
        duration = Math.max(duration, wallSec);
      }
      console.log('[QA] saveRecording: tab', tabId, '| events:', evts.length, '| duration:', duration, 's');
      try {
        await chrome.storage.local.set({
          qa_saved_replay: { data, url: tab?.url || '', tabId, duration, recordedAt: Date.now(), eventCount: evts.length },
        });
        saved = true;
      } catch (storageErr) {
        console.warn('[QA] failed to persist replay (storage quota?):', storageErr?.message || storageErr);
      }
    }
  } catch (err) {
    console.warn('[QA] saveRecording could not reach recorder:', err?.message || err);
  }
  // Always stop the recorder and clear active flag
  try { await chrome.tabs.sendMessage(tabId, { type: 'STOP_REPLAY' }); } catch (_) {}
  await chrome.storage.local.set({
    qa_screen_recording: false,
    qa_screen_recording_tab_id: null,
    qa_screen_recording_started_at: null,
  });
  tabEventBuffers.delete(tabId);
  return saved;
}

// ── Save multi-tab recording ──────────────────────────────────────────────────
async function saveMultiTabRecording() {
  const { qa_multitab_recorded_tabs = [], qa_multitab_switches = [] } =
    await chrome.storage.local.get(['qa_multitab_recorded_tabs', 'qa_multitab_switches']);

  console.log('[QA] saveMultiTab: recorded tabs =', qa_multitab_recorded_tabs, '| switches =', qa_multitab_switches.length);

  const streams = [];
  let minTs = Infinity;
  let maxTs = 0;

  for (const tabId of qa_multitab_recorded_tabs) {
    let tabInfo = null;
    try { tabInfo = await chrome.tabs.get(tabId); } catch (_) {}
    let replayRes = null;
    try { replayRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_REPLAY_EVENTS' }); } catch (e) {
      console.warn('[QA] saveMultiTab: GET_REPLAY_EVENTS failed for tab', tabId, e?.message);
    }
    console.log('[QA] saveMultiTab: tab', tabId, '| events:', replayRes?.events?.length ?? 'null', '| started:', replayRes?.started, '| error:', replayRes?.error);
    try { await chrome.tabs.sendMessage(tabId, { type: 'STOP_REPLAY' }); } catch (_) {}

    const evts = mergeTabEvents(tabId, replayRes?.ok ? replayRes.events : null);
    tabEventBuffers.delete(tabId);
    console.log('[QA] saveMultiTab: tab', tabId, '| merged events:', evts.length);

    if (evts.length > 0) {
      const first = evts[0].timestamp;
      const last  = evts[evts.length - 1].timestamp;
      if (first < minTs) minTs = first;
      if (last  > maxTs) maxTs = last;
      streams.push({
        tabId,
        url:    tabInfo?.url   || '',
        title:  tabInfo?.title || `Tab ${tabId}`,
        events: evts,
        eventCount: evts.length,
      });
    }
  }

  const { qa_screen_recording_started_at } =
    await chrome.storage.local.get(['qa_screen_recording_started_at']);

  await chrome.storage.local.set({
    qa_screen_recording: false,
    qa_screen_recording_tab_id: null,
    qa_screen_recording_started_at: null,
    qa_multitab_recorded_tabs: [],
    qa_multitab_switches: [],
    qa_multitab_mode: false,
  });
  lastRecordedUrlByTab.clear();
  tabEventBuffers.clear();

  if (streams.length === 0) return false;

  let duration = Math.round((maxTs - minTs) / 1000);
  if (qa_screen_recording_started_at) {
    duration = Math.max(duration, Math.round((Date.now() - qa_screen_recording_started_at) / 1000));
  }
  const payload = { version: 2, streams, switches: qa_multitab_switches };
  const data = await compressMultiStream(payload);
  if (!data) return false;

  const urls = streams.map(s => s.url);
  try {
    await chrome.storage.local.set({
      qa_saved_replay: { version: 2, data, urls, duration, recordedAt: Date.now() },
    });
    return true;
  } catch (storageErr) {
    console.warn('[QA] failed to persist multi-tab replay:', storageErr?.message || storageErr);
    return false;
  }
}

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type } = message;

  if (type === 'CAPTURE_SCREENSHOT') {
    handleCaptureScreenshot(sendResponse);
    return true;
  }
  if (type === 'SUBMIT_ISSUE') {
    handleSubmitIssue(message, sendResponse);
    return true;
  }
  if (type === 'SUBMIT_ALL') {
    handleSubmitAll(message, sendResponse);
    return true;
  }
  if (type === 'GET_PROJECTS') {
    handleGetProjects(sendResponse);
    return true;
  }
  if (type === 'GET_PROJECT_MEMBERS') {
    handleGetProjectMembers(message, sendResponse);
    return true;
  }
  if (type === 'SYNC_SETTINGS') {
    handleSyncSettings(sendResponse);
    return true;
  }
  if (type === 'START_SCREEN_RECORDING') {
    handleStartScreenRecording(message, sendResponse);
    return true;
  }
  if (type === 'STOP_SCREEN_RECORDING') {
    handleStopScreenRecording(message, sendResponse);
    return true;
  }
  if (type === 'AUTO_STOP_RECORDING') {
    handleAutoStopRecording(_sender, sendResponse);
    return true;
  }
  if (type === 'START_MULTITAB_RECORDING') {
    handleStartMultiTabRecording(message, sendResponse);
    return true;
  }
  if (type === 'STOP_MULTITAB_RECORDING') {
    handleStopMultiTabRecording(sendResponse);
    return true;
  }
  if (type === 'SNAPSHOT_REPLAY') {
    handleSnapshotReplay(sendResponse);
    return true;
  }
  if (type === 'STOP_AND_ATTACH_REPLAY') {
    handleStopAndAttachReplay(_sender, sendResponse);
    return true;
  }
  if (type === 'START_VIDEO_RECORDING') {
    handleStartVideoRecording(message, sendResponse);
    return true;
  }
  if (type === 'UPLOAD_AND_ATTACH_VIDEO') {
    handleUploadAndAttachVideo(message, sendResponse);
    return true;
  }
  if (type === 'GET_RECENT_ISSUES') {
    handleGetRecentIssues(message, sendResponse);
    return true;
  }
  if (type === 'REQUEST_VIDEO_ATTACH') {
    // Rebroadcast under a distinct type — chrome.runtime.sendMessage from within this
    // same background script would otherwise re-hit this router and loop forever.
    chrome.runtime.sendMessage({ type: 'VIDEO_ATTACH_REQUESTED', issueId: message.issueId })
      .then(() => sendResponse({ ok: true }))
      .catch(() => {
        // No sidepanel is open to receive it — the recorded video cannot be attached.
        chrome.storage.local.set({ qa_video_recording_pending: false });
        sendResponse({ ok: false, error: 'No side panel open — video was not attached' });
      });
    return true;
  }
  if (type === 'REPLAY_START_FAILED') {
    // replay-recorder.js couldn't start rrweb — clear recording state
    chrome.storage.local.set({ qa_screen_recording: false, qa_screen_recording_tab_id: null });
    return false;
  }
  if (type === 'OPEN_ANNOTATOR') {
    handleOpenAnnotator(message, _sender);
    return false;
  }
  if (type === 'ANNOTATION_DONE') {
    // Forward from annotate.js (content script) back to content.js on the same tab
    const tabId = _sender.tab && _sender.tab.id;
    if (tabId) chrome.tabs.sendMessage(tabId, message);
    return false;
  }
  if (type === 'GET_PENDING_SYNC_QUEUE') {
    chrome.storage.local.get(['qa_pending_sync_queue'], ({ qa_pending_sync_queue = [] }) => {
      sendResponse({ ok: true, queue: qa_pending_sync_queue });
    });
    return true;
  }
  if (type === 'RETRY_PENDING_SYNC') {
    processPendingSyncQueue().then(() => {
      chrome.storage.local.get(['qa_pending_sync_queue'], ({ qa_pending_sync_queue = [] }) => {
        sendResponse({ ok: true, remaining: qa_pending_sync_queue.length });
      });
    });
    return true;
  }
  if (type === 'CLEAR_PENDING_SYNC') {
    chrome.storage.local.set({ qa_pending_sync_queue: [] }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (type === 'SMART_AUTOFILL') {
    handleSmartAutofill(message, sendResponse);
    return true;
  }
  if (type === 'ANALYZE_VISUAL_ANOMALIES') {
    handleAnalyzeVisualAnomalies(message, sendResponse);
    return true;
  }
  if (type === 'START_STEP_RECORDING') {
    handleStartStepRecording(message, sendResponse);
    return true;
  }
  if (type === 'STOP_STEP_RECORDING') {
    handleStopStepRecording(sendResponse);
    return true;
  }
  if (type === 'GET_RECORDED_STEPS') {
    chrome.storage.local.get(['qa_recorded_steps'], (res) => {
      sendResponse({ ok: true, steps: res.qa_recorded_steps || [] });
    });
    return true;
  }
  if (type === 'CLEAR_RECORDED_STEPS') {
    chrome.storage.local.set({ qa_recorded_steps: [] }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ── Snapshot current recording (without stopping the recorder) ───────────────
async function snapshotCurrentRecording() {
  const {
    qa_multitab_mode,
    qa_screen_recording_tab_id,
    qa_multitab_recorded_tabs = [],
    qa_multitab_switches = [],
  } = await chrome.storage.local.get([
    'qa_multitab_mode', 'qa_screen_recording_tab_id',
    'qa_multitab_recorded_tabs', 'qa_multitab_switches',
  ]);

  if (qa_multitab_mode) {
    const streams = [];
    let minTs = Infinity, maxTs = 0;
    for (const tabId of qa_multitab_recorded_tabs) {
      let tabInfo = null;
      try { tabInfo = await chrome.tabs.get(tabId); } catch (_) {}
      let replayRes = null;
      try { replayRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_REPLAY_EVENTS' }); } catch (_) {}
      const evts = mergeTabEvents(tabId, replayRes?.ok ? replayRes.events : null);
      if (evts.length > 0) {
        const first = evts[0].timestamp, last = evts[evts.length - 1].timestamp;
        if (first < minTs) minTs = first;
        if (last > maxTs) maxTs = last;
        streams.push({ tabId, url: tabInfo?.url || '', title: tabInfo?.title || `Tab ${tabId}`, events: evts, eventCount: evts.length });
      }
    }
    if (!streams.length) return false;
    const duration = Math.round((maxTs - minTs) / 1000);
    const payload = { version: 2, streams, switches: qa_multitab_switches };
    const data = await compressMultiStream(payload);
    if (!data) return false;
    try {
      await chrome.storage.local.set({ qa_saved_replay: { version: 2, data, urls: streams.map(s => s.url), duration, recordedAt: Date.now() } });
      return true;
    } catch (_) { return false; }
  } else {
    const tabId = qa_screen_recording_tab_id;
    if (!tabId) return false;
    try {
      const replayRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_REPLAY_EVENTS' });
      if (!replayRes?.ok || !replayRes.events?.length) return false;
      const evts = mergeTabEvents(tabId, replayRes.events);
      const data = await compressReplayEvents(evts);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const duration = Math.round((evts[evts.length - 1].timestamp - evts[0].timestamp) / 1000);
      await chrome.storage.local.set({ qa_saved_replay: { data, url: tab?.url || '', tabId, duration, recordedAt: Date.now(), eventCount: evts.length } });
      return true;
    } catch (_) { return false; }
  }
}

// ── CAPTURE_SCREENSHOT ────────────────────────────────────────────────────────
async function handleCaptureScreenshot(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      sendResponse({ ok: false, error: 'No active tab' });
      return;
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80,
    });
    const { qa_screen_recording, qa_screen_recording_tab_id, qa_multitab_mode, qa_screen_recording_started_at } =
      await chrome.storage.local.get(['qa_screen_recording', 'qa_screen_recording_tab_id', 'qa_multitab_mode', 'qa_screen_recording_started_at']);

    // Recording is active if this tab is being recorded (single-tab) or any multi-tab session is running
    const recordingActive = !!(qa_screen_recording && (qa_multitab_mode || qa_screen_recording_tab_id === tab.id));

    sendResponse({
      ok: true,
      dataUrl,
      screenRecordingActive: recordingActive,
      isMultiTab: !!qa_multitab_mode,
      recordingStartedAt: qa_screen_recording_started_at || null,
    });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── SUBMIT_ISSUE ──────────────────────────────────────────────────────────────
async function handleSubmitIssue(message, sendResponse) {
  try {
    const result = await postIssue(message.issue);
    sendResponse({ ok: true, result });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── SUBMIT_ALL ────────────────────────────────────────────────────────────────
async function handleSubmitAll(message, sendResponse) {
  const { issues } = message;
  const results = [];
  for (const issue of issues) {
    try {
      const result = await postIssue(issue);
      results.push({ ok: true, result });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }
  sendResponse({ ok: true, results });
}

// ── GET_PROJECTS ──────────────────────────────────────────────────────────────
async function handleGetProjects(sendResponse) {
  try {
    let { qa_token: token } = await chrome.storage.local.get(['qa_token']);
    const headers = () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });

    let res = await fetch(`${API_URL}/api/projects`, { headers: headers() });
    if (res.status === 401) {
      token = await tryRefreshToken();
      if (token) res = await fetch(`${API_URL}/api/projects`, { headers: headers() });
    }
    if (!res.ok) {
      const text = await res.text();
      sendResponse({ ok: false, error: `HTTP ${res.status}: ${text}` });
      return;
    }
    const projects = await res.json();
    sendResponse({ ok: true, projects });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── GET_PROJECT_MEMBERS ───────────────────────────────────────────────────────
async function handleGetProjectMembers(message, sendResponse) {
  try {
    const { qa_token: token } = await chrome.storage.local.get(['qa_token']);
    if (!token) return sendResponse({ ok: false, error: 'Not authenticated' });
    const res = await fetch(`${API_URL}/api/workspaces/members/project/${message.projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return sendResponse({ ok: false, error: '401' });
    if (!res.ok) return sendResponse({ ok: false, error: `HTTP ${res.status}` });
    const members = await res.json();
    return sendResponse({ ok: true, members });
  } catch (err) {
    return sendResponse({ ok: false, error: err.message });
  }
}

// ── SYNC_SETTINGS ─────────────────────────────────────────────────────────────
async function handleSyncSettings(sendResponse) {
  try {
    const { qa_token: token } = await chrome.storage.local.get(['qa_token']);
    if (!token) { sendResponse({ ok: false, error: 'Not signed in' }); return; }
    const res = await fetch(`${API_URL}/api/workspaces/settings`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { sendResponse({ ok: false, error: `HTTP ${res.status}` }); return; }
    const settings = await res.json();
    await chrome.storage.local.set({ qa_ext_settings: settings });
    sendResponse({ ok: true, settings });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── START_SCREEN_RECORDING ────────────────────────────────────────────────────
async function handleStartScreenRecording(message, sendResponse) {
  const tabId = message.tabId;
  if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); return; }
  const ok = await injectReplayIntoTab(tabId);
  if (!ok) {
    await chrome.storage.local.set({ qa_screen_recording: false });
    sendResponse({ ok: false, error: 'rrweb failed to start on this tab' });
    return;
  }
  await chrome.storage.local.set({
    qa_screen_recording: true,
    qa_screen_recording_tab_id: tabId,
    qa_screen_recording_started_at: Date.now(),
    qa_multitab_mode: false,
    qa_multitab_recorded_tabs: [],
    qa_multitab_switches: [],
  });
  lastRecordedUrlByTab.clear();
  tabEventBuffers.clear();
  sendResponse({ ok: true });
}

// ── STOP_SCREEN_RECORDING ─────────────────────────────────────────────────────
async function handleStopScreenRecording(message, sendResponse) {
  const { qa_multitab_mode } = await chrome.storage.local.get(['qa_multitab_mode']);
  if (qa_multitab_mode) {
    const saved = await saveMultiTabRecording();
    sendResponse({ ok: true, saved });
    return;
  }
  let tabId = message.tabId;
  if (!tabId) {
    const stored = await chrome.storage.local.get(['qa_screen_recording_tab_id']);
    tabId = stored.qa_screen_recording_tab_id || null;
  }
  if (!tabId) { sendResponse({ ok: false, error: 'No recording tab found' }); return; }
  const saved = await saveRecording(tabId);
  sendResponse({ ok: true, saved });
}

// ── AUTO_STOP_RECORDING (tab hidden / visibilitychange) ───────────────────────
async function handleAutoStopRecording(sender, sendResponse) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) { sendResponse({ ok: true }); return; }
  const { qa_screen_recording, qa_screen_recording_tab_id, qa_multitab_mode } =
    await chrome.storage.local.get(['qa_screen_recording', 'qa_screen_recording_tab_id', 'qa_multitab_mode']);
  if (!qa_screen_recording || qa_screen_recording_tab_id !== tabId) {
    sendResponse({ ok: true });
    return;
  }
  console.log('[QA] AUTO_STOP from tab', tabId, '| multitab_mode:', qa_multitab_mode);
  // In multi-tab mode, switching tabs hides the initial tab and fires visibilitychange —
  // that's intentional navigation, not a signal to stop. Only manual stop ends the session.
  if (qa_multitab_mode) {
    sendResponse({ ok: true });
    return;
  }
  await saveRecording(tabId);
  sendResponse({ ok: true });
}

// ── START_MULTITAB_RECORDING ──────────────────────────────────────────────────
async function handleStartMultiTabRecording(message, sendResponse) {
  const tabId = message.tabId;
  if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); return; }
  const ok = await injectReplayIntoTab(tabId);
  if (!ok) {
    await chrome.storage.local.set({ qa_screen_recording: false });
    sendResponse({ ok: false, error: 'rrweb failed to start on initial tab' });
    return;
  }
  await chrome.storage.local.set({
    qa_screen_recording:        true,
    qa_screen_recording_tab_id: tabId,
    qa_screen_recording_started_at: Date.now(),
    qa_multitab_recorded_tabs:  [tabId],
    qa_multitab_switches:       [{ at: Date.now(), toTabId: tabId }],
    qa_multitab_mode:           true,   // set authoritatively so AUTO_STOP guard is reliable
  });
  lastRecordedUrlByTab.clear();
  tabEventBuffers.clear();
  sendResponse({ ok: true });
}

// ── STOP_MULTITAB_RECORDING ───────────────────────────────────────────────────
async function handleStopMultiTabRecording(sendResponse) {
  const saved = await saveMultiTabRecording();
  sendResponse({ ok: true, saved });
}

// ── SNAPSHOT_REPLAY (attach clip without stopping recorder) ──────────────────
async function handleSnapshotReplay(sendResponse) {
  const ok = await snapshotCurrentRecording();
  sendResponse({ ok });
}

// ── STOP_AND_ATTACH_REPLAY (stop recorder + save as attached clip) ────────────
async function handleStopAndAttachReplay(sender, sendResponse) {
  const { qa_multitab_mode, qa_screen_recording_tab_id } =
    await chrome.storage.local.get(['qa_multitab_mode', 'qa_screen_recording_tab_id']);
  if (qa_multitab_mode) {
    const saved = await saveMultiTabRecording();
    sendResponse({ ok: true, saved });
  } else {
    const tabId = qa_screen_recording_tab_id || (sender.tab && sender.tab.id);
    if (!tabId) { sendResponse({ ok: false }); return; }
    const saved = await saveRecording(tabId);
    sendResponse({ ok: true, saved });
  }
}

// ── START_VIDEO_RECORDING ─────────────────────────────────────────────────────
async function handleStartVideoRecording(message, sendResponse) {
  const tabId = message.tabId;
  if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); return; }
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    sendResponse({ ok: true, streamId });
  } catch (err) {
    sendResponse({ ok: false, error: err.message || 'tabCapture failed' });
  }
}

// ── UPLOAD_AND_ATTACH_VIDEO ───────────────────────────────────────────────────
async function handleUploadAndAttachVideo(message, sendResponse) {
  const { base64, webcamBase64, thumbnailBase64, projectId, issueId } = message;
  if (!base64 || !projectId) { sendResponse({ ok: false, error: 'Missing base64 or projectId' }); return; }
  try {
    let { qa_token: token } = await chrome.storage.local.get(['qa_token']);
    const headers = () => {
      const h = { 'Content-Type': 'application/json' };
      if (token) h['Authorization'] = `Bearer ${token}`;
      return h;
    };

    let storagePath;
    if (base64.length > 5 * 1024 * 1024) {
      const chunkRes = await uploadDataWithChunking({ data: base64, type: 'video', projectId, issueId });
      storagePath = chunkRes.storagePath;
    } else {
      let uploadRes = await fetch(`${API_URL}/api/issues/upload-video`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ project_id: projectId, video: base64 }),
      });
      if (uploadRes.status === 401) {
        token = await tryRefreshToken();
        uploadRes = await fetch(`${API_URL}/api/issues/upload-video`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ project_id: projectId, video: base64 }),
        });
      }
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      storagePath = (await uploadRes.json()).storagePath;
    }

    let webcamStoragePath;
    if (webcamBase64) {
      // Webcam upload failure (network error or non-OK response) is non-fatal —
      // the screen video still attaches without it.
      try {
        let webcamUploadRes = await fetch(`${API_URL}/api/issues/upload-video`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ project_id: projectId, video: webcamBase64 }),
        });
        if (webcamUploadRes.status === 401) {
          token = await tryRefreshToken();
          webcamUploadRes = await fetch(`${API_URL}/api/issues/upload-video`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ project_id: projectId, video: webcamBase64 }),
          });
        }
        if (webcamUploadRes.ok) {
          webcamStoragePath = (await webcamUploadRes.json()).storagePath;
        }
      } catch (_) {}
    }

    let thumbnailStoragePath;
    if (thumbnailBase64) {
      // Thumbnail upload failure is non-fatal — the video still attaches without a preview.
      try {
        let thumbnailUploadRes = await fetch(`${API_URL}/api/issues/upload-thumbnail`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ project_id: projectId, thumbnail: thumbnailBase64 }),
        });
        if (thumbnailUploadRes.status === 401) {
          token = await tryRefreshToken();
          thumbnailUploadRes = await fetch(`${API_URL}/api/issues/upload-thumbnail`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ project_id: projectId, thumbnail: thumbnailBase64 }),
          });
        }
        if (thumbnailUploadRes.ok) {
          thumbnailStoragePath = (await thumbnailUploadRes.json()).storagePath;
        }
      } catch (_) {}
    }

    if (issueId) {
      const patchBody = { videoStoragePath: storagePath };
      if (webcamStoragePath) patchBody.webcamStoragePath = webcamStoragePath;
      if (thumbnailStoragePath) patchBody.thumbnailStoragePath = thumbnailStoragePath;
      let attachRes = await fetch(`${API_URL}/api/issues/${issueId}/video`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(patchBody),
      });
      if (attachRes.status === 401) {
        token = await tryRefreshToken();
        attachRes = await fetch(`${API_URL}/api/issues/${issueId}/video`, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify(patchBody),
        });
      }
      if (!attachRes.ok) throw new Error(`Attach failed: ${attachRes.status} (video uploaded to ${storagePath} but not linked — retry attach from the sidepanel)`);
    }

    sendResponse({ ok: true, storagePath, webcamStoragePath, thumbnailStoragePath });
  } catch (err) {
    sendResponse({ ok: false, error: err.message || 'Video upload failed' });
  }
}

// ── GET_RECENT_ISSUES ─────────────────────────────────────────────────────────
async function handleGetRecentIssues(message, sendResponse) {
  const { qa_token: token } = await chrome.storage.local.get(['qa_token']);
  try {
    const res = await fetch(`${API_URL}/api/issues/project/${message.projectId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const issues = await res.json();
    sendResponse({ ok: true, issues: issues.slice(0, 10) });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── B2: SMART_AUTOFILL ────────────────────────────────────────────────────────
async function handleSmartAutofill(message, sendResponse) {
  const payload = message.payload || {};
  try {
    let { qa_token: token } = await chrome.storage.local.get(['qa_token']);
    const headers = () => ({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });

    let res = await fetch(`${API_URL}/api/ai/smart-autofill`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      token = await tryRefreshToken();
      if (token) {
        res = await fetch(`${API_URL}/api/ai/smart-autofill`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(payload),
        });
      }
    }

    if (!res.ok) {
      const fallback = fallbackSmartAutofill(payload);
      sendResponse({ ok: true, result: fallback, fallback: true });
      return;
    }

    const result = await res.json();
    sendResponse({ ok: true, result });
  } catch (err) {
    const fallback = fallbackSmartAutofill(payload);
    sendResponse({ ok: true, result: fallback, fallback: true, error: err.message });
  }
}

function fallbackSmartAutofill(payload) {
  const input = (payload.userInput || '').trim();
  const ctx = payload.domContext || {};
  const target = ctx.target || {};
  const targetName = target.name || target.value || target.tag || 'element';
  const containerLabel = ctx.container?.label || ctx.container?.tag || 'section';
  const route = payload.route || ctx.page?.path || '/';

  const title = input.length > 5 ? input.charAt(0).toUpperCase() + input.slice(1) : `${targetName}: unexpected behavior on ${route}`;
  const description = `### 📝 Summary\n${input || `Issue observed on ${targetName} in ${route}`}\n\n### 🔄 Steps to Reproduce\n1. Navigate to \`${route}\`\n2. Interact with \`${targetName}\` in ${containerLabel}\n3. Observe: ${input || 'failure'}\n\n### ✅ Expected Behavior\nThe \`${targetName}\` element should work as intended.\n\n### ❌ Actual Behavior\n${input || 'Encountered unexpected behavior.'}`;

  return {
    title,
    description,
    severity: /crash|500|broken/i.test(input) ? 'High' : 'Medium',
    expectedResult: `Element \`${targetName}\` functions properly without errors.`,
    actualResult: input || 'Unexpected behavior observed.',
    labels: [target.tag || 'ui', 'smart-report'],
    domSummary: ctx.rawSummary || `Target: <${target.tag || 'element'}> "${targetName}" in ${containerLabel}`,
    confidenceScore: 0.85,
  };
}

// ── B8: ANALYZE_VISUAL_ANOMALIES ──────────────────────────────────────────────
async function handleAnalyzeVisualAnomalies(message, sendResponse) {
  const payload = message.payload || {};
  try {
    let { qa_token: token } = await chrome.storage.local.get(['qa_token']);
    const headers = () => ({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });

    let res = await fetch(`${API_URL}/api/ai/visual-analysis`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      token = await tryRefreshToken();
      if (token) {
        res = await fetch(`${API_URL}/api/ai/visual-analysis`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(payload),
        });
      }
    }

    if (!res.ok) {
      sendResponse({ ok: false, error: `HTTP ${res.status}` });
      return;
    }

    const result = await res.json();
    sendResponse({ ok: true, result });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ── B7: STEP RECORDING ────────────────────────────────────────────────────────
async function handleStartStepRecording(message, sendResponse) {
  await chrome.storage.local.set({ qa_step_recording: true, qa_recorded_steps: [] });
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'START_STEP_RECORDING' }).catch(() => {});
    }
  } catch (_) {}
  sendResponse({ ok: true });
}

async function handleStopStepRecording(sendResponse) {
  await chrome.storage.local.set({ qa_step_recording: false });
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_STEP_RECORDING' }).catch(() => {});
    }
  } catch (_) {}
  const { qa_recorded_steps = [] } = await chrome.storage.local.get(['qa_recorded_steps']);
  sendResponse({ ok: true, steps: qa_recorded_steps });
}

// ── OPEN_ANNOTATOR ────────────────────────────────────────────────────────────
async function handleOpenAnnotator(message, sender) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;

  // Store dataUrl + imageIndex so annotate.js can read it after injection
  await chrome.storage.local.set({
    qa_annotator_data: { dataUrl: message.dataUrl, imageIndex: message.imageIndex }
  });

  // Inject annotate.js on demand (guard against double-injection is inside annotate.js)
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['annotate.js'] });
  } catch (err) {
    console.error('[QA Reporter] Failed to inject annotate.js:', err);
  }
}

// ── Open side panel when extension icon is clicked ───────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Keyboard shortcut: Alt+Shift+Q toggles recording ─────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-recording') return;

  const { qa_token: token, qa_recording: recording, qa_recording_tab_id: recordingTabId } =
    await chrome.storage.local.get(['qa_token', 'qa_recording', 'qa_recording_tab_id']);
  if (!token) return; // not signed in, do nothing

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  if (recording) {
    // Always stop the tab that capture was started on, not the current active tab
    const targetTabId = recordingTabId || activeTab.id;
    try { await chrome.tabs.sendMessage(targetTabId, { type: 'STOP_REPORTING' }); } catch (_) {}
    // Stop replay recorder if active
    try { await chrome.tabs.sendMessage(targetTabId, { type: 'STOP_REPLAY' }); } catch (_) {}
    await chrome.storage.local.set({ qa_recording: false, qa_recording_tab_id: null });
  } else {
    // Sync settings then start recording on the currently active tab
    await handleSyncSettings(() => {});
    await chrome.storage.local.set({ qa_recording: true, qa_recording_tab_id: activeTab.id });
    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'START_REPORTING' });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['content-styles.css'] });
      await new Promise(r => setTimeout(r, 300));
      try { await chrome.tabs.sendMessage(activeTab.id, { type: 'START_REPORTING' }); } catch (_) {}
    }
  }
});

// ── Multi-tab: auto-inject rrweb when user switches tabs ──────────────────────
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const {
    qa_recording,
    qa_screen_recording,
    qa_multitab_mode,
    qa_multitab_recorded_tabs = [],
    qa_multitab_switches = [],
  } = await chrome.storage.local.get([
    'qa_recording', 'qa_screen_recording', 'qa_multitab_mode',
    'qa_multitab_recorded_tabs', 'qa_multitab_switches',
  ]);

  // Bug-capture mode: attach hover UI to whichever tab the user is viewing
  if (qa_recording && !qa_screen_recording) {
    await ensureBugCaptureOnTab(tabId);
    await chrome.storage.local.set({ qa_recording_tab_id: tabId });
  }

  console.log('[QA] onActivated: tab', tabId, '| recording:', qa_screen_recording, '| multitab:', qa_multitab_mode, '| tracked tabs:', qa_multitab_recorded_tabs);
  if (!qa_screen_recording || !qa_multitab_mode) return;
  if (qa_multitab_recorded_tabs.includes(tabId)) {
    console.log('[QA] onActivated: tab', tabId, 'already tracked — recording switch only');
    await chrome.storage.local.set({
      qa_multitab_switches: [...qa_multitab_switches, { at: Date.now(), toTabId: tabId }],
    });
    return;
  }

  // New tab — inject rrweb
  console.log('[QA] onActivated: new tab', tabId, '— injecting rrweb');
  const ok = await injectReplayIntoTab(tabId);
  console.log('[QA] onActivated: inject result for tab', tabId, '=', ok);
  if (ok) {
    await chrome.storage.local.set({
      qa_multitab_recorded_tabs: [...qa_multitab_recorded_tabs, tabId],
      qa_multitab_switches: [...qa_multitab_switches, { at: Date.now(), toTabId: tabId }],
    });
    console.log('[QA] onActivated: tab', tabId, 'added to recorded tabs');
  } else {
    console.warn('[QA] onActivated: injection FAILED for tab', tabId, '— tab will not be recorded');
  }
});

// ── Re-inject after same-tab navigation (Excel sheet switches change the URL) ─
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // When a recorded tab starts (re)loading, clear its URL cache.
  // This ensures the 'complete' event re-injects rrweb even on a same-URL
  // refresh (changeInfo.url absent) or back/forward to a previously visited URL.
  if (changeInfo.status === 'loading') {
    const {
      qa_screen_recording,
      qa_screen_recording_tab_id,
      qa_multitab_mode,
      qa_multitab_recorded_tabs = [],
    } = await chrome.storage.local.get([
      'qa_screen_recording', 'qa_screen_recording_tab_id',
      'qa_multitab_mode', 'qa_multitab_recorded_tabs',
    ]);
    if (qa_screen_recording) {
      const isTracked = qa_multitab_mode
        ? qa_multitab_recorded_tabs.includes(tabId)
        : tabId === qa_screen_recording_tab_id;
      if (isTracked) lastRecordedUrlByTab.delete(tabId);
    }
    return;
  }

  if (changeInfo.status !== 'complete') return;

  // Use tab.url (always present on 'complete') — changeInfo.url is absent on same-URL refreshes.
  const currentUrl = tab.url;
  if (!currentUrl) return;

  const {
    qa_screen_recording,
    qa_screen_recording_tab_id,
    qa_multitab_mode,
    qa_multitab_recorded_tabs = [],
  } = await chrome.storage.local.get([
    'qa_screen_recording', 'qa_screen_recording_tab_id',
    'qa_multitab_mode', 'qa_multitab_recorded_tabs',
  ]);

  if (!qa_screen_recording) return;
  if (currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://')) return;

  const isMultiTab = qa_multitab_mode && qa_multitab_recorded_tabs.includes(tabId);
  const isSingleTab = !qa_multitab_mode && tabId === qa_screen_recording_tab_id;
  if (!isMultiTab && !isSingleTab) return;

  const prevUrl = lastRecordedUrlByTab.get(tabId);
  // prevUrl is null after a load starts (cleared above) — always proceed.
  // If somehow still set and matches, it's a spurious complete event after our own inject — skip.
  if (prevUrl === currentUrl) return;

  // SPA hash-only navigation fires onUpdated but rrweb doesn't need re-injection.
  if (prevUrl && isHashOnlyNavigation(prevUrl, currentUrl)) {
    lastRecordedUrlByTab.set(tabId, currentUrl);
    return;
  }

  console.log('[QA] onUpdated: navigation on tab', tabId, prevUrl ?? '(reload)', '→', currentUrl);
  clearTimeout(reinjectDebounce.get(tabId));
  reinjectDebounce.set(tabId, setTimeout(async () => {
    reinjectDebounce.delete(tabId);
    const ok = await injectReplayIntoTab(tabId, { preserveEvents: true });
    if (ok) {
      lastRecordedUrlByTab.set(tabId, currentUrl);
      console.log('[QA] onUpdated: re-injected recorder after navigation on tab', tabId);
    } else {
      console.warn('[QA] onUpdated: re-inject failed for tab', tabId);
    }
  }, 400));
});

// ── onInstalled ───────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.set({
    qa_reporter_issues:  [],
    qa_reporter_mode:    false,
    qa_recording:        false,
    qa_buffered_issues:  [],
  });
  setupBugMagnetContextMenus();
});

// ── Token refresh ─────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://faasplsazadmtixuwzsn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYXNwbHNhemFkbXRpeHV3enNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTYyOTIsImV4cCI6MjA5Nzc5MjI5Mn0.hagIYaR3QzF41p99VQJU0J1C7_lnabBqlJ6MAhl7tbw';

async function tryRefreshToken() {
  const { qa_refresh_token } = await chrome.storage.local.get(['qa_refresh_token']);
  if (!qa_refresh_token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ refresh_token: qa_refresh_token }),
    });
    const data = await res.json();
    if (!data.access_token) return null;
    await chrome.storage.local.set({ qa_token: data.access_token, qa_refresh_token: data.refresh_token || qa_refresh_token });
    return data.access_token;
  } catch (_) { return null; }
}

// ── Shared POST helper ────────────────────────────────────────────────────────
// Two URLs refer to the same page if origin + pathname match (ignore query/hash so a
// recording survives benign query changes between capture and submit).
function replayUrlMatches(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch (_) {
    return false;
  }
}

async function postIssue(issue, options = {}) {
  // Attach the saved replay only to the specific bug captured on the recorded page.
  // Matching by issue URL (not the currently-active tab) makes Submit-All deterministic:
  // the replay lands on its own bug regardless of submit order, instead of whichever
  // issue happens to be posted first.
  let replayData = null;
  let replayStatus = null;
  const { qa_saved_replay } = await chrome.storage.local.get(['qa_saved_replay']);
  if (qa_saved_replay?.data && issue?.url) {
    const urlsToCheck = qa_saved_replay.version === 2
      ? (qa_saved_replay.urls || [])
      : [qa_saved_replay.url || ''];
    const matches = urlsToCheck.some(u => replayUrlMatches(issue.url, u));
    if (matches) {
      replayData  = qa_saved_replay.data;
      replayStatus = 'attached';
    }
  }

  const { qa_token: token } = await chrome.storage.local.get(['qa_token']);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Map camelCase extension fields → snake_case API fields
  const element = issue.element || issue.elementInfo || issue.element_info || {};
  const env     = issue.environment_info || issue.browserInfo || issue.browser_info || {};

  const sanitizedElement = SanitizationEngine.sanitizeObject(element);
  const sanitizedEnv = SanitizationEngine.sanitizeObject(env);

  const rawMetadata = {
    // Page context
    pageContext:        issue.pageContext        || null,
    // Performance
    performanceMetrics: issue.performanceMetrics || null,
    // App state (React Router + Zustand)
    appState:           issue.appState           || null,
    // Console & network
    consoleErrors:       issue.recentConsoleErrors || issue.consoleErrors || [],
    networkTransactions: issue.networkTransactions || issue.recentNetworkRequests || issue.networkErrors || [],
    networkErrors:       issue.networkErrors || issue.recentNetworkRequests || [],
    // Navigation
    navigationHistory:  issue.navigationHistory  || [],
    // All captured images (no limit — element, full page, annotated versions, etc.)
    screenshots:        issue.allScreenshots     || undefined,
    // Optional form fields
    expectedResult:     issue.expectedResult     || null,
    actualResult:       issue.actualResult       || null,
    priority:           issue.priority           || null,
    environment:        issue.environment        || null,
    labels:             issue.labels             || null,
    sprint:             issue.sprint             || null,
    assignee:           issue.assignee           || null,
  };

  const sanitizedMetadata = SanitizationEngine.sanitizeObject(rawMetadata);

  const payload = {
    project_id:   issue.projectId || issue.project_id,
    title:        SanitizationEngine.sanitizeString(issue.title),
    description:  SanitizationEngine.sanitizeString(issue.title + (issue.description ? '\n\n' + issue.description : '')),
    severity:     issue.severity || 'Medium',
    url:          SanitizationEngine.sanitizeString(issue.url),
    route:        SanitizationEngine.sanitizeString(issue.route),
    browser_info: sanitizedEnv,
    element_info: sanitizedElement,
    screenshot:   issue.screenshot
      ? issue.screenshot.replace(/^data:image\/\w+;base64,/, '')
      : undefined,
    element_screenshot: issue.fullScreenshot
      ? issue.fullScreenshot.replace(/^data:image\/\w+;base64,/, '')
      : undefined,
    metadata:     sanitizedMetadata,
    replay_data:  (replayData && replayData.length <= 5 * 1024 * 1024) ? replayData : undefined,
  };

  try {
    const res = await fetch(`${API_URL}/api/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (res.status === 401) throw new Error('Unauthorized — please sign in again');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const result = await res.json();

    // If replay was > 5MB, upload via multipart chunking attached to the created issue
    if (replayData && replayData.length > 5 * 1024 * 1024 && result?.id) {
      try {
        await uploadDataWithChunking({
          data: replayData,
          type: 'replay',
          projectId: payload.project_id,
          issueId: result.id,
        });
      } catch (chunkErr) {
        console.warn('[QA] Large replay chunked upload failed:', chunkErr.message);
      }
    }

    // Clear saved replay after successful submit and signal sidepanel
    if (replayStatus === 'attached') {
      await chrome.storage.local.remove(['qa_saved_replay']);
    }
    if (replayStatus) {
      await chrome.storage.local.set({ qa_replay_status: replayStatus });
    }
    return result;
  } catch (err) {
    if (!options.skipQueueFallback) {
      const queued = await enqueuePendingSyncIssue(issue, err.message);
      return { queued: true, queueId: queued.id, message: 'Saved offline. Issue queued for background sync.' };
    }
    throw err;
  }
}

// ── Bug Magnet Exploratory Test Data Context Menus ─────────────────────────────
const BUG_MAGNET_DATA = {
  whitespace: {
    title: 'Whitespace',
    items: [
      { id: 'bm_ws_edges',    title: 'Leading & Trailing Space',  value: '   Leading & Trailing   ' },
      { id: 'bm_ws_tabs',     title: 'Tabs (\\t)',               value: 'Tab\tSeparated\tValues' },
      { id: 'bm_ws_newlines', title: 'Newlines (\\n)',           value: 'Line 1\nLine 2\nLine 3' },
      { id: 'bm_ws_zero',     title: 'Zero-width Space (\\u200B)', value: 'Zero\u200BWidth\u200CSpace' },
      { id: 'bm_ws_nonbreak', title: 'Non-breaking Space (\\u00A0)', value: 'Non\u00A0Breaking\u00A0Space' },
    ]
  },
  accents: {
    title: 'Accents & Diacritics',
    items: [
      { id: 'bm_acc_latin',  title: 'Latin Accents',                value: 'Héllo Wörld Café-au-lait' },
      { id: 'bm_acc_german', title: 'German (ä ö ü ß)',             value: 'Größe Über Flöße daß' },
      { id: 'bm_acc_french', title: 'French (é è ê ë ç)',           value: 'Ça va très bien, garçon' },
      { id: 'bm_acc_nordic', title: 'Nordic (å æ ø)',               value: 'Blåbærgrød på Rømø' },
      { id: 'bm_acc_zalgo',  title: 'Zalgo / Combining Diacritics', value: 'Z̶a̶l̶g̶o̶ t̸e̸x̸t̸' },
    ]
  },
  emojis: {
    title: 'Emojis (UTF-16)',
    items: [
      { id: 'bm_emo_common',  title: 'Common Emojis',        value: '👋 🚀 🐞 ⚡️ 🔥 🦄' },
      { id: 'bm_emo_zwj',     title: 'Complex ZWJ Sequence', value: '👨‍👩‍👧‍👦 🏳️‍🌈 🧑🏽‍💻' },
      { id: 'bm_emo_flags',   title: 'Flag Sequences',      value: '🇺🇸 🇬🇧 🇯🇵 🇩🇪 🇮🇳' },
      { id: 'bm_emo_symbols', title: 'Math & Currency',     value: '€ £ ¥ ₹ © ® ™ ∑ π ∞' },
    ]
  },
  rtl: {
    title: 'RTL (Right-to-Left)',
    items: [
      { id: 'bm_rtl_ar',    title: 'Arabic',           value: 'مرحبا بالعالم' },
      { id: 'bm_rtl_he',    title: 'Hebrew',           value: 'שלום עולם' },
      { id: 'bm_rtl_mix',   title: 'Mixed LTR & RTL',  value: 'Hello مرحبا World 123' },
      { id: 'bm_rtl_cjk',   title: 'CJK (East Asian)', value: '日本語テスト 中文测试 한국어' },
    ]
  },
  emails: {
    title: 'Email Edge Cases',
    items: [
      { id: 'bm_email_valid',   title: 'Valid: user+tag@example.com',   value: 'user+tag@example.com' },
      { id: 'bm_email_dots',    title: 'Valid: first.last@sub.co.uk',   value: 'first.last@sub.domain.co.uk' },
      { id: 'bm_email_no_at',   title: 'Invalid: missing @ sign',       value: 'invalid.example.com' },
      { id: 'bm_email_no_user', title: 'Invalid: missing user part',    value: '@example.com' },
      { id: 'bm_email_spaces',  title: 'Invalid: spaces in address',    value: 'user name@example.com' },
      { id: 'bm_email_long',    title: 'Boundary: 254-char email',      value: 'a'.repeat(64) + '@' + 'b'.repeat(180) + '.com' },
    ]
  },
  numbers: {
    title: 'Numbers & Boundaries',
    items: [
      { id: 'bm_num_zero',    title: 'Zero (0)',                     value: '0' },
      { id: 'bm_num_neg',     title: 'Negative (-1)',                value: '-1' },
      { id: 'bm_num_max32',   title: 'Max 32-bit Int (2147483647)',  value: '2147483647' },
      { id: 'bm_num_min32',   title: 'Min 32-bit Int (-2147483648)', value: '-2147483648' },
      { id: 'bm_num_maxsafe', title: 'Max Safe Int (9007199254740991)', value: '9007199254740991' },
      { id: 'bm_num_decimal', title: 'Decimal (3.14159265)',         value: '3.14159265' },
      { id: 'bm_num_sci',     title: 'Scientific (1e+10)',           value: '1e+10' },
      { id: 'bm_num_nan',     title: 'Not a Number (NaN)',           value: 'NaN' },
    ]
  },
  boundaries: {
    title: 'String Length Boundaries',
    items: [
      { id: 'bm_str_empty', title: 'Empty String ("")',   value: '' },
      { id: 'bm_str_1',     title: '1 Character (A)',     value: 'A' },
      { id: 'bm_str_255',   title: '255 Characters',      value: 'A'.repeat(255) },
      { id: 'bm_str_1000',  title: '1,000 Characters',    value: 'A'.repeat(1000) },
      { id: 'bm_str_lorem', title: 'Lorem Ipsum',         value: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' },
    ]
  },
  exploits: {
    title: 'Exploits & Injections',
    items: [
      { id: 'bm_xss_script', title: 'XSS: <script>alert(1)</script>',  value: '<script>alert("BugMagnet")</script>' },
      { id: 'bm_xss_img',    title: 'XSS: <img onerror>',             value: '<img src=x onerror=alert("BugMagnet")>' },
      { id: 'bm_xss_svg',    title: 'XSS: <svg onload>',              value: '"><svg/onload=alert("BugMagnet")>' },
      { id: 'bm_sqli_or',    title: "SQLi: ' OR '1'='1",              value: "' OR '1'='1" },
      { id: 'bm_sqli_drop',  title: "SQLi: '; DROP TABLE users; --",   value: "'; DROP TABLE users; --" },
      { id: 'bm_html_h1',    title: 'HTML: <h1>Injection</h1>',        value: '<h1>BugMagnet Test</h1>' },
    ]
  }
};

function setupBugMagnetContextMenus() {
  if (typeof chrome === 'undefined' || !chrome.contextMenus || !chrome.contextMenus.removeAll) return;
  chrome.contextMenus.removeAll(function () {
    try {
      chrome.contextMenus.create({
        id: 'bm_root',
        title: 'Bug Magnet (Test Data)',
        contexts: ['editable']
      });

      for (const [catKey, category] of Object.entries(BUG_MAGNET_DATA)) {
        chrome.contextMenus.create({
          id: 'bm_cat_' + catKey,
          parentId: 'bm_root',
          title: category.title,
          contexts: ['editable']
        });

        for (const item of category.items) {
          chrome.contextMenus.create({
            id: item.id,
            parentId: 'bm_cat_' + catKey,
            title: item.title,
            contexts: ['editable']
          });
        }
      }
    } catch (err) {
      console.warn('[QA] Error creating Bug Magnet context menus:', err);
    }
  });
}

// Ensure context menus are created on startup/worker load
setupBugMagnetContextMenus();

if (typeof chrome !== 'undefined' && chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async function (info, tab) {
    if (!info.menuItemId || !String(info.menuItemId).startsWith('bm_')) return;
    let targetValue = null;
    for (const cat of Object.values(BUG_MAGNET_DATA)) {
      const found = cat.items.find(function (i) { return i.id === info.menuItemId; });
      if (found) { targetValue = found.value; break; }
    }
    if (targetValue !== null && tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'BUG_MAGNET_INSERT',
          value: targetValue
        });
        if (chrome.action && chrome.action.setBadgeText) {
          await chrome.action.setBadgeText({ tabId: tab.id, text: '✓' });
          if (chrome.action.setBadgeBackgroundColor) {
            await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#22c55e' });
          }
          setTimeout(function () {
            try { chrome.action.setBadgeText({ tabId: tab.id, text: '' }); } catch (_) {}
          }, 1500);
        }
      } catch (e) {
        console.warn('[QA] Failed to send Bug Magnet value to tab:', e);
      }
    }
  });
}
