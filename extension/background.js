// QA Reporter — Background Service Worker (MV3)
'use strict';

const API_URL = 'http://localhost:4000';

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

// ── Inject rrweb recorder into a tab ─────────────────────────────────────────
async function injectReplayIntoTab(tabId) {
  try {
    // Wait for the tab to be fully loaded before injecting — executeScript throws
    // if the document isn't ready (e.g. tab still loading when onActivated fires).
    await waitForTabComplete(tabId);
    console.log('[QA] inject: starting for tab', tabId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['rrweb.min.js'] });
    console.log('[QA] inject: rrweb.min.js done for tab', tabId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['replay-recorder.js'] });
    console.log('[QA] inject: replay-recorder.js done for tab', tabId);
    await new Promise(r => setTimeout(r, 500));
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING_REPLAY' }).catch(e => {
      console.warn('[QA] inject: PING_REPLAY failed for tab', tabId, e?.message);
      return null;
    });
    console.log('[QA] inject: ping result for tab', tabId, ping);
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
    const replayRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_REPLAY_EVENTS' });
    if (replayRes?.error) console.warn('[QA] replay recorder error:', replayRes.error);
    if (replayRes?.ok && replayRes.events?.length > 0) {
      const data = await compressReplayEvents(replayRes.events);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const firstTs = replayRes.events[0].timestamp;
      const lastTs  = replayRes.events[replayRes.events.length - 1].timestamp;
      const duration = Math.round((lastTs - firstTs) / 1000);
      // Keep the storage write in its own try so a quota failure is reported as a
      // failure, not silently swallowed and surfaced as "no events captured".
      try {
        await chrome.storage.local.set({
          qa_saved_replay: { data, url: tab?.url || '', tabId, duration, recordedAt: Date.now() },
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
  });
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

    if (replayRes?.ok && replayRes.events?.length > 0) {
      const evts = replayRes.events;
      const first = evts[0].timestamp;
      const last  = evts[evts.length - 1].timestamp;
      if (first < minTs) minTs = first;
      if (last  > maxTs) maxTs = last;
      streams.push({
        tabId,
        url:    tabInfo?.url   || '',
        title:  tabInfo?.title || `Tab ${tabId}`,
        events: evts,
      });
    }
  }

  await chrome.storage.local.set({
    qa_screen_recording: false,
    qa_screen_recording_tab_id: null,
    qa_multitab_recorded_tabs: [],
    qa_multitab_switches: [],
  });

  if (streams.length === 0) return false;

  const duration = Math.round((maxTs - minTs) / 1000);
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
});

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

    // If screen recording is active on this same tab, save it now before the modal opens
    const { qa_screen_recording, qa_screen_recording_tab_id } =
      await chrome.storage.local.get(['qa_screen_recording', 'qa_screen_recording_tab_id']);
    if (qa_screen_recording && qa_screen_recording_tab_id === tab.id) {
      await saveRecording(tab.id);
    }

    sendResponse({ ok: true, dataUrl });
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
  try {
    // Inject the rrweb UMD bundle as a file (runs in the isolated content-script world,
    // so it is immune to the page's CSP). The bundle assigns a `rrweb` global via its
    // UMD wrapper. NOTE: rrweb.min.js MUST be a UMD/global build — the ESM build cannot
    // be injected this way (top-level `export`/`import` throw a SyntaxError).
    await chrome.scripting.executeScript({ target: { tabId }, files: ['rrweb.min.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['replay-recorder.js'] });

    // Wait briefly for the async storage callback inside replay-recorder.js to complete,
    // then ping to confirm rrweb.record actually started (eval may silently fail).
    await new Promise(r => setTimeout(r, 300));
    let pingOk = false;
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING_REPLAY' });
      pingOk = ping?.started === true;
      if (!pingOk) {
        const err = ping?.error || 'rrweb did not start';
        console.warn('[QA] replay recorder failed to start:', err);
        await chrome.storage.local.set({ qa_screen_recording: false });
        sendResponse({ ok: false, error: err });
        return;
      }
    } catch (_) {
      // Tab closed between injection and ping — treat as failure
      await chrome.storage.local.set({ qa_screen_recording: false });
      sendResponse({ ok: false, error: 'Tab closed after injection' });
      return;
    }

    await chrome.storage.local.set({
      qa_screen_recording: true,
      qa_screen_recording_tab_id: tabId,
    });
    sendResponse({ ok: true });
  } catch (err) {
    console.warn('[QA] screen recording inject failed:', err.message);
    await chrome.storage.local.set({ qa_screen_recording: false });
    sendResponse({ ok: false, error: err.message });
  }
}

// ── STOP_SCREEN_RECORDING ─────────────────────────────────────────────────────
async function handleStopScreenRecording(message, sendResponse) {
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
    qa_multitab_recorded_tabs:  [tabId],
    qa_multitab_switches:       [{ at: Date.now(), toTabId: tabId }],
  });
  sendResponse({ ok: true });
}

// ── STOP_MULTITAB_RECORDING ───────────────────────────────────────────────────
async function handleStopMultiTabRecording(sendResponse) {
  const saved = await saveMultiTabRecording();
  sendResponse({ ok: true, saved });
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
    qa_screen_recording,
    qa_multitab_mode,
    qa_multitab_recorded_tabs = [],
    qa_multitab_switches = [],
  } = await chrome.storage.local.get([
    'qa_screen_recording', 'qa_multitab_mode',
    'qa_multitab_recorded_tabs', 'qa_multitab_switches',
  ]);

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

// ── onInstalled ───────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.set({
    qa_reporter_issues:  [],
    qa_reporter_mode:    false,
    qa_recording:        false,
    qa_buffered_issues:  [],
  });
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

async function postIssue(issue) {
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

  const payload = {
    project_id:   issue.projectId || issue.project_id,
    title:        issue.title,
    description:  issue.title + (issue.description ? '\n\n' + issue.description : ''),
    severity:     issue.severity || 'Medium',
    url:          issue.url,
    route:        issue.route,
    browser_info: env,
    element_info: element,
    screenshot:   issue.screenshot
      ? issue.screenshot.replace(/^data:image\/\w+;base64,/, '')
      : undefined,
    element_screenshot: issue.fullScreenshot
      ? issue.fullScreenshot.replace(/^data:image\/\w+;base64,/, '')
      : undefined,
    metadata: {
      // Page context
      pageContext:        issue.pageContext        || null,
      // Performance
      performanceMetrics: issue.performanceMetrics || null,
      // App state (React Router + Zustand)
      appState:           issue.appState           || null,
      // Console & network
      consoleErrors:      issue.recentConsoleErrors || issue.consoleErrors || [],
      networkErrors:      issue.recentNetworkRequests || issue.networkErrors || [],
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
    },
    replay_data: replayData ?? undefined,
  };

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
  // Clear saved replay after successful submit and signal sidepanel
  if (replayStatus === 'attached') {
    await chrome.storage.local.remove(['qa_saved_replay']);
  }
  if (replayStatus) {
    await chrome.storage.local.set({ qa_replay_status: replayStatus });
  }
  return result;
}
