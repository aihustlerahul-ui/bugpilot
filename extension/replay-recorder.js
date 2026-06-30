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
      var checkoutMs = Math.max(5000, Math.floor(_windowMs / 2));

      _stopFn = rrweb.record({
        emit: function (event) {
          _events.push(event);
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
        recordCanvas:     4,

        slimDOM: true,

        sampling: {
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
