// QA Reporter — Session Replay Recorder (injected on demand)
(function () {
  'use strict';

  if (window.__qaReplayActive) return; // guard against double-injection
  window.__qaReplayActive = true;

  var _events = [];
  var _windowMs = 2 * 60 * 1000; // default 2 min, overridden by START message
  var _stopFn = null;

  function startRecording(windowMs) {
    _windowMs = windowMs || _windowMs;
    _events = [];

    _stopFn = rrweb.record({
      emit: function (event) {
        _events.push(event);
        // Rolling window: drop events outside the window from the front
        var cutoff = Date.now() - _windowMs;
        while (_events.length > 0 && _events[0].timestamp < cutoff) {
          _events.shift();
        }
      },
      // Mask all inputs by default to prevent PII capture
      maskAllInputs: true,
    });
  }

  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events = [];
    window.__qaReplayActive = false;
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message.type === 'GET_REPLAY_EVENTS') {
      sendResponse({ ok: true, events: _events.slice() });
      return true;
    }
    if (message.type === 'STOP_REPLAY') {
      stopRecording();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'START_REPLAY') {
      startRecording(message.windowMs);
      sendResponse({ ok: true });
      return true;
    }
  });

  // Auto-start — background.js injects this file after setting windowMs in the message
  // windowMs is passed via storage so it's available synchronously here
  chrome.storage.local.get(['qa_replay_window_ms'], function (result) {
    startRecording(result.qa_replay_window_ms || 2 * 60 * 1000);
  });
})();
