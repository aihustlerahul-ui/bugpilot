// QA Reporter — Side Panel Script
'use strict';

const SUPABASE_URL = 'https://faasplsazadmtixuwzsn.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYXNwbHNhemFkbXRpeHV3enNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTYyOTIsImV4cCI6MjA5Nzc5MjI5Mn0.hagIYaR3QzF41p99VQJU0J1C7_lnabBqlJ6MAhl7tbw';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const viewAuth  = document.getElementById('view-auth');
const viewMain  = document.getElementById('view-main');

const authEmail    = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authError    = document.getElementById('auth-error');
const btnSignin    = document.getElementById('btn-signin');

const displayEmail       = document.getElementById('display-email');
const btnSignout         = document.getElementById('btn-signout');
const statusBar          = document.getElementById('status-bar');
const statusText         = document.getElementById('status-text');
const statusCount        = document.getElementById('status-count');
const projectSelect      = document.getElementById('project-select');
const btnToggleRecording = document.getElementById('btn-toggle-recording');
const bufferBadge        = document.getElementById('buffer-badge');
const issueList          = document.getElementById('issue-list');
const bufferActions      = document.getElementById('buffer-actions');
const btnSubmitAll       = document.getElementById('btn-submit-all');
const btnClear           = document.getElementById('btn-clear');
const toast              = document.getElementById('toast');
const btnScreenRec       = document.getElementById('btn-screen-recording');
const replayWindowSel    = document.getElementById('replay-window-select');
const screenRecTimerRow  = document.getElementById('screen-rec-timer-row');
const screenRecTimerEl   = document.getElementById('screen-rec-timer');
const replayChip         = document.getElementById('replay-chip');
const replayChipDuration = document.getElementById('replay-chip-duration');
const replayChipUrl      = document.getElementById('replay-chip-url');
const btnDeleteReplay    = document.getElementById('btn-delete-replay');

// ── State ─────────────────────────────────────────────────────────────────────
let isRecording    = false;
let captureCount   = 0;
let sessionMembers = []; // project members for current project, in-memory only

// ── Token refresh ─────────────────────────────────────────────────────────────
async function refreshAccessToken() {
  const { qa_refresh_token } = await chrome.storage.local.get(['qa_refresh_token']);
  if (!qa_refresh_token) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ refresh_token: qa_refresh_token }),
    });
    const data = await res.json();
    if (!data.access_token) return null;

    await chrome.storage.local.set({
      qa_token: data.access_token,
      qa_refresh_token: data.refresh_token || qa_refresh_token,
    });
    return data.access_token;
  } catch (_) {
    return null;
  }
}

// ── View helpers ──────────────────────────────────────────────────────────────
function showAuth() {
  viewAuth.classList.add('active');
  viewMain.classList.remove('active');
}
function showMain() {
  viewMain.classList.add('active');
  viewAuth.classList.remove('active');
}

function showToast(msg, type = 'success', ms = 3500) {
  toast.textContent = msg;
  toast.className = `show ${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.className = ''; }, ms);
}

// ── Recording UI ──────────────────────────────────────────────────────────────
function applyRecordingState(recording, count) {
  isRecording  = recording;
  captureCount = count ?? captureCount;

  if (recording) {
    statusBar.className = 'status-bar recording';
    statusText.textContent = 'Recording active';
    statusCount.textContent = captureCount + ' captured';
    btnToggleRecording.className = 'btn btn-stop btn-full';
    btnToggleRecording.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="1.5"/></svg> Stop Capturing';
    // Lock replay controls during recording
    replayWindowSel.disabled = true;
    btnScreenRec.disabled = true;
  } else {
    statusBar.className = 'status-bar idle';
    statusText.textContent = 'Ready to record';
    btnToggleRecording.className = 'btn btn-record btn-full';
    btnToggleRecording.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><polygon points="3,1 11,6 3,11"/></svg> Capture Now';
    // Unlock replay controls when stopped
    replayWindowSel.disabled = false;
    btnScreenRec.disabled = false;
  }
}

// ── Buffer UI ─────────────────────────────────────────────────────────────────
async function refreshBufferUI() {
  const { qa_buffered_issues: issues = [] } = await chrome.storage.local.get(['qa_buffered_issues']);
  const count = issues.length;

  bufferBadge.textContent = count;
  bufferBadge.className = `buffer-badge${count === 0 ? ' zero' : ''}`;

  if (count === 0) {
    issueList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◻</div>
        No issues yet — start recording and click any element to capture a bug.
      </div>`;
    bufferActions.style.display = 'none';
  } else {
    issueList.innerHTML = issues.map(issue => `
      <div class="issue-item">
        <div class="issue-item-title">${escHtml(issue.title)}</div>
        <div class="issue-item-meta">
          <span class="sev-badge sev-${escHtml(issue.severity || 'Medium')}">${escHtml(issue.severity || 'Medium')}</span>
          <span class="issue-url">${escHtml(issue.route || issue.url || '')}</span>
        </div>
      </div>`).join('');
    bufferActions.style.display = 'flex';
    btnSubmitAll.textContent = `Submit All (${count})`;
  }

  // keep capture count in sync
  captureCount = count;
  if (isRecording) statusCount.textContent = count + ' captured';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Projects ──────────────────────────────────────────────────────────────────
async function loadProjects() {
  projectSelect.innerHTML = '<option value="">Loading…</option>';
  projectSelect.disabled = true;

  const response = await chrome.runtime.sendMessage({ type: 'GET_PROJECTS' });

  if (!response.ok) {
    const errMsg = response.error || 'Failed to load projects';
    if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
      // Try to silently refresh the token before giving up
      const newToken = await refreshAccessToken();
      if (newToken) {
        // Retry once with the fresh token
        const retry = await chrome.runtime.sendMessage({ type: 'GET_PROJECTS' });
        if (retry.ok) {
          return populateProjects(retry.projects || []);
        }
      }
      await chrome.storage.local.remove(['qa_token', 'qa_refresh_token', 'qa_user_email', 'qa_recording']);
      authError.textContent = 'Session expired — please sign in again.';
      showAuth();
      return;
    }
    projectSelect.innerHTML = `<option value="">Error: ${errMsg}</option>`;
    projectSelect.disabled = false;
    return;
  }

  populateProjects(response.projects || []);
}

async function populateProjects(projects) {
  projectSelect.innerHTML = '';

  if (projects.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No projects — create one in the dashboard';
    projectSelect.appendChild(opt);
  } else {
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Select a project…';
    projectSelect.appendChild(ph);

    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      projectSelect.appendChild(opt);
    });

    const { qa_selected_project } = await chrome.storage.local.get(['qa_selected_project']);
    if (qa_selected_project && projects.some(p => p.id === qa_selected_project.id)) {
      projectSelect.value = qa_selected_project.id;
    }
  }

  projectSelect.disabled = false;

  // Pre-fetch members for already-selected project
  if (projectSelect.value) {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PROJECT_MEMBERS', projectId: projectSelect.value });
    sessionMembers = resp.ok ? (resp.members || []) : [];
  }
}

// ── Active tab helper ─────────────────────────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab) return null;
  try { return await chrome.tabs.sendMessage(tab.id, message); } catch (_) { return null; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const { qa_token, qa_user_email, qa_recording, qa_saved_replay } =
    await chrome.storage.local.get(['qa_token', 'qa_user_email', 'qa_recording', 'qa_saved_replay']);

  if (!qa_token) { showAuth(); return; }

  displayEmail.textContent = qa_user_email || 'Signed in';
  showMain();

  // Verify actual recording state with content script
  let actuallyRecording = false;
  if (qa_recording) {
    try {
      const tab = await getActiveTab();
      if (tab) {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'IS_RECORDING' }).catch(() => null);
        actuallyRecording = !!(res && res.recording);
      }
    } catch (_) {}
    if (!actuallyRecording) {
      await chrome.storage.local.set({ qa_recording: false });
    }
  }

  applyRecordingState(actuallyRecording);
  applyReplayChip(qa_saved_replay);
  await loadProjects();
  await refreshBufferUI();
}

// ── Auth: sign in ─────────────────────────────────────────────────────────────
btnSignin.addEventListener('click', async () => {
  const email    = authEmail.value.trim();
  const password = authPassword.value;
  authError.textContent = '';

  if (!email || !password) {
    authError.textContent = 'Email and password are required.';
    return;
  }

  btnSignin.disabled = true;
  btnSignin.textContent = 'Signing in…';

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (data.error || !data.access_token) {
      authError.textContent = data.error_description || data.error || 'Login failed.';
      return;
    }

    await chrome.storage.local.set({
      qa_token: data.access_token,
      qa_refresh_token: data.refresh_token,
      qa_user_email: email,
    });
    displayEmail.textContent = email;
    showMain();
    await loadProjects();
    await refreshBufferUI();
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    btnSignin.disabled = false;
    btnSignin.textContent = 'Sign in';
  }
});

authPassword.addEventListener('keydown', e => { if (e.key === 'Enter') btnSignin.click(); });

// ── Auth: sign out ────────────────────────────────────────────────────────────
btnSignout.addEventListener('click', async () => {
  if (isRecording) await sendToActiveTab({ type: 'STOP_REPORTING' });
  await chrome.storage.local.remove([
    'qa_token', 'qa_refresh_token', 'qa_user_email', 'qa_recording',
    'qa_buffered_issues', 'qa_selected_project',
  ]);
  applyRecordingState(false);
  authError.textContent = '';
  authEmail.value = '';
  authPassword.value = '';
  showAuth();
});

// ── Project selection ─────────────────────────────────────────────────────────
projectSelect.addEventListener('change', async () => {
  const id   = projectSelect.value;
  const name = projectSelect.options[projectSelect.selectedIndex]?.textContent || '';
  if (id) {
    await chrome.storage.local.set({ qa_selected_project: { id, name } });
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PROJECT_MEMBERS', projectId: id });
    sessionMembers = resp.ok ? (resp.members || []) : [];
  } else {
    sessionMembers = [];
  }
});

// ── Recording toggle ──────────────────────────────────────────────────────────
btnToggleRecording.addEventListener('click', async () => {
  if (isRecording) { await stopRecording(); } else { await startRecording(); }
});

async function startRecording() {
  const projectId = projectSelect.value;
  if (!projectId) { showToast('Please select a project first.', 'error'); return; }

  btnToggleRecording.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_SETTINGS' });

    const tab = await getActiveTab();
    if (!tab) { showToast('No active tab found.', 'error'); return; }

    await chrome.storage.local.set({ qa_recording: true });
    applyRecordingState(true);

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING', members: sessionMembers });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content-styles.css'] });
      await new Promise(r => setTimeout(r, 300));
      await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING', members: sessionMembers });
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    await chrome.storage.local.set({ qa_recording: false });
    applyRecordingState(false);
  } finally {
    btnToggleRecording.disabled = false;
  }
}

async function stopRecording() {
  btnToggleRecording.disabled = true;
  try {
    await sendToActiveTab({ type: 'STOP_REPORTING' });
    await chrome.storage.local.set({ qa_recording: false });
    applyRecordingState(false);
    await refreshBufferUI();
  } catch (_) {
    await chrome.storage.local.set({ qa_recording: false });
    applyRecordingState(false);
    await refreshBufferUI();
  } finally {
    btnToggleRecording.disabled = false;
  }
}

// ── Submit all ────────────────────────────────────────────────────────────────
btnSubmitAll.addEventListener('click', async () => {
  const { qa_buffered_issues: issues = [] } = await chrome.storage.local.get(['qa_buffered_issues']);
  if (!issues.length) { showToast('No issues to submit.', 'error'); return; }

  btnSubmitAll.disabled = true;
  btnSubmitAll.textContent = 'Submitting…';

  try {
    const res = await chrome.runtime.sendMessage({ type: 'SUBMIT_ALL', issues });
    if (!res.ok) { showToast('Submit failed: ' + res.error, 'error'); return; }

    const succeeded = res.results.filter(r => r.ok).length;
    const failed    = res.results.filter(r => !r.ok).length;

    if (failed === 0) {
      await chrome.storage.local.set({ qa_buffered_issues: [] });
      showToast(`✓ ${succeeded} issue${succeeded !== 1 ? 's' : ''} submitted!`);
    } else {
      const failedIssues = issues.filter((_, i) => !res.results[i].ok);
      await chrome.storage.local.set({ qa_buffered_issues: failedIssues });
      showToast(`${succeeded} submitted, ${failed} failed.`, 'error');
    }
    await refreshBufferUI();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btnSubmitAll.disabled = false;
    await refreshBufferUI();
  }
});

// ── Clear buffer ──────────────────────────────────────────────────────────────
btnClear.addEventListener('click', async () => {
  await chrome.storage.local.set({ qa_buffered_issues: [] });
  await refreshBufferUI();
  showToast('Buffer cleared.');
});

// ── Show/hide password ────────────────────────────────────────────────────────
document.getElementById('btn-toggle-pw').addEventListener('click', () => {
  const eyeOn  = document.getElementById('icon-eye');
  const eyeOff = document.getElementById('icon-eye-off');
  const show   = authPassword.type === 'password';
  authPassword.type    = show ? 'text' : 'password';
  eyeOn.style.display  = show ? 'none' : '';
  eyeOff.style.display = show ? '' : 'none';
});

// ── Live updates from content script ─────────────────────────────────────────
// When a new issue is buffered by the content script, refresh the panel
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.qa_buffered_issues) refreshBufferUI();
  if (changes.qa_recording) {
    applyRecordingState(!!changes.qa_recording.newValue);
  }
  if (changes.qa_screen_recording) {
    applyScreenRecordingState(!!changes.qa_screen_recording.newValue);
  }
  if (changes.qa_saved_replay) {
    applyReplayChip(changes.qa_saved_replay.newValue);
    // Show toast when a new recording is saved
    if (changes.qa_saved_replay.newValue?.data && !changes.qa_saved_replay.oldValue?.data) {
      const dur = formatDuration(changes.qa_saved_replay.newValue.duration || 0);
      showToast('Recording saved — ' + dur + ' captured', 'success', 4000);
    }
  }
  if (changes.qa_replay_status) {
    const status = changes.qa_replay_status.newValue;
    if (status === 'attached') {
      showToast('Bug submitted with replay attached ✓', 'success', 3500);
    } else if (status === 'skipped') {
      showToast('Bug submitted — replay was from a different tab, not attached', 'error', 5000);
    }
    // Clear the status signal
    if (status) chrome.storage.local.remove(['qa_replay_status']);
  }
});

// ── Screen recording countdown ────────────────────────────────────────────────
let _screenRecIntervalId = null;

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function startCountdown(totalSeconds) {
  clearInterval(_screenRecIntervalId);
  let remaining = totalSeconds;
  screenRecTimerEl.textContent = formatCountdown(remaining);
  screenRecTimerRow.style.display = 'block';

  _screenRecIntervalId = setInterval(async () => {
    remaining -= 1;
    screenRecTimerEl.textContent = formatCountdown(remaining);
    if (remaining <= 0) {
      clearInterval(_screenRecIntervalId);
      _screenRecIntervalId = null;
      // Delegate to background — it will saveRecording, set qa_screen_recording: false,
      // and write qa_saved_replay. storage.onChanged will update our UI.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) chrome.runtime.sendMessage({ type: 'STOP_SCREEN_RECORDING', tabId: tab.id });
    }
  }, 1000);
}

function stopCountdown() {
  clearInterval(_screenRecIntervalId);
  _screenRecIntervalId = null;
  screenRecTimerRow.style.display = 'none';
}

// ── Screen recording button ───────────────────────────────────────────────────
let isScreenRecording = false;

chrome.storage.local.get(['qa_screen_recording', 'qa_replay_window_ms'], function (result) {
  isScreenRecording = result.qa_screen_recording ?? false;
  const windowMs = result.qa_replay_window_ms ?? 120000;
  replayWindowSel.value = String(windowMs);
  applyScreenRecordingState(isScreenRecording);
});

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function applyReplayChip(savedReplay) {
  if (savedReplay && savedReplay.data) {
    replayChipDuration.textContent = formatDuration(savedReplay.duration || 0);
    try {
      replayChipUrl.textContent = new URL(savedReplay.url).hostname || savedReplay.url;
    } catch (_) {
      replayChipUrl.textContent = savedReplay.url || '';
    }
    replayChip.classList.add('show');
    btnScreenRec.disabled = true;
    replayWindowSel.disabled = true;
  } else {
    replayChip.classList.remove('show');
    // Only re-enable if not currently recording or in capture mode
    if (!isRecording) {
      btnScreenRec.disabled = false;
      replayWindowSel.disabled = false;
    }
  }
}

function applyScreenRecordingState(active) {
  isScreenRecording = active;
  if (active) {
    btnScreenRec.className = 'btn btn-screen-rec btn-full active';
    btnScreenRec.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="1.5"/></svg> Stop Recording Screen';
    const windowMs = Number(replayWindowSel.value) || 120000;
    startCountdown(Math.floor(windowMs / 1000));
  } else {
    btnScreenRec.className = 'btn btn-screen-rec btn-full';
    btnScreenRec.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="6" cy="6" r="2.5"/></svg> Start Recording Screen';
    stopCountdown();
  }
}

btnScreenRec.addEventListener('click', async function () {
  const next = !isScreenRecording;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showToast('No active tab found.', 'error'); return; }

  btnScreenRec.disabled = true;

  if (next) {
    applyScreenRecordingState(true);
    const res = await chrome.runtime.sendMessage({ type: 'START_SCREEN_RECORDING', tabId: tab.id });
    if (res && res.ok) {
      showToast('Screen recording ready — events are being captured.', 'success', 3000);
    } else {
      // Injection failed — revert UI
      applyScreenRecordingState(false);
      await chrome.storage.local.set({ qa_screen_recording: false });
      showToast('Recording failed: ' + (res?.error || 'could not inject on this page'), 'error', 5000);
    }
  } else {
    // Let background handle state — it calls saveRecording then sets qa_screen_recording: false
    // storage.onChanged will fire applyScreenRecordingState(false) for us
    chrome.runtime.sendMessage({ type: 'STOP_SCREEN_RECORDING', tabId: tab.id });
  }

  btnScreenRec.disabled = false;
});

replayWindowSel.addEventListener('change', function () {
  chrome.storage.local.set({ qa_replay_window_ms: Number(replayWindowSel.value) });
});

// ── Delete saved replay ───────────────────────────────────────────────────────
btnDeleteReplay.addEventListener('click', async function () {
  await chrome.storage.local.remove(['qa_saved_replay']);
  applyReplayChip(null);
  showToast('Recording deleted', 'success', 2500);
});

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
