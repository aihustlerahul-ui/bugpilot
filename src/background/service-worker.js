/**
 * QA Reporter Background Service Worker
 * Handles storage, exports, and communication
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
    GET_ISSUE_COUNT: 'GET_ISSUE_COUNT',
    CAPTURE_SCREENSHOT: 'CAPTURE_SCREENSHOT',
    ERROR: 'ERROR'
  };

  var STORAGE_KEYS = {
    ISSUES: 'qa_reporter_issues',
    REPORTING_MODE: 'qa_reporter_mode'
  };

  /**
   * Handles messages from popup and content scripts
   */
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    handleMessage(message, sender, sendResponse);
    return true;
  });

  /**
   * Routes messages to appropriate handlers
   */
  async function handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case MESSAGE_TYPES.SAVE_ISSUE:
          await handleSaveIssue(message.data, sendResponse);
          break;

        case MESSAGE_TYPES.GET_ISSUES:
          await handleGetIssues(sendResponse);
          break;

        case MESSAGE_TYPES.DELETE_ISSUE:
          await handleDeleteIssue(message.id, sendResponse);
          break;

        case MESSAGE_TYPES.CLEAR_ISSUES:
          await handleClearIssues(sendResponse);
          break;

        case MESSAGE_TYPES.EXPORT_ISSUES:
          await handleExportIssues(sendResponse);
          break;

        case MESSAGE_TYPES.GET_ISSUE_COUNT:
          await handleGetIssueCount(sendResponse);
          break;

        case MESSAGE_TYPES.REPORTING_STATUS:
          await handleReportingStatus(sendResponse);
          break;

        case MESSAGE_TYPES.CAPTURE_SCREENSHOT:
          handleCaptureScreenshot(sender, sendResponse);
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('QA Reporter Error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Gets issues from storage
   */
  async function getIssuesFromStorage() {
    var result = await chrome.storage.local.get(STORAGE_KEYS.ISSUES);
    return result[STORAGE_KEYS.ISSUES];
  }

  /**
   * Saves an issue
   */
  async function handleSaveIssue(issueData, sendResponse) {
    try {
      var issues = (await getIssuesFromStorage()) || [];
      issues.push(issueData);
      await chrome.storage.local.set({ qa_reporter_issues: issues });
      sendResponse({ success: true, issueId: issueData.id });
    } catch (error) {
      sendResponse({ success: false, error: 'Failed to save issue' });
    }
  }

  /**
   * Gets all issues
   */
  async function handleGetIssues(sendResponse) {
    try {
      var issues = (await getIssuesFromStorage()) || [];
      sendResponse({ success: true, issues: issues });
    } catch (error) {
      sendResponse({ success: false, error: 'Failed to get issues' });
    }
  }

  /**
   * Deletes an issue
   */
  async function handleDeleteIssue(issueId, sendResponse) {
    try {
      var issues = (await getIssuesFromStorage()) || [];
      var filteredIssues = issues.filter(function(issue) {
        return issue.id !== issueId;
      });
      await chrome.storage.local.set({ qa_reporter_issues: filteredIssues });
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: 'Failed to delete issue' });
    }
  }

  /**
   * Clears all issues
   */
  async function handleClearIssues(sendResponse) {
    try {
      await chrome.storage.local.set({ qa_reporter_issues: [] });
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: 'Failed to clear issues' });
    }
  }

  /**
   * Exports issues as JSON
   */
  async function handleExportIssues(sendResponse) {
    try {
      var issues = (await getIssuesFromStorage()) || [];

      if (issues.length === 0) {
        sendResponse({ success: false, error: 'No issues to export' });
        return;
      }

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

      sendResponse({ success: true, filename: filename });
    } catch (error) {
      sendResponse({ success: false, error: 'Failed to export issues' });
    }
  }

  /**
   * Gets issue count
   */
  async function handleGetIssueCount(sendResponse) {
    try {
      var issues = (await getIssuesFromStorage()) || [];
      sendResponse({ success: true, count: issues.length });
    } catch (error) {
      sendResponse({ success: false, error: 'Failed to get issue count' });
    }
  }

  /**
   * Gets reporting status
   */
  async function handleReportingStatus(sendResponse) {
    try {
      var result = await chrome.storage.local.get(STORAGE_KEYS.REPORTING_MODE);
      sendResponse({
        success: true,
        isReporting: result[STORAGE_KEYS.REPORTING_MODE] || false
      });
    } catch (error) {
      sendResponse({ success: false, error: 'Failed to get reporting status' });
    }
  }

  /**
   * Captures a screenshot of the visible tab.
   * Must run in the service worker — captureVisibleTab is not available in content scripts.
   */
  function handleCaptureScreenshot(sender, sendResponse) {
    try {
      var tabId = sender && sender.tab && sender.tab.windowId;
      chrome.tabs.captureVisibleTab(tabId || null, { format: 'jpeg', quality: 75 }, function(dataUrl) {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, dataUrl: dataUrl });
        }
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Extension installed handler
   */
  chrome.runtime.onInstalled.addListener(function() {
    chrome.storage.local.set({
      qa_reporter_issues: [],
      qa_reporter_mode: false
    });
  });

})();
