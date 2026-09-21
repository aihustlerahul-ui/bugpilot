// QA Reporter — Session Replay Recorder (injected on demand)
(function () {
  'use strict';

  if (typeof window.__qaReplayTeardown === 'function') {
    try { window.__qaReplayTeardown(); } catch (_) {}
  }

  window.__qaReplayGeneration = (window.__qaReplayGeneration || 0) + 1;
  var myGeneration = window.__qaReplayGeneration;

  window.__qaReplayActive = true;
  window.__qaReplayError  = null;

  var _events   = [];
  var _windowMs = 2 * 60 * 1000;
  var _maxBufferBytes = 50 * 1024 * 1024; // 50MB limit
  var _maxEventCount  = 10000;            // 10k event limit
  var _bufferBytesEstimate = 0;
  var _stopFn   = null;
  var _started  = false;

  function estimateEventBytes(event) {
    try {
      // Fast heuristic for rrweb event size (JSON string length * 2 in JS memory)
      var str = JSON.stringify(event);
      return str ? str.length * 2 : 256;
    } catch (_) {
      return 256;
    }
  }

  function startRecording(windowMs) {
    _windowMs = windowMs || _windowMs;
    _events = [];
    _bufferBytesEstimate = 0;

    if (typeof rrweb === 'undefined' || typeof rrweb.record !== 'function') {
      window.__qaReplayError = 'rrweb not available after injection';
      window.__qaReplayActive = false;
      return;
    }

    try {
      var checkoutMs = Math.max(5000, Math.floor(_windowMs / 2));

      _stopFn = rrweb.record({
        emit: function (event) {
          _events.push(event);
          _bufferBytesEstimate += estimateEventBytes(event);
          trimEvents();
        },

        maskAllInputs: true,
        maskInputOptions: {
          password: true,
          email:    true,
          tel:      true,
          text:     false,
          number:   false,
          search:   false,
          textarea: false,
          select:   false,
          radio:    false,
          checkbox: false,
        },
        maskTextSelector: '[data-qa-mask], [data-private]',
        blockSelector: '[data-qa-block]',
        ignoreClass: 'qa-ignore',

        inlineStylesheet: true,
        collectFonts:     true,
        inlineImages:     false,
        recordCanvas:     true,

        slimDOM: true,
        slimDOMOptions: {
          script: true,
          comment: true,
          headFavicon: true,
          headWhitespace: true,
          headMetaDescKeywords: true,
          headMetaSocial: true,
        },

        sampling: {
          canvas:            2,
          mousemove:         50,
          mousemoveCallback: 500,
          scroll:            150,
          media:             800,
          input:             'last',
        },

        checkoutEveryNms: checkoutMs,
      });
      _started = true;
    } catch (err) {
      window.__qaReplayError = err.message || String(err);
      window.__qaReplayActive = false;
    }
  }

  var _lastForcedSnapshotTime = 0;

  function recalculateBufferBytes() {
    var total = 0;
    for (var i = 0; i < _events.length; i++) {
      total += estimateEventBytes(_events[i]);
    }
    _bufferBytesEstimate = total;
  }

  function trimEvents() {
    var cutoff    = Date.now() - _windowMs;
    var keepFrom  = 0;
    var lastSnapshotIdx = -1;

    // 1. Time-based cutoff (always align to FullSnapshot)
    for (var i = 0; i < _events.length; i++) {
      if (_events[i].type === 2 /* FullSnapshot */) {
        lastSnapshotIdx = (i > 0 && _events[i - 1].type === 4 /* Meta */) ? i - 1 : i;
      }
      if (_events[i].timestamp > cutoff) break;
      if (lastSnapshotIdx !== -1) {
        keepFrom = lastSnapshotIdx;
      }
    }

    if (keepFrom > 0) {
      _events.splice(0, keepFrom);
      recalculateBufferBytes();
    }

    // 2. Memory / Byte-size & Event Count limit enforcement (Max 50MB or 10k events)
    if (_bufferBytesEstimate > _maxBufferBytes || _events.length > _maxEventCount) {
      var fullSnapshotIndices = [];
      for (var j = 1; j < _events.length; j++) {
        if (_events[j].type === 2 /* FullSnapshot */) {
          var snapIdx = (j > 0 && _events[j - 1].type === 4 /* Meta */) ? j - 1 : j;
          fullSnapshotIndices.push(snapIdx);
        }
      }

      if (fullSnapshotIndices.length > 0) {
        // Prune to the earliest FullSnapshot that brings us under limits, or the latest available snapshot
        var targetCut = fullSnapshotIndices[fullSnapshotIndices.length - 1];
        var runningPruneBytes = 0;
        var currentSnapIdx = 0;

        for (var k = 0; k < _events.length; k++) {
          if (currentSnapIdx < fullSnapshotIndices.length && k === fullSnapshotIndices[currentSnapIdx]) {
            var remainingBytes = _bufferBytesEstimate - runningPruneBytes;
            var remainingCount = _events.length - k;
            if (remainingBytes <= _maxBufferBytes && remainingCount <= _maxEventCount) {
              targetCut = k;
              break;
            }
            currentSnapIdx++;
          }
          runningPruneBytes += estimateEventBytes(_events[k]);
        }

        if (targetCut > 0) {
          _events.splice(0, targetCut);
          recalculateBufferBytes();
        }
      } else {
        // No subsequent FullSnapshot yet in buffer. If memory limit is breached, force a new FullSnapshot
        var now = Date.now();
        if (now - _lastForcedSnapshotTime > 3000) {
          _lastForcedSnapshotTime = now;
          if (typeof rrweb !== 'undefined' && (typeof rrweb.record === 'object' || typeof rrweb.record === 'function')) {
            var takeSnap = (rrweb.record && typeof rrweb.record.takeFullSnapshot === 'function') ? rrweb.record.takeFullSnapshot : (typeof rrweb.takeFullSnapshot === 'function' ? rrweb.takeFullSnapshot : null);
            if (takeSnap) {
              try {
                takeSnap(true);
              } catch (_) {}
            }
          }
        }
      }
    }
  }

  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events  = [];
    _bufferBytesEstimate = 0;
    _started = false;
    window.__qaReplayActive = false;
  }

  function onReplayMessage(message, _sender, sendResponse) {
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
    return false;
  }

  function teardown() {
    try {
      if (window.__qaReplayMessageHandler) {
        chrome.runtime.onMessage.removeListener(window.__qaReplayMessageHandler);
      }
    } catch (_) {}
    stopRecording();
  }

  window.__qaReplayTeardown = teardown;
  window.__qaReplayMessageHandler = onReplayMessage;

  // No visibilitychange / chrome.storage / sendMessage here — those throw when the
  // extension context is stale. Stop recording from the side panel only.

  var runtimeReady = false;
  try {
    runtimeReady = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  } catch (_) {
    runtimeReady = false;
  }

  if (!runtimeReady) {
    window.__qaReplayError = 'Extension context invalidated — reload the tab and try again';
    window.__qaReplayActive = false;
    return;
  }

  try { chrome.runtime.onMessage.removeListener(onReplayMessage); } catch (_) {}
  chrome.runtime.onMessage.addListener(onReplayMessage);

  var windowMs = typeof window.__qaReplayWindowMs === 'number'
    ? window.__qaReplayWindowMs
    : 2 * 60 * 1000;
  startRecording(windowMs);
  if (!_started) {
    try {
      chrome.runtime.sendMessage({
        type: 'REPLAY_START_FAILED',
        error: window.__qaReplayError || 'unknown error',
      });
    } catch (_) {}
  }
})();
