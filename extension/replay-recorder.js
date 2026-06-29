// QA Reporter — Session Replay Recorder (injected on demand)
(function () {
  'use strict';

  // Increment generation on each injection so stale listeners from previous
  // recordings on the same tab don't respond to GET_REPLAY_EVENTS / STOP_REPLAY.
  window.__qaReplayGeneration = (window.__qaReplayGeneration || 0) + 1;
  var myGeneration = window.__qaReplayGeneration;

  window.__qaReplayActive = true;
  window.__qaReplayError  = null;

  var _events   = [];
  var _windowMs = 2 * 60 * 1000;
  var _stopFn   = null;
  var _started  = false;

  function startRecording(windowMs) {
    _windowMs = windowMs || _windowMs;
    _events = [];

    if (typeof rrweb === 'undefined' || typeof rrweb.record !== 'function') {
      window.__qaReplayError = 'rrweb not available after injection';
      window.__qaReplayActive = false;
      return;
    }

    try {
      // checkoutEveryNms: emit periodic FullSnapshots so the rolling-window
      // trimmer always has a valid anchor. Set to half the window so we always
      // have at least one FullSnapshot within the kept segment.
      var checkoutMs = Math.max(5000, Math.floor(_windowMs / 2));

      _stopFn = rrweb.record({
        emit: function (event) {
          _events.push(event);
          trimEvents();
        },

        // ── Privacy ──────────────────────────────────────────────────────────
        maskAllInputs: true,          // mask all <input> values
        maskInputOptions: {
          password: true,
          email:    true,
          tel:      true,
          text:     false,            // plain text inputs visible for QA context
          number:   false,
          search:   false,
          textarea: false,
          select:   false,
          radio:    false,
          checkbox: false,
        },
        // Mask text inside elements matching this selector (e.g. PII fields)
        maskTextSelector: '[data-qa-mask], [data-private]',
        // Block screenshot of elements matching this selector
        blockSelector: '[data-qa-block]',
        // Ignore events from elements matching this selector
        ignoreClass: 'qa-ignore',

        // ── DOM fidelity ─────────────────────────────────────────────────────
        inlineStylesheet: true,       // inline <link rel="stylesheet"> so replay needs no network
        collectFonts:     true,       // capture @font-face so custom fonts render in replay
        inlineImages:     false,      // true = huge events; images load from URL in replay
        recordCanvas:     false,      // true requires UNSAFE_replayCanvas on player; off for now

        // Remove noisy / irrelevant DOM nodes from the snapshot to reduce size
        slimDOM: true,

        // ── Sampling (balance fidelity vs event volume) ───────────────────────
        sampling: {
          // Capture one mousemove sample per 50 ms (default) — gives smooth replay
          mousemove:         50,
          // Batch mousemove events and emit every 500 ms (default)
          mousemoveCallback: 500,
          // Capture scroll every 150 ms instead of every scroll event
          scroll:            150,
          // Capture all media interactions
          media:             800,
          // Capture all input events (no sampling)
          input:             'last',
        },

        // ── Rolling window ────────────────────────────────────────────────────
        // Emit a fresh FullSnapshot periodically so trimEvents can keep only the
        // tail of the buffer without breaking event references.
        checkoutEveryNms: checkoutMs,
      });
      _started = true;
    } catch (err) {
      window.__qaReplayError = err.message || String(err);
      window.__qaReplayActive = false;
    }
  }

  // Drop events older than the window, but never drop the FullSnapshot (and its
  // preceding Meta) that the retained events depend on. We keep everything from
  // the most recent FullSnapshot that is already outside the cutoff onward.
  function trimEvents() {
    var cutoff    = Date.now() - _windowMs;
    var keepFrom  = 0;
    for (var i = 0; i < _events.length; i++) {
      if (_events[i].timestamp > cutoff) break;
      if (_events[i].type === 2 /* FullSnapshot */) {
        keepFrom = (i > 0 && _events[i - 1].type === 4 /* Meta */) ? i - 1 : i;
      }
    }
    if (keepFrom > 0) _events.splice(0, keepFrom);
  }

  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events  = [];
    _started = false;
    window.__qaReplayActive = false;
  }

  // When user navigates away, tell background to save + stop
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && _started && window.__qaReplayGeneration === myGeneration) {
      chrome.runtime.sendMessage({ type: 'AUTO_STOP_RECORDING' });
    }
  });

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
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
    if (!_started) {
      chrome.runtime.sendMessage({
        type:  'REPLAY_START_FAILED',
        error: window.__qaReplayError || 'unknown error',
      });
    }
  });
})();
