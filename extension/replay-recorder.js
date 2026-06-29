// QA Reporter — Session Replay Recorder (injected on demand)
(function () {
  'use strict';

  // Increment generation on each injection so stale listeners from previous
  // recordings on the same tab don't respond to GET_REPLAY_EVENTS / STOP_REPLAY.
  window.__qaReplayGeneration = (window.__qaReplayGeneration || 0) + 1;
  var myGeneration = window.__qaReplayGeneration;

  window.__qaReplayActive = true;
  window.__qaReplayError  = null;

  var _events = [];
  var _windowMs = 2 * 60 * 1000;
  var _stopFn = null;
  var _started = false;

  function startRecording(windowMs) {
    _windowMs = windowMs || _windowMs;
    _events = [];

    // Guard: rrweb must be available (eval may have failed silently)
    if (typeof rrweb === 'undefined' || typeof rrweb.record !== 'function') {
      window.__qaReplayError = 'rrweb not available after injection';
      window.__qaReplayActive = false;
      return;
    }

    try {
      _stopFn = rrweb.record({
        emit: function (event) {
          _events.push(event);
          var cutoff = Date.now() - _windowMs;
          while (_events.length > 0 && _events[0].timestamp < cutoff) {
            _events.shift();
          }
        },
        maskAllInputs: true,
      });
      _started = true;
    } catch (err) {
      window.__qaReplayError = err.message || String(err);
      window.__qaReplayActive = false;
    }
  }

  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events = [];
    _started = false;
    window.__qaReplayActive = false;
  }

  // When user switches away from this tab, tell background to save + stop
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && _started && window.__qaReplayGeneration === myGeneration) {
      chrome.runtime.sendMessage({ type: 'AUTO_STOP_RECORDING' });
    }
  });

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    // Ignore if a newer injection has taken over
    if (window.__qaReplayGeneration !== myGeneration) return false;

    if (message.type === 'GET_REPLAY_EVENTS') {
      sendResponse({ ok: true, events: _events.slice(), started: _started, error: window.__qaReplayError });
      return true;
    }
    if (message.type === 'STOP_REPLAY') {
      stopRecording();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'PING_REPLAY') {
      sendResponse({ ok: true, started: _started, error: window.__qaReplayError });
      return true;
    }
  });

  chrome.storage.local.get(['qa_replay_window_ms'], function (result) {
    startRecording(result.qa_replay_window_ms || 2 * 60 * 1000);
    // Notify background if recording failed to start
    if (!_started) {
      chrome.runtime.sendMessage({
        type: 'REPLAY_START_FAILED',
        error: window.__qaReplayError || 'unknown error',
      });
    }
  });
})();
