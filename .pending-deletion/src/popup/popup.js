/**
 * QA Reporter Popup Script
 * Handles popup UI interactions
 */

(function() {
  'use strict';

  var MESSAGE_TYPES = {
    START_REPORTING: 'START_REPORTING',
    STOP_REPORTING: 'STOP_REPORTING',
    REPORTING_STATUS: 'REPORTING_STATUS',
    SAVE_ISSUE: 'SAVE_ISSUE',
    GET_ISSUES: 'GET_ISSUES',
    DELETE_ISSUE: 'DELETE_ISSUE',
    CLEAR_ISSUES: 'CLEAR_ISSUES',
    EXPORT_ISSUES: 'EXPORT_ISSUES',
    GET_ISSUE_COUNT: 'GET_ISSUE_COUNT'
  };

  var STORAGE_KEYS = {
    ISSUES: 'qa_reporter_issues',
    REPORTING_MODE: 'qa_reporter_mode'
  };

  // DOM Elements
  var btnStart = document.getElementById('btn-start');
  var btnStop = document.getElementById('btn-stop');
  var btnExport = document.getElementById('btn-export');
  var btnClear = document.getElementById('btn-clear');
  var statusDot = document.querySelector('.status-dot');
  var statusText = document.getElementById('status-text');
  var issueCountEl = document.getElementById('issue-count');
  var toastEl = document.getElementById('toast');

  /**
   * Initialize popup
   */
  async function init() {
    await updateStatus();
    await updateIssueCount();
    attachEventListeners();
  }

  /**
   * Updates the reporting status display
   */
  async function updateStatus() {
    try {
      var result = await chrome.storage.local.get(STORAGE_KEYS.REPORTING_MODE);
      var isReporting = result[STORAGE_KEYS.REPORTING_MODE] || false;

      if (isReporting) {
        statusDot.classList.add('active');
        statusText.textContent = 'Reporting Active';
        btnStart.disabled = true;
        btnStop.disabled = false;
      } else {
        statusDot.classList.remove('active');
        statusText.textContent = 'Ready';
        btnStart.disabled = false;
        btnStop.disabled = true;
      }
    } catch (error) {
      console.error('Failed to get status:', error);
    }
  }

  /**
   * Updates the issue count
   */
  async function updateIssueCount() {
    try {
      var result = await chrome.storage.local.get(STORAGE_KEYS.ISSUES);
      var issues = result[STORAGE_KEYS.ISSUES] || [];
      issueCountEl.textContent = issues.length;

      // Disable export/clear if no issues
      var hasIssues = issues.length > 0;
      btnExport.disabled = !hasIssues;
      btnClear.disabled = !hasIssues;
    } catch (error) {
      console.error('Failed to get issue count:', error);
      issueCountEl.textContent = '0';
    }
  }

  /**
   * Attaches event listeners to buttons
   */
  function attachEventListeners() {
    btnStart.addEventListener('click', handleStartReporting);
    btnStop.addEventListener('click', handleStopReporting);
    btnExport.addEventListener('click', handleExportIssues);
    btnClear.addEventListener('click', handleClearIssues);
  }

  /**
   * Returns true if the tab URL is injectable (not chrome://, about:, extension pages, etc.)
   */
  function isInjectableTab(tab) {
    if (!tab || !tab.url) return false;
    var url = tab.url;
    var blocked = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'data:', 'file://'];
    return !blocked.some(function(prefix) { return url.startsWith(prefix); });
  }

  /**
   * Tries to inject the content script into a tab programmatically,
   * used as a fallback when the script hasn't loaded (e.g. tab was open before extension install).
   */
  async function injectContentScript(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['content/styles.css']
    });
    // Give the script a moment to initialise
    await new Promise(function(resolve) { setTimeout(resolve, 300); });
  }

  /**
   * Sends a message to the content script, injecting it first if not present.
   */
  async function sendToContentScript(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (firstErr) {
      // Content script not present — try injecting it
      try {
        await injectContentScript(tabId);
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (secondErr) {
        throw secondErr;
      }
    }
  }

  /**
   * Handles start reporting button
   */
  async function handleStartReporting() {
    btnStart.disabled = true;

    try {
      var [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        showToast('No active tab found', 'error');
        btnStart.disabled = false;
        return;
      }

      if (!isInjectableTab(tab)) {
        showToast('Navigate to a regular webpage first (not chrome:// pages)', 'error');
        btnStart.disabled = false;
        return;
      }

      await sendToContentScript(tab.id, { type: MESSAGE_TYPES.START_REPORTING });

      await chrome.storage.local.set({ qa_reporter_mode: true });

      statusDot.classList.add('active');
      statusText.textContent = 'Reporting Active';
      btnStart.disabled = true;
      btnStop.disabled = false;

      showToast('Reporting mode started', 'success');

      setTimeout(function() { window.close(); }, 500);
    } catch (error) {
      console.error('Failed to start reporting:', error);
      var msg = error.message || '';
      if (msg.includes('Cannot access') || msg.includes('Missing host permission')) {
        showToast('Cannot access this page. Try a regular website.', 'error');
      } else {
        showToast('Failed to start. Reload the page and try again.', 'error');
      }
      btnStart.disabled = false;
    }
  }

  /**
   * Handles stop reporting button
   */
  async function handleStopReporting() {
    btnStop.disabled = true;

    try {
      // Get current tab
      var [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab && isInjectableTab(tab)) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.STOP_REPORTING });
        } catch(e) { /* tab may have navigated away — storage update below is enough */ }
      }

      // Update storage
      await chrome.storage.local.set({ qa_reporter_mode: false });

      // Update UI
      statusDot.classList.remove('active');
      statusText.textContent = 'Ready';
      btnStart.disabled = false;
      btnStop.disabled = true;

      showToast('Reporting mode stopped', 'success');
    } catch (error) {
      console.error('Failed to stop reporting:', error);
      showToast('Failed to stop reporting mode', 'error');
      btnStop.disabled = false;
    }
  }

  /**
   * Handles export issues button
   */
  async function handleExportIssues() {
    try {
      var result = await chrome.storage.local.get(STORAGE_KEYS.ISSUES);
      var issues = result[STORAGE_KEYS.ISSUES] || [];

      if (issues.length === 0) {
        showToast('No issues to export', 'error');
        return;
      }

      // Create download
      var date = new Date().toISOString().split('T')[0];
      var filename = 'qa-issues-' + date + '.json';
      var blob = new Blob([JSON.stringify(issues, null, 2)], {
        type: 'application/json'
      });
      var url = URL.createObjectURL(blob);

      await chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      });

      showToast('Exporting ' + issues.length + ' issues', 'success');
    } catch (error) {
      console.error('Failed to export issues:', error);
      showToast('Failed to export issues', 'error');
    }
  }

  /**
   * Handles clear issues button
   */
  async function handleClearIssues() {
    try {
      var result = await chrome.storage.local.get(STORAGE_KEYS.ISSUES);
      var issues = result[STORAGE_KEYS.ISSUES] || [];

      if (issues.length === 0) {
        showToast('No issues to clear', 'error');
        return;
      }

      // Show confirmation
      var confirmed = confirm('Are you sure you want to clear all ' + issues.length + ' issues? This cannot be undone.');

      if (!confirmed) {
        return;
      }

      // Clear issues
      await chrome.storage.local.set({ qa_reporter_issues: [] });

      // Update UI
      issueCountEl.textContent = '0';
      btnExport.disabled = true;
      btnClear.disabled = true;

      showToast('All issues cleared', 'success');
    } catch (error) {
      console.error('Failed to clear issues:', error);
      showToast('Failed to clear issues', 'error');
    }
  }

  /**
   * Shows a toast notification
   */
  function showToast(message, type) {
    type = type || 'success';

    toastEl.textContent = message;
    toastEl.className = 'toast ' + type + ' show';

    setTimeout(function() {
      toastEl.classList.remove('show');
    }, 3000);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
