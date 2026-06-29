// QA Reporter — Session Replay Recorder (injected on demand)
(function () {
  'use strict';

  // Increment generation on each injection so stale listeners from previous
  // recordings on the same tab don't respond to GET_REPLAY_EVENTS / STOP_REPLAY.
  window.__qaReplayGeneration = (window.__qaReplayGeneration || 0) + 1;
  var myGeneration = window.__qaReplayGeneration;

  window.__qaReplayActive = true;

  var _events = [];
  var _windowMs = 2 * 60 * 1000;
  var _stopFn = null;

  function startRecording(windowMs) {
    _windowMs = windowMs || _windowMs;
    _events = [];
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
  }

  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events = [];
    window.__qaReplayActive = false;
  }

  // When user switches away from this tab, tell background to save + stop
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && window.__qaReplayActive && window.__qaReplayGeneration === myGeneration) {
      chrome.runtime.sendMessage({ type: 'AUTO_STOP_RECORDING' });
    }
  });

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    // Ignore messages if a newer injection has taken over
    if (window.__qaReplayGeneration !== myGeneration) return false;

    if (message.type === 'GET_REPLAY_EVENTS') {
      sendResponse({ ok: true, events: _events.slice() });
      return true;
    }
    if (message.type === 'STOP_REPLAY') {
      stopRecording();
      sendResponse({ ok: true });
      return true;
    }
  });

  chrome.storage.local.get(['qa_replay_window_ms'], function (result) {
    startRecording(result.qa_replay_window_ms || 2 * 60 * 1000);
  });
})();
