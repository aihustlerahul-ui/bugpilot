// QA Reporter — Popup Script
'use strict';

const SUPABASE_URL = 'https://faasplsazadmtixuwzsn.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYXNwbHNhemFkbXRpeHV3enNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTYyOTIsImV4cCI6MjA5Nzc5MjI5Mn0.hagIYaR3QzF41p99VQJU0J1C7_lnabBqlJ6MAhl7tbw';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const viewAuth = document.getElementById('view-auth');
const viewMain = document.getElementById('view-main');

const authEmail    = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authError    = document.getElementById('auth-error');
const btnSignin    = document.getElementById('btn-signin');

const displayEmail       = document.getElementById('display-email');
const btnSignout         = document.getElementById('btn-signout');
const statusBar          = document.getElementById('status-bar');
const statusText         = document.getElementById('status-text');
const projectSelect      = document.getElementById('project-select');
const btnToggleRecording = document.getElementById('btn-toggle-recording');
const bufferBadge        = document.getElementById('buffer-badge');
const bufferActions      = document.getElementById('buffer-actions');
const btnSubmitAll       = document.getElementById('btn-submit-all');
const btnClear           = document.getElementById('btn-clear');
const toast              = document.getElementById('toast');

// ── State ─────────────────────────────────────────────────────────────────────
let isRecording = false;

// ── View helpers ──────────────────────────────────────────────────────────────
function showAuth() {
  viewAuth.classList.add('active');
  viewMain.classList.remove('active');
}

function showMain() {
  viewMain.classList.add('active');
  viewAuth.classList.remove('active');
}

function showToast(msg, type = 'success', durationMs = 3000) {
  toast.textContent = msg;
  toast.className = `show ${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.className = ''; }, durationMs);
}

// ── Buffer UI ─────────────────────────────────────────────────────────────────
async function refreshBufferUI() {
  const { qa_buffered_issues: issues = [] } = await chrome.storage.local.get(['qa_buffered_issues']);
  const count = issues.length;

  bufferBadge.textContent = count;
  bufferBadge.className = `buffer-badge${count === 0 ? ' zero' : ''}`;

  if (count > 0) {
    bufferActions.style.display = 'flex';
    btnSubmitAll.textContent = `Submit All (${count})`;
  } else {
    bufferActions.style.display = 'none';
  }
}

// ── Recording UI ──────────────────────────────────────────────────────────────
function applyRecordingState(recording) {
  isRecording = recording;
  if (recording) {
    statusBar.className = 'status-bar recording';
    statusText.textContent = 'Recording…';
    btnToggleRecording.className = 'btn btn-stop';
    btnToggleRecording.textContent = '■ Stop Recording';
  } else {
    statusBar.className = 'status-bar idle';
    statusText.textContent = 'Ready to record';
    btnToggleRecording.className = 'btn btn-record';
    btnToggleRecording.textContent = '▶ Start Recording';
  }
}

// ── Projects ──────────────────────────────────────────────────────────────────
async function loadProjects() {
  projectSelect.innerHTML = '<option value="">Loading…</option>';
  projectSelect.disabled = true;

  const response = await chrome.runtime.sendMessage({ type: 'GET_PROJECTS' });

  if (!response.ok) {
    const errMsg = response.error || 'Failed to load projects';
    // 401 = token expired — force sign out
    if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
      await chrome.storage.local.remove(['qa_token', 'qa_user_email', 'qa_recording']);
      authError.textContent = 'Session expired — please sign in again.';
      showAuth();
      return;
    }
    projectSelect.innerHTML = `<option value="">Error: ${errMsg}</option>`;
    projectSelect.disabled = false;
    return;
  }

  const projects = response.projects || [];
  projectSelect.innerHTML = '';

  if (projects.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No projects — create one in the dashboard';
    projectSelect.appendChild(opt);
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a project…';
    projectSelect.appendChild(placeholder);

    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      projectSelect.appendChild(opt);
    });

    // Restore previously selected project
    const { qa_selected_project } = await chrome.storage.local.get(['qa_selected_project']);
    if (qa_selected_project && projects.some(p => p.id === qa_selected_project.id)) {
      projectSelect.value = qa_selected_project.id;
    }
  }

  projectSelect.disabled = false;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const { qa_token, qa_user_email, qa_recording } = await chrome.storage.local.get([
    'qa_token',
    'qa_user_email',
    'qa_recording',
  ]);

  if (!qa_token) {
    showAuth();
    return;
  }

  displayEmail.textContent = qa_user_email || 'Signed in';
  showMain();

  // Verify the active tab's content script is actually recording.
  // If it doesn't respond (e.g. page refreshed, new tab), clear the stale flag.
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
  await loadProjects();
  await refreshBufferUI();
}

// ── Auth: Sign in ─────────────────────────────────────────────────────────────
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
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email, password }),
      }
    );
    const data = await res.json();

    if (data.error || !data.access_token) {
      authError.textContent = data.error_description || data.error || 'Login failed.';
      return;
    }

    await chrome.storage.local.set({
      qa_token: data.access_token,
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

// Allow Enter key in password field to submit
authPassword.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnSignin.click();
});

// ── Auth: Sign out ────────────────────────────────────────────────────────────
btnSignout.addEventListener('click', async () => {
  // Stop recording first if active
  if (isRecording) {
    await sendToActiveTab({ type: 'STOP_REPORTING' });
  }
  await chrome.storage.local.remove([
    'qa_token',
    'qa_user_email',
    'qa_recording',
    'qa_buffered_issues',
    'qa_selected_project',
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
  }
});

// ── Recording toggle ──────────────────────────────────────────────────────────
btnToggleRecording.addEventListener('click', async () => {
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  const projectId = projectSelect.value;
  if (!projectId) {
    showToast('Please select a project first.', 'error');
    return;
  }

  btnToggleRecording.disabled = true;
  try {
    // Pull latest settings from the platform before recording starts
    await chrome.runtime.sendMessage({ type: 'SYNC_SETTINGS' });

    const tab = await getActiveTab();
    if (!tab) { showToast('No active tab found.', 'error'); return; }

    await chrome.storage.local.set({ qa_recording: true });
    applyRecordingState(true);

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING' });
    } catch (_) {
      // Content script not yet loaded — inject it then retry
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content-styles.css'] });
      await new Promise(r => setTimeout(r, 300));
      await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING' });
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
  } catch (err) {
    // Content script may be gone (navigation); still update state
    await chrome.storage.local.set({ qa_recording: false });
    applyRecordingState(false);
    await refreshBufferUI();
  } finally {
    btnToggleRecording.disabled = false;
  }
}

// ── Submit All ────────────────────────────────────────────────────────────────
btnSubmitAll.addEventListener('click', async () => {
  const { qa_buffered_issues: issues = [] } = await chrome.storage.local.get(['qa_buffered_issues']);
  if (issues.length === 0) { showToast('No issues to submit.', 'error'); return; }

  btnSubmitAll.disabled = true;
  btnSubmitAll.textContent = 'Submitting…';

  try {
    const res = await chrome.runtime.sendMessage({ type: 'SUBMIT_ALL', issues });
    if (!res.ok) { showToast('Submit failed: ' + res.error, 'error'); return; }

    const failed = res.results.filter(r => !r.ok).length;
    const succeeded = res.results.filter(r => r.ok).length;

    if (failed === 0) {
      await chrome.storage.local.set({ qa_buffered_issues: [] });
      showToast(`✓ ${succeeded} issue${succeeded !== 1 ? 's' : ''} submitted!`, 'success');
    } else {
      // Keep only the failed ones
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
  showToast('Buffer cleared.', 'success');
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (_) {
    return null;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
