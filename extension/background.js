// QA Reporter — Background Service Worker (MV3)
'use strict';

const API_URL = 'http://localhost:4000';

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

  const { qa_token: token, qa_recording: recording } = await chrome.storage.local.get(['qa_token', 'qa_recording']);
  if (!token) return; // not signed in, do nothing

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (recording) {
    // Stop recording
    try { await chrome.tabs.sendMessage(tab.id, { type: 'STOP_REPORTING' }); } catch (_) {}
    await chrome.storage.local.set({ qa_recording: false });
  } else {
    // Sync settings then start recording
    await handleSyncSettings(() => {});
    await chrome.storage.local.set({ qa_recording: true });
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING' });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content-styles.css'] });
      await new Promise(r => setTimeout(r, 300));
      try { await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING' }); } catch (_) {}
    }
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
async function postIssue(issue) {
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
      // Optional form fields
      expectedResult:     issue.expectedResult     || null,
      actualResult:       issue.actualResult       || null,
      priority:           issue.priority           || null,
      environment:        issue.environment        || null,
      labels:             issue.labels             || null,
      sprint:             issue.sprint             || null,
      assignee:           issue.assignee           || null,
    },
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
  return res.json();
}
