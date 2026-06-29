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

    // Guard: rrweb must be available (the rrweb.min.js file injection must have run
    // first and must be a UMD/global build that defines window.rrweb).
    if (typeof rrweb === 'undefined' || typeof rrweb.record !== 'function') {
      window.__qaReplayError = 'rrweb not available after injection';
      window.__qaReplayActive = false;
      return;
    }

    try {
      // rrweb EventType: FullSnapshot = 2, Meta = 4.
      // A rolling window cannot be trimmed by naively dropping the oldest events:
      // every IncrementalSnapshot references node IDs established by the preceding
      // FullSnapshot, so if the FullSnapshot is dropped the buffer becomes unplayable.
      // checkoutEveryNms makes rrweb emit fresh FullSnapshots periodically; trimEvents
      // then only drops events *before* the most recent FullSnapshot that is already
      // older than the window, keeping a valid base for everything we retain.
      var checkoutMs = Math.max(5000, Math.floor(_windowMs / 2));
      _stopFn = rrweb.record({
        emit: function (event) {
          _events.push(event);
          trimEvents();
        },
        maskAllInputs: true,
        checkoutEveryNms: checkoutMs,
      });
      _started = true;
    } catch (err) {
      window.__qaReplayError = err.message || String(err);
      window.__qaReplayActive = false;
    }
  }

  // Drop events older than the window, but never drop the FullSnapshot (and its
  // preceding Meta) that the retained events depend on. We keep everything from the
  // most recent FullSnapshot that is already older than the cutoff onward.
  function trimEvents() {
    var cutoff = Date.now() - _windowMs;
    var keepFrom = 0;
    for (var i = 0; i < _events.length; i++) {
      if (_events[i].timestamp > cutoff) break;
      if (_events[i].type === 2) {
        keepFrom = (i > 0 && _events[i - 1].type === 4) ? i - 1 : i;
      }
    }
    if (keepFrom > 0) _events.splice(0, keepFrom);
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
