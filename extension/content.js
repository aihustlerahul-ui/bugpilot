// QA Reporter — Content Script (MV3, IIFE, no imports)
(function () {
  'use strict';

  // One content-script instance per page load. After an extension reload the old
  // instance is disconnected but this flag persists on `window`; bump generation so
  // a fresh inject can take over (see replay-recorder.js for the same pattern).
  window.__qaContentGeneration = (window.__qaContentGeneration || 0) + 1;
  var myGeneration = window.__qaContentGeneration;

  function isCurrentInstance() {
    return window.__qaContentGeneration === myGeneration;
  }

  // ── Constants ───────────────────────────────────────────────────────────────
  var API_URL = 'http://localhost:4000';
  var BUFFER_KEY = 'qa_buffered_issues';

  var MESSAGE_TYPES = {
    START_REPORTING:    'START_REPORTING',
    STOP_REPORTING:     'STOP_REPORTING',
    CAPTURE_SCREENSHOT: 'CAPTURE_SCREENSHOT',
    SUBMIT_ISSUE:       'SUBMIT_ISSUE',
  };

  var CONSOLE_BUFFER_SIZE = 30;
  var NETWORK_BUFFER_SIZE = 15;
  var NETWORK_TRANSACTIONS_BUFFER_SIZE = 50;
  var NAV_HISTORY_SIZE    = 10;

  var OVERLAY_ID = 'qa-reporter-highlight';
  var MODAL_ID   = 'qa-reporter-modal';
  var DIM_ID     = 'qa-reporter-dim';

  var DATA_ATTRIBUTES = ['data-feature', 'data-component', 'data-module', 'data-testid', 'data-test-id', 'data-cy', 'data-qa'];

  var SEVERITY_LEVELS = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };

  var STYLE_KEYS = [
    'display', 'position', 'visibility', 'opacity',
    'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight',
    'textAlign', 'lineHeight', 'letterSpacing',
    'padding', 'margin', 'border', 'borderRadius',
    'width', 'height', 'overflow'
  ];

  // ── Client-Side Sanitization Engine & PII Redaction ──────────────────────────
  var DEFAULT_BLOCKED_PROP_PATTERNS = [
    '*token*', '*password*', '*secret*', '*auth*', '*apikey*', '*api_key*',
    '*credential*', '*privatekey*', '*private_key*', '*ssn*', '*creditcard*',
    '*cardnumber*', '*sessionid*', '*jwt*', '*bearer*', '*cookie*', '*cvv*', '*pin*'
  ];

  function matchesPattern(str, pattern) {
    if (!str || !pattern) return false;
    var s = String(str).toLowerCase();
    var p = String(pattern).toLowerCase();
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
      return s.indexOf(p.slice(1, -1)) !== -1;
    }
    if (p.startsWith('*')) {
      return s.endsWith(p.slice(1));
    }
    if (p.endsWith('*')) {
      return s.startsWith(p.slice(0, -1));
    }
    return s === p || s.indexOf(p) !== -1;
  }

  function isBlockedPropKey(key, customPatterns) {
    var patterns = (customPatterns && customPatterns.length > 0)
      ? DEFAULT_BLOCKED_PROP_PATTERNS.concat(customPatterns)
      : DEFAULT_BLOCKED_PROP_PATTERNS;
    for (var i = 0; i < patterns.length; i++) {
      if (matchesPattern(key, patterns[i])) return true;
    }
    return false;
  }

  var SanitizationEngine = {
    RE_CREDIT_CARD: /\b(?:\d[ -]*?){13,19}\b/g,
    RE_EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    RE_SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
    RE_AUTH_HEADER: /(["']?Authorization["']?\s*:\s*["']?(?:Bearer|Basic)\s+)[^"'\r\n\s]+/gi,
    RE_COOKIE_HEADER: /(["']?Cookie["']?\s*:\s*["']?)[^"'\r\n]+/gi,
    RE_URL_PARAMS: /([?&](?:token|access_token|refresh_token|auth|password|pwd|secret|apikey|api_key|api-key|sessionId|jwt|client_secret|private_key|privatekey)=)([^&#\s]+)/gi,

    sanitizeString: function (str) {
      if (typeof str !== 'string') return str;
      return str
        .replace(SanitizationEngine.RE_CREDIT_CARD, '[REDACTED_CARD]')
        .replace(SanitizationEngine.RE_EMAIL, '[REDACTED_EMAIL]')
        .replace(SanitizationEngine.RE_SSN, '[REDACTED_SSN]')
        .replace(SanitizationEngine.RE_AUTH_HEADER, '$1[REDACTED_AUTH]')
        .replace(SanitizationEngine.RE_COOKIE_HEADER, '$1[REDACTED_COOKIE]')
        .replace(SanitizationEngine.RE_URL_PARAMS, '$1[REDACTED]');
    },

    sanitizeUrl: function (url) {
      if (!url || typeof url !== 'string') return url;
      return SanitizationEngine.sanitizeString(url);
    }
  };

  // ── Early interceptors (always active) ─────────────────────────────────────
  var _consoleBuffer         = [];
  var _networkBuffer         = [];
  var _networkTransactions   = [];
  var _navigationHistory      = [];
  var _longTasksBuffer       = [];
  window.__qaConsoleBuffer    = _consoleBuffer;

  // ── Long Tasks Observer (>50ms UI freezes) ──────────────────────────────────
  try {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      var po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          _longTasksBuffer.push({
            name: entry.name,
            durationMs: Math.round(entry.duration),
            startTimeMs: Math.round(entry.startTime),
            containerType: entry.attribution && entry.attribution[0] ? entry.attribution[0].containerType : undefined,
            containerName: entry.attribution && entry.attribution[0] ? entry.attribution[0].containerName : undefined,
          });
          if (_longTasksBuffer.length > 20) _longTasksBuffer.shift();
        });
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (_) {}

  function setupConsoleInterceptor() {
    var levels = ['error', 'warn', 'info', 'log'];
    levels.forEach(function (level) {
      if (!console[level]) return;
      var original = console[level].bind(console);
      console[level] = function () {
        var args = Array.prototype.slice.call(arguments);
        var message;
        try {
          message = args.map(function (a) {
            if (typeof a === 'string') return SanitizationEngine.sanitizeString(a);
            if (typeof a === 'undefined') return 'undefined';
            if (a === null) return 'null';
            if (a instanceof Error || (a && typeof a === 'object' && (a.message || a.stack))) {
              return SanitizationEngine.sanitizeString((a.message || '') + (a.stack ? (a.message ? '\n' : '') + a.stack : ''));
            }
            try { return SanitizationEngine.sanitizeString(JSON.stringify(a)); } catch (e) { return SanitizationEngine.sanitizeString(String(a)); }
          }).join(' ');
        } catch (e) {
          message = SanitizationEngine.sanitizeString(String(args[0]));
        }
        _consoleBuffer.push({ level: level, message: message.substring(0, 500), timestamp: new Date().toISOString() });
        if (_consoleBuffer.length > CONSOLE_BUFFER_SIZE) _consoleBuffer.shift();
        original.apply(console, args);
      };
    });

    window.addEventListener('error', function (event) {
      if (!isCurrentInstance()) return;
      try {
        var errText = (event && event.message) || 'Script error';
        if (event && event.filename) {
          errText += ' (' + event.filename + (event.lineno ? ':' + event.lineno : '') + (event.colno ? ':' + event.colno : '') + ')';
        }
        if (event && event.error && event.error.stack) {
          errText += '\n' + event.error.stack;
        }
        var sanitized = SanitizationEngine.sanitizeString(errText);
        var isDup = _consoleBuffer.some(function (entry) {
          return entry.message === sanitized.substring(0, 500) &&
            Math.abs(new Date(entry.timestamp).getTime() - Date.now()) < 1000;
        });
        if (!isDup) {
          _consoleBuffer.push({
            level: 'error',
            message: sanitized.substring(0, 500),
            timestamp: new Date().toISOString()
          });
          if (_consoleBuffer.length > CONSOLE_BUFFER_SIZE) _consoleBuffer.shift();
        }
      } catch (_) {}
    });

    window.addEventListener('unhandledrejection', function (event) {
      if (!isCurrentInstance()) return;
      try {
        var reason = event && event.reason;
        var reasonText = '';
        if (reason instanceof Error || (reason && typeof reason === 'object' && (reason.message || reason.stack))) {
          reasonText = (reason.message || '') + (reason.stack ? (reason.message ? '\n' : '') + reason.stack : '');
        } else if (typeof reason === 'string') {
          reasonText = reason;
        } else if (reason) {
          try {
            reasonText = JSON.stringify(reason);
          } catch (_) {
            reasonText = String(reason);
          }
        }
        var fullMsg = 'Unhandled Promise Rejection: ' + (reasonText || 'Unknown reason');
        var sanitized = SanitizationEngine.sanitizeString(fullMsg);
        var isDup = _consoleBuffer.some(function (entry) {
          return entry.message === sanitized.substring(0, 500) &&
            Math.abs(new Date(entry.timestamp).getTime() - Date.now()) < 1000;
        });
        if (!isDup) {
          _consoleBuffer.push({
            level: 'error',
            message: sanitized.substring(0, 500),
            timestamp: new Date().toISOString()
          });
          if (_consoleBuffer.length > CONSOLE_BUFFER_SIZE) _consoleBuffer.shift();
        }
      } catch (_) {}
    });
  }

  function setupNetworkInterceptor() {
    var seenTxIds = {};

    function addNetworkTransaction(tx) {
      if (!tx || typeof tx !== 'object') return;
      if (tx.id && seenTxIds[tx.id]) return;
      if (tx.id) seenTxIds[tx.id] = true;

      _networkTransactions.push(tx);
      if (_networkTransactions.length > NETWORK_TRANSACTIONS_BUFFER_SIZE) {
        var removed = _networkTransactions.shift();
        if (removed && removed.id) delete seenTxIds[removed.id];
      }

      // Keep _networkBuffer updated for modal preview & backwards compat
      var st = String(tx.status);
      var isErr = st === 'failed' || st.startsWith('4') || st.startsWith('5');
      if (isErr) {
        _networkBuffer.push({
          method: tx.method || 'GET',
          url: (tx.url || '').substring(0, 200),
          status: tx.status,
          duration: tx.duration || 0,
          timestamp: tx.timestamp || new Date().toISOString()
        });
        if (_networkBuffer.length > NETWORK_BUFFER_SIZE) _networkBuffer.shift();
      }
    }

    // Listen for events from MAIN World network-interceptor.js
    window.addEventListener('message', function (event) {
      if (event.source !== window || !event.data) return;
      if (event.data.type === 'BUGPILOT_NETWORK_EVENT') {
        addNetworkTransaction(event.data.payload);
      } else if (event.data.type === 'BUGPILOT_CONSOLE_EVENT') {
        var payload = event.data.payload;
        if (payload && payload.message) {
          var sanitizedMsg = SanitizationEngine.sanitizeString(payload.message);
          var isDup = _consoleBuffer.some(function (entry) {
            return entry.message === sanitizedMsg.substring(0, 500) &&
              Math.abs(new Date(entry.timestamp).getTime() - new Date(payload.timestamp || new Date()).getTime()) < 1000;
          });
          if (!isDup) {
            _consoleBuffer.push({
              level: payload.level || 'error',
              message: sanitizedMsg.substring(0, 500),
              timestamp: payload.timestamp || new Date().toISOString()
            });
            if (_consoleBuffer.length > CONSOLE_BUFFER_SIZE) _consoleBuffer.shift();
          }
        }
      }
    });

    // Content-script fallback if MAIN world interceptor is not present
    if (window.fetch && !window.__bugpilotNetworkInterceptorInjected) {
      var originalFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
        var url = SanitizationEngine.sanitizeUrl(rawUrl);
        var method = (init && init.method) || (input && input.method) || 'GET';
        var start = Date.now();
        return originalFetch(input, init).then(function (response) {
          addNetworkTransaction({
            id: 'fallback_fetch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            method: method.toUpperCase(),
            url: url,
            status: response.status,
            duration: Date.now() - start,
            timestamp: new Date().toISOString(),
            initiator: 'fetch'
          });
          return response;
        }, function (err) {
          addNetworkTransaction({
            id: 'fallback_fetch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            method: method.toUpperCase(),
            url: url,
            status: 'failed',
            duration: Date.now() - start,
            timestamp: new Date().toISOString(),
            error: err && err.message ? err.message : String(err),
            initiator: 'fetch'
          });
          throw err;
        });
      };
    }
  }

  function setupNavigationTracking() {
    function pushNav() {
      if (typeof window !== 'undefined' && window.location) {
        _navigationHistory.push({ url: SanitizationEngine.sanitizeUrl(window.location.href), timestamp: new Date().toISOString() });
        if (_navigationHistory.length > NAV_HISTORY_SIZE) _navigationHistory.shift();
      }
    }

    pushNav(); // record initial page

    if (typeof history !== 'undefined' && history && history.pushState && history.replaceState) {
      var origPush    = history.pushState.bind(history);
      var origReplace = history.replaceState.bind(history);
      history.pushState = function () {
        var result = origPush.apply(history, arguments);
        pushNav();
        return result;
      };
      history.replaceState = function () {
        var result = origReplace.apply(history, arguments);
        pushNav();
        return result;
      };
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('popstate', pushNav);
    }
  }

  // ── State ───────────────────────────────────────────────────────────────────
  var recording     = false;
  var qaSessionMembers = [];
  var qaLastAssignee   = null; // sticky: '__me__' or an email string
  var qaOwnerEmail     = null;
  var capturedCount = 0;
  var highlightEl   = null;
  var hoveredTarget = null;
  var coordinateCapture = false;
  var hoveredCoordinate = null;
  var officeOverlayEl   = null;
  var officeOverlaySync = null;
  var modalOpen     = false;

  // ── Utility ─────────────────────────────────────────────────────────────────
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  var PAD_RATIO = 0.3;

  function cropToElement(dataUrl, rect, padding, callback) {
    var img = new Image();
    img.onload = function () {
      var dpr = window.devicePixelRatio || 1;

      // Aspect-ratio aware padding (unless padding is explicitly 0 for element_crop)
      var padX = padding === 0 ? 0 : Math.max(24, Math.round(rect.width * PAD_RATIO));
      var padY = padding === 0 ? 0 : Math.max(24, Math.round(rect.height * PAD_RATIO));

      var x = Math.max(0, (rect.left - padX) * dpr);
      var y = Math.max(0, (rect.top  - padY) * dpr);
      var w = Math.min(img.width  - x, (rect.width  + padX * 2) * dpr);
      var h = Math.min(img.height - y, (rect.height + padY * 2) * dpr);

      var canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

      var highlightX = (rect.left * dpr) - x;
      var highlightY = (rect.top  * dpr) - y;
      var highlightW = rect.width  * dpr;
      var highlightH = rect.height * dpr;

      // Rounded dashed highlight border
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth   = 3 * dpr;
      ctx.setLineDash([8 * dpr, 5 * dpr]);
      var radius = Math.min(8 * dpr, highlightW / 4, highlightH / 4);

      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(highlightX, highlightY, highlightW, highlightH, radius);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(highlightX + radius, highlightY);
        ctx.lineTo(highlightX + highlightW - radius, highlightY);
        ctx.quadraticCurveTo(highlightX + highlightW, highlightY, highlightX + highlightW, highlightY + radius);
        ctx.lineTo(highlightX + highlightW, highlightY + highlightH - radius);
        ctx.quadraticCurveTo(highlightX + highlightW, highlightY + highlightH, highlightX + highlightW - radius, highlightY + highlightH);
        ctx.lineTo(highlightX + radius, highlightY + highlightH);
        ctx.quadraticCurveTo(highlightX, highlightY + highlightH, highlightX, highlightY + highlightH - radius);
        ctx.lineTo(highlightX, highlightY + radius);
        ctx.quadraticCurveTo(highlightX, highlightY, highlightX + radius, highlightY);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();

      callback(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function () { callback(dataUrl); };
    img.src = dataUrl;
  }

  // ── Smart Blur (Live DOM Redaction ported from Mimik) ────────────────────────
  var SMART_BLUR_PRESETS = {
    email:      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    ssn:        /\b\d{3}-?\d{2}-?\d{4}\b/g,
    creditCard: /\b(?:\d[ -]*?){13,19}\b/g,
    phone:      /(?:\+\d{1,3}[\s.-]?\d{2,5}[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b0\d{1,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}|\b\d{10,11})\b/g,
    ipAddress:  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  };

  var SMART_BLUR_EXCLUDE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

  function findTextMatches(text, patterns) {
    var ranges = [];
    for (var i = 0; i < patterns.length; i++) {
      var pat = patterns[i];
      if (!pat.global) pat = new RegExp(pat.source, pat.flags + "g");
      pat.lastIndex = 0;
      var match = pat.exec(text);
      while (match !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
        match = pat.exec(text);
      }
    }
    ranges.sort(function (a, b) { return a.start - b.start; });
    var merged = [];
    for (var j = 0; j < ranges.length; j++) {
      var r = ranges[j];
      var last = merged[merged.length - 1];
      if (last && r.start <= last.end) {
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push({ start: r.start, end: r.end });
      }
    }
    return merged;
  }

  function applySmartBlur(root) {
    root = root || document.body;
    if (!root) return function () {};

    var patterns = Object.values(SMART_BLUR_PRESETS).map(function (p) {
      return new RegExp(p.source, p.flags);
    });

    var walker = (typeof document !== 'undefined' && document.createTreeWalker) ? document.createTreeWalker(root, (typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4), {
      acceptNode: function (node) {
        if (!node.parentElement) return (typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_REJECT : 2);
        if (SMART_BLUR_EXCLUDE.has(node.parentElement.tagName)) return (typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_REJECT : 2);
        if (node.parentElement.closest && node.parentElement.closest('[data-qa-blur]')) return (typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_REJECT : 2);
        if (!node.textContent || !node.textContent.trim()) return (typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_REJECT : 2);
        return (typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_ACCEPT : 1);
      }
    }) : null;

    var textNodes = [];
    if (walker) {
      while (walker.nextNode()) textNodes.push(walker.currentNode);
    }

    for (var i = 0; i < textNodes.length; i++) {
      var tNode = textNodes[i];
      var text = tNode.textContent || '';
      var matches = findTextMatches(text, patterns);
      if (matches.length === 0) continue;

      var frag = document.createDocumentFragment();
      var lastEnd = 0;
      for (var m = 0; m < matches.length; m++) {
        var range = matches[m];
        if (range.start > lastEnd) {
          frag.appendChild(document.createTextNode(text.slice(lastEnd, range.start)));
        }
        var span = document.createElement('span');
        span.className = 'qa-smart-blur';
        span.setAttribute('data-qa-blur', 'regex');
        span.style.setProperty('filter', 'blur(10px)', 'important');
        span.style.setProperty('display', 'inline-block', 'important');
        span.textContent = text.slice(range.start, range.end);
        frag.appendChild(span);
        lastEnd = range.end;
      }
      if (lastEnd < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd)));
      }
      if (tNode.parentNode) {
        tNode.parentNode.replaceChild(frag, tNode);
      }
    }

    var searchRoot = (root.querySelectorAll ? root : (typeof document !== 'undefined' ? document : null));
    var inputs = searchRoot ? Array.from(searchRoot.querySelectorAll('input, textarea')) : [];
    for (var k = 0; k < inputs.length; k++) {
      var inp = inputs[k];
      if (inp.getAttribute && inp.getAttribute('data-qa-blur')) continue;
      var val = inp.value;
      if (!val) continue;
      if (findTextMatches(val, patterns).length > 0) {
        if (inp.style && inp.style.setProperty) {
          inp.style.setProperty('filter', 'blur(10px)', 'important');
        }
        if (inp.setAttribute) {
          inp.setAttribute('data-qa-blur', 'input');
        }
      }
    }

    return function unblur() {
      var unblurRoot = (root.querySelectorAll ? root : (typeof document !== 'undefined' ? document : null));
      if (!unblurRoot) return;
      var spans = Array.from(unblurRoot.querySelectorAll('span[data-qa-blur="regex"]'));
      for (var s = 0; s < spans.length; s++) {
        var sp = spans[s];
        var txt = document.createTextNode(sp.textContent || '');
        if (sp.parentNode) {
          var p = sp.parentNode;
          p.replaceChild(txt, sp);
          if (p.normalize) p.normalize();
        }
      }
      var blurredInputs = Array.from(unblurRoot.querySelectorAll('[data-qa-blur="input"]'));
      for (var b = 0; b < blurredInputs.length; b++) {
        if (blurredInputs[b].style && blurredInputs[b].style.removeProperty) {
          blurredInputs[b].style.removeProperty('filter');
        }
        if (blurredInputs[b].removeAttribute) {
          blurredInputs[b].removeAttribute('data-qa-blur');
        }
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.applySmartBlur = applySmartBlur;
    window.SMART_BLUR_PRESETS = SMART_BLUR_PRESETS;
    window.findTextMatches = findTextMatches;
  }

  function drawHighlight(dataUrl, rect, callback) {
    var img = new Image();
    img.onload = function () {
      var dpr = window.devicePixelRatio || 1;
      var canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth   = 3 * dpr;
      ctx.strokeRect(rect.left * dpr, rect.top * dpr, rect.width * dpr, rect.height * dpr);
      callback(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function () { callback(dataUrl); };
    img.src = dataUrl;
  }

  function escapeHTML(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function buildAssigneeOptions(currentValue) {
    var ownerVal   = '__me__';
    var ownerLabel = qaOwnerEmail ? 'Me (' + qaOwnerEmail + ')' : 'Me (default)';
    var html = '<option value="__unassigned__"' + (currentValue === '__unassigned__' ? ' selected' : '') + '>Unassigned</option>';
    html += '<option value="' + ownerVal + '"' + (!currentValue || currentValue === ownerVal ? ' selected' : '') + '>' + ownerLabel + '</option>';
    qaSessionMembers.forEach(function (m) {
      html += '<option value="' + escapeHTML(m.email) + '"' + (currentValue === m.email ? ' selected' : '') + '>' + escapeHTML(m.name) + '</option>';
    });
    return html;
  }

  function safeGetTextContent(element, maxLength) {
    maxLength = maxLength || 100;
    if (!element || !element.textContent) return '';
    var text = element.textContent.trim();
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  // ── Browser / OS detection ──────────────────────────────────────────────────
  function getBrowserName() {
    var ua = navigator.userAgent;
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
    if (/Edg\//.test(ua)) return 'Edge';
    return 'Unknown';
  }

  function getBrowserVersion() {
    var match = navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/(\d+)/);
    return match ? match[2] : '';
  }

  function getOS() {
    var ua = navigator.userAgent;
    if (/Windows/.test(ua)) return 'Windows';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad/.test(ua)) return 'iOS';
    return 'Unknown';
  }

  // ── Full environment ─────────────────────────────────────────────────────────
  function captureEnvironment() {
    return {
      browser: getBrowserName() + ' ' + getBrowserVersion(),
      os: getOS(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      devicePixelRatio: window.devicePixelRatio || 1,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  }

  // ── Performance metrics ──────────────────────────────────────────────────────
  function capturePerformanceMetrics() {
    try {
      var metrics = {};
      var timing = window.performance && window.performance.timing;
      if (timing && timing.navigationStart) {
        var nav = timing.navigationStart;
        if (timing.domContentLoadedEventEnd > nav) metrics.domContentLoadedMs = timing.domContentLoadedEventEnd - nav;
        if (timing.loadEventEnd > nav) metrics.pageLoadMs = timing.loadEventEnd - nav;
        if (timing.responseStart > nav) metrics.ttfbMs = timing.responseStart - nav;
      }
      if (window.performance && window.performance.getEntriesByType) {
        window.performance.getEntriesByType('paint').forEach(function (entry) {
          if (entry.name === 'first-paint') metrics.firstPaintMs = Math.round(entry.startTime);
          if (entry.name === 'first-contentful-paint') metrics.firstContentfulPaintMs = Math.round(entry.startTime);
        });
        var navEntries = window.performance.getEntriesByType('navigation');
        if (navEntries && navEntries[0] && navEntries[0].transferSize) {
          metrics.transferSizeBytes = navEntries[0].transferSize;
        }
        var marks = window.performance.getEntriesByType('mark');
        if (marks && marks.length > 0) {
          metrics.userTimingMarks = marks.slice(0, 20).map(function (m) {
            return { name: m.name, time: Math.round(m.startTime) };
          });
        }
      }
      if (_longTasksBuffer && _longTasksBuffer.length > 0) {
        metrics.longTasks = _longTasksBuffer.slice(0, 10);
      }
      if (window.performance && window.performance.memory) {
        var mem = window.performance.memory;
        metrics.memoryHeap = {
          usedJSHeapSizeMb: Math.round(mem.usedJSHeapSize / (1024 * 1024) * 10) / 10,
          totalJSHeapSizeMb: Math.round(mem.totalJSHeapSize / (1024 * 1024) * 10) / 10,
        };
      }
      return Object.keys(metrics).length > 0 ? metrics : null;
    } catch (e) {
      return null;
    }
  }

  // ── App state (React Router + Redux + Zustand) ─────────────────────────────
  function captureAppState() {
    var result = {};
    try {
      var state = window.history.state;
      if (state && (state.idx !== undefined || state.key !== undefined)) {
        result.reactRouterState = { idx: state.idx, key: state.key, usr: state.usr || null };
      }
    } catch (e) {}
    try {
      // Redux DevTools / Store capture
      var reduxStore = window.store || (window.__REDUX_DEVTOOLS_EXTENSION__ && window.__REDUX_DEVTOOLS_EXTENSION__.store);
      if (reduxStore && typeof reduxStore.getState === 'function') {
        var rawState = reduxStore.getState();
        if (rawState && typeof rawState === 'object') {
          result.reduxStateKeys = Object.keys(rawState).slice(0, 20);
        }
      }
    } catch (e) {}
    try {
      var zustandKeys = [];
      Object.keys(window).forEach(function (k) {
        try {
          var v = window[k];
          if (v && typeof v === 'object' && typeof v.getState === 'function' && typeof v.subscribe === 'function') {
            zustandKeys.push(k);
          }
        } catch (_) {}
      });
      if (zustandKeys.length > 0) result.zustandStoreKeys = zustandKeys;
    } catch (e) {}
    return Object.keys(result).length > 0 ? result : null;
  }

  // ── User info (best-effort window globals) ──────────────────────────────────
  function captureUserInfo() {
    try {
      var candidates = ['__user', 'user', '__USER', 'currentUser', '__currentUser', '__APP_USER__'];
      for (var i = 0; i < candidates.length; i++) {
        var val = window[candidates[i]];
        if (val && typeof val === 'object' && (val.id || val.email || val.name || val.username)) {
          return {
            id:       val.id       || undefined,
            email:    val.email    || undefined,
            name:     val.name     || val.displayName || val.username || undefined,
          };
        }
      }
    } catch (e) {}
    return null;
  }

  // ── Page context ─────────────────────────────────────────────────────────────
  function capturePageContext(settings) {
    var ctx = {};
    if (!settings || settings.captureRoute !== false) {
      ctx.route         = window.location.pathname;
      ctx.hash          = window.location.hash || null;
      ctx.scrollPosition = { x: Math.round(window.scrollX), y: Math.round(window.scrollY) };
      try {
        var params = {};
        var search = window.location.search.replace(/^\?/, '');
        if (search) {
          search.split('&').forEach(function (pair) {
            if (!pair) return;
            var parts = pair.split('=');
            params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '');
          });
          if (Object.keys(params).length > 0) ctx.queryParams = params;
        }
      } catch (e) {}
    }
    if (!settings || settings.capturePageTitle !== false) {
      ctx.title = document.title || null;
    }
    if (settings && settings.captureLocalStorage) {
      try { ctx.localStorageKeys = Object.keys(localStorage).slice(0, 30); } catch (e) {}
    }
    if (settings && settings.captureSessionStorage) {
      try { ctx.sessionStorageKeys = Object.keys(sessionStorage).slice(0, 30); } catch (e) {}
    }
    if (settings && settings.captureCookies) {
      try {
        ctx.cookieNames = document.cookie.split(';').map(function (c) {
          return c.trim().split('=')[0];
        }).filter(Boolean);
      } catch (e) {}
    }
    return ctx;
  }

  // ── CSS Selector generation ─────────────────────────────────────────────────
  function isNumericId(id) {
    return /^:r[0-9a-z]+:?$/.test(id) || /^[0-9]+$/.test(id);
  }

  function isGeneratedClass(className) {
    var patterns = [
      /^[a-z]+_[a-zA-Z0-9]+_[a-zA-Z0-9]+$/,
      /^css-[a-zA-Z0-9]+$/,
      /^sc-[a-zA-Z0-9]+$/,
      /^jsx-[0-9]+$/,
      /^_[a-f0-9]+$/,
      /^[A-Z][a-z]+__[a-z]+___[a-zA-Z0-9]+$/
    ];
    return patterns.some(function (pattern) { return pattern.test(className); });
  }

  function safeCssEscape(str) {
    if (typeof str !== 'string') return str;
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(str);
    }
    return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  function generateCssSelector(element) {
    if (!element || element === document.body) return 'body';
    if (element === document.documentElement) return 'html';

    // 1. Direct explicit test attributes priority
    var dataAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-qa'];
    for (var i = 0; i < dataAttrs.length; i++) {
      var attrVal = element.getAttribute(dataAttrs[i]);
      if (attrVal) return '[' + dataAttrs[i] + '="' + safeCssEscape(attrVal) + '"]';
    }

    // 2. Direct unique ID if non-numeric
    if (element.id && !isNumericId(element.id)) {
      var idSel = '#' + safeCssEscape(element.id);
      try {
        if (document.querySelectorAll(idSel).length === 1) return idSel;
      } catch (_) {}
    }

    // 3. Anton Medvedev's shortest unique CSS selector algorithm via finder
    try {
      var finderFn = (typeof finder === 'function') ? finder : (typeof window !== 'undefined' && typeof window.finder === 'function' ? window.finder : null);
      if (finderFn) {
        var opt = finderFn(element, {
          root: (element.ownerDocument && element.ownerDocument.body) ? element.ownerDocument.body : document.body,
          idName: function (id) { return !isNumericId(id); },
          className: function (cls) { return !isGeneratedClass(cls) && !cls.startsWith('qa-'); },
          tagName: function () { return true; },
          attr: function (name) {
            return ['data-testid', 'data-test-id', 'data-cy', 'data-qa', 'name', 'role', 'aria-label'].indexOf(name) !== -1;
          }
        });
        if (opt && document.querySelectorAll(opt).length === 1) return opt;
      }
    } catch (e) {
      console.warn('[QA] finder fallback:', e);
    }

    // 4. Fallback heuristics
    if (element.classList && element.classList.length > 0) {
      var stableClasses = Array.from(element.classList).filter(function (cls) { return !isGeneratedClass(cls); });
      if (stableClasses.length > 0) {
        var className = stableClasses.map(function (c) { return '.' + safeCssEscape(c); }).join('');
        try { if (document.querySelectorAll(className).length === 1) return className; } catch (e) {}
      }
    }
    var stableAttrs = ['name', 'type', 'placeholder', 'aria-label', 'title', 'role'];
    for (var j = 0; j < stableAttrs.length; j++) {
      var val = element.getAttribute(stableAttrs[j]);
      if (val) return element.tagName.toLowerCase() + '[' + stableAttrs[j] + '="' + safeCssEscape(val) + '"]';
    }
    var path = [];
    var current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      var sel = current.tagName.toLowerCase();
      var parent = current.parentElement;
      if (parent && parent !== document.documentElement) {
        var siblings = Array.from(parent.children).filter(function (child) { return child.tagName === current.tagName; });
        if (siblings.length > 1) sel += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      path.unshift(sel);
      current = parent;
    }
    return path.join(' > ') || (element.tagName ? element.tagName.toLowerCase() : '');
  }

  if (typeof window !== 'undefined') {
    window.__qaGenerateCssSelector = generateCssSelector;
  }

  function generateXPath(element) {
    if (!element) return '';
    if (element === document.documentElement) return '/html';
    if (element === document.body) return '/html/body';
    if (element.id && !isNumericId(element.id)) return '//*[@id="' + element.id + '"]';
    var dataAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-qa'];
    for (var i = 0; i < dataAttrs.length; i++) {
      var val = element.getAttribute(dataAttrs[i]);
      if (val) return '//*[@' + dataAttrs[i] + '="' + val + '"]';
    }
    var parts = [];
    var current = element;
    while (current && current !== document.documentElement) {
      var part = current.tagName.toLowerCase();
      if (current.id && !isNumericId(current.id)) { parts.unshift('//*[@id="' + current.id + '"]'); break; }
      var parent = current.parentElement;
      if (parent && current !== document.body) {
        var siblings = Array.from(parent.children).filter(function (c) { return c.tagName === current.tagName; });
        if (siblings.length > 1) part += '[' + (siblings.indexOf(current) + 1) + ']';
      }
      parts.unshift(part);
      current = parent;
    }
    return '/' + parts.join('/');
  }

  // ── DOM breadcrumb (ancestry) ────────────────────────────────────────────────
  function captureDomBreadcrumb(element) {
    if (!element) return [];
    if (element === document.documentElement) return [{ tag: 'html' }];
    var breadcrumb = [];
    var current = element;
    var depth = 0;
    while (current && current !== document.documentElement && depth < 20) {
      var item = { tag: current.tagName ? current.tagName.toLowerCase() : '' };
      if (current.id && !isNumericId(current.id)) item.id = current.id;
      if (current.getAttribute && current.getAttribute('role')) item.role = current.getAttribute('role');
      if (current.classList && current.classList.length > 0) {
        var stableClasses = Array.from(current.classList).filter(function (c) { return !isGeneratedClass(c); });
        if (stableClasses.length > 0) item.classes = stableClasses.slice(0, 5);
      }
      var parent = current.parentElement;
      if (parent && current !== document.body) {
        var siblings = Array.from(parent.children).filter(function (c) { return c.tagName === current.tagName; });
        if (siblings.length > 1) item.nthOfType = siblings.indexOf(current) + 1;
      }
      breadcrumb.unshift(item);
      current = current.parentElement;
      depth++;
    }
    return breadcrumb;
  }

  // ── Accessibility info ───────────────────────────────────────────────────────
  function captureAccessibility(element) {
    try {
      var focusableTags = ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'];
      return {
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        isFocusable: element.tabIndex >= 0 || focusableTags.includes(element.tagName.toLowerCase())
      };
    } catch (e) {
      return null;
    }
  }

  // ── React component info ────────────────────────────────────────────────────
  function sanitizeReactProps(props, depth, customBlocklist) {
    if (!props || depth > 2) return undefined;
    var result = {};
    var count = 0;
    Object.keys(props).forEach(function (key) {
      if (count >= 15) return;
      if (key === 'children') return;
      if (isBlockedPropKey(key, customBlocklist)) {
        result[key] = '[REDACTED]';
        count++;
        return;
      }
      var val = props[key];
      if (val === null || val === undefined) return;
      if (typeof val === 'function') return;
      if (typeof val === 'string') {
        result[key] = SanitizationEngine.sanitizeString(val);
        count++;
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        result[key] = val;
        count++;
      } else if (typeof val === 'object' && !Array.isArray(val) && depth < 2) {
        var nested = sanitizeReactProps(val, depth + 1, customBlocklist);
        if (nested && Object.keys(nested).length > 0) { result[key] = nested; count++; }
      }
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }

  function getReactComponentInfo(element, customBlocklist) {
    try {
      var fiberKey = Object.keys(element).find(function (k) {
        return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$');
      });
      if (!fiberKey) return null;
      var fiber = element[fiberKey];
      var componentTree = [];
      var closestProps = null;
      var closestName = null;
      var node = fiber;
      var depth = 0;
      var closestSource = null;
      var visitedNodes = typeof Set !== 'undefined' ? new Set() : null;

      while (node && depth < 20) {
        if (visitedNodes) {
          if (visitedNodes.has(node)) break;
          visitedNodes.add(node);
        }
        if (node.type && typeof node.type === 'function') {
          var name = node.type.displayName || node.type.name || 'Anonymous';
          if (name && name !== 'Anonymous') {
            componentTree.push(name);
            if (!closestName) {
              closestName = name;
              closestProps = sanitizeReactProps(node.memoizedProps || {}, 0, customBlocklist);
              var src = node._debugSource;
              if (src && src.fileName) {
                closestSource = { file: src.fileName, line: src.lineNumber || null, col: src.columnNumber || null };
              }
            }
          }
        }
        node = node.return;
        depth++;
      }
      if (componentTree.length === 0) return null;
      var result = { componentName: closestName, componentTree: componentTree.slice(0, 10), props: closestProps || {} };
      if (closestSource) result.source = closestSource;
      return result;
    } catch (e) {
      return null;
    }
  }

  // ── Element dimensions & styles ─────────────────────────────────────────────
  function captureComputedStyles(element) {
    try {
      var computed = window.getComputedStyle(element);
      var styles = {};
      STYLE_KEYS.forEach(function (key) {
        var val = computed[key];
        if (val && val !== 'none' && val !== 'normal' && val !== 'auto') styles[key] = val;
      });
      return styles;
    } catch (e) { return {}; }
  }

  function captureElementDimensions(element) {
    try {
      var rect = element.getBoundingClientRect();
      return {
        width: Math.round(rect.width), height: Math.round(rect.height),
        top: Math.round(rect.top), left: Math.round(rect.left),
        scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY)
      };
    } catch (e) { return {}; }
  }

  // ── Semantic context ─────────────────────────────────────────────────────────
  function getColumnHeader(element) {
    try {
      var cell = element.closest('td, th');
      if (!cell) return null;
      var table = cell.closest('table');
      if (!table) return null;
      var cellIndex = cell.cellIndex;
      if (cellIndex < 0) return null;
      var headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      if (!headerRow) return null;
      var headerCell = headerRow.cells[cellIndex];
      return headerCell ? safeGetTextContent(headerCell, 50) : null;
    } catch (e) { return null; }
  }

  function getNearestLabel(element) {
    try {
      if (element.id) {
        var label = document.querySelector('label[for="' + safeCssEscape(element.id) + '"]');
        if (label) return safeGetTextContent(label, 60);
      }
      var parent = element.closest('label');
      if (parent) return safeGetTextContent(parent, 60);
      var formGroup = element.closest('[class*="form"], [class*="field"], [class*="group"]');
      if (formGroup) {
        var lbl = formGroup.querySelector('label');
        if (lbl && lbl !== element) return safeGetTextContent(lbl, 60);
      }
      return null;
    } catch (e) { return null; }
  }

  function getSemanticContext(element) {
    var context = {
      columnHeader: getColumnHeader(element),
      nearestLabel: getNearestLabel(element),
      ariaLabel: element.getAttribute('aria-label') || null,
      ariaRole: element.getAttribute('role') || null,
      placeholder: element.getAttribute('placeholder') || null,
      title: element.getAttribute('title') || null
    };
    Object.keys(context).forEach(function (k) { if (!context[k]) delete context[k]; });
    return context;
  }

  function isBlankOrRootElement(element) {
    if (!element) return false;
    if (element === document.body || element === document.documentElement) return true;
    var tag = (element.tagName || '').toLowerCase();
    var id = element.id || '';
    var isKnownRoot = id === 'root' || id === 'app' || id === '__next' || tag === 'main' || tag === 'body' || tag === 'html';
    var hasNoChildren = !element.children || element.children.length === 0;
    var hasNoText = !element.textContent || !element.textContent.trim();
    if (isKnownRoot && (hasNoChildren || hasNoText)) return true;
    if (hasNoChildren && hasNoText && (!element.parentElement || element.parentElement === document.body || element.parentElement === document.documentElement)) return true;
    return false;
  }

  // ── Full element data capture ────────────────────────────────────────────────
  function captureElementData(element, customBlocklist) {
    if (!element) return null;
    var isBlankOrRoot = isBlankOrRootElement(element);

    var cssSelector = generateCssSelector(element);
    var xpath       = generateXPath(element);

    var dataAttributes = {};
    if (element.getAttribute) {
      DATA_ATTRIBUTES.forEach(function (attr) {
        var value = element.getAttribute(attr);
        if (value) dataAttributes[attr] = SanitizationEngine.sanitizeString(value);
      });
    }

    var result = {
      tag:            element.tagName ? element.tagName.toLowerCase() : '',
      tagName:        element.tagName || '',
      id:             element.id || null,
      classList:      element.classList ? Array.from(element.classList) : [],
      text:           SanitizationEngine.sanitizeString(safeGetTextContent(element, 100)),
      textContent:    SanitizationEngine.sanitizeString(safeGetTextContent(element, 100)),
      cssSelector:    cssSelector,
      xpath:          xpath,
      selector:       cssSelector,
      dataAttributes: dataAttributes,
      dimensions:     captureElementDimensions(element),
      computedStyles: captureComputedStyles(element),
      semanticContext: getSemanticContext(element),
      accessibility:  captureAccessibility(element),
      domBreadcrumb:  captureDomBreadcrumb(element),
    };

    if (isBlankOrRoot) {
      result.note = 'Full viewport / empty root capture (potential WSOD or unmounted state)';
    }

    var reactInfo = getReactComponentInfo(element, customBlocklist);
    if (reactInfo) result.react = reactInfo;

    return result;
  }

  window.__qaCaptureElementData = captureElementData;

  // ── Message listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!isCurrentInstance()) return false;

    if (message.type === MESSAGE_TYPES.START_REPORTING) {
      qaSessionMembers = message.members || [];
      chrome.storage.local.get(['qa_user_email'], function (r) { qaOwnerEmail = r.qa_user_email || null; });
      startReporting(); sendResponse({ ok: true, recording: true }); return true;
    }
    if (message.type === MESSAGE_TYPES.STOP_REPORTING)  { stopReporting();  sendResponse({ ok: true }); return true; }
    if (message.type === 'IS_RECORDING')                { sendResponse({ recording: recording }); return true; }

    if (message.type === 'BUG_MAGNET_INSERT') {
      var el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        var start = typeof el.selectionStart === 'number' ? el.selectionStart : (el.value || '').length;
        var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : (el.value || '').length;
        var val = el.value || '';
        var insertVal = message.value != null ? String(message.value) : '';
        el.value = val.substring(0, start) + insertVal + val.substring(end);
        el.selectionStart = el.selectionEnd = start + insertVal.length;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el && el.isContentEditable) {
        var insertVal = message.value != null ? String(message.value) : '';
        if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
          document.execCommand('insertText', false, insertVal);
        } else {
          var sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            range.deleteContents();
            var textNode = document.createTextNode(insertVal);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
          }
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sendResponse({ ok: true });
      return true;
    }
  });

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'QA_REPORTER_PING') {
      if (document.querySelector('meta[name="qa-reporter-platform"]')) return;
      window.postMessage({ type: 'QA_REPORTER_PONG', version: '2.1.0' }, '*');
    }
  });

  chrome.storage.local.get(['qa_recording'], function (result) {
    if (result.qa_recording && isCurrentInstance()) startReporting();
  });

  // Sync capture mode across all open tabs when sidepanel toggles recording
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !isCurrentInstance()) return;
    if (changes.qa_recording) {
      if (changes.qa_recording.newValue) startReporting();
      else stopReporting();
    }
  });

  // ── Start / stop capture (hover UI) ─────────────────────────────────────────
  // Always re-attaches hover listeners — safe to call when already active (e.g.
  // after extension reload left recording=true but listeners were torn down).
  function startReporting() {
    recording = true;
    modalOpen = false;
    enableHover();
    if (isOfficeAppPage()) enableOfficeOverlay();
    document.removeEventListener('click', onElementClick, true);
    document.addEventListener('click', onElementClick, true);
  }

  function stopReporting() {
    if (!recording) return;
    recording = false;
    coordinateCapture = false;
    hoveredCoordinate = null;
    disableOfficeOverlay();
    disableHover();
    document.removeEventListener('click', onElementClick, true);
    closeModal();
  }

  // Legacy names used elsewhere in this file
  function startRecording() { startReporting(); }
  function stopRecording()  { stopReporting(); }

  // ── Hover highlight ──────────────────────────────────────────────────────────
  /** Excel/Office draw the grid on <canvas> or cross-origin <iframe> — DOM hover breaks. */
  function isOfficeAppPage() {
    return /sharepoint|office\.com|office365|excel|onedrive|officeapps\.live/i.test(location.href);
  }

  function needsCoordinateCapture(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    if (tag === 'CANVAS' || tag === 'IFRAME') return true;
    if (el.closest && el.closest('canvas')) return true;
    if (el.id === 'qa-office-capture-overlay' || el.classList.contains('qa-office-capture-overlay')) return true;
    return false;
  }

  /** Excel grid lives in a cross-origin iframe — parent page never receives mouse events over cells. */
  function findOfficeGridFrame() {
    var best = null, bestArea = 0;
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      var f = iframes[i];
      var src = (f.getAttribute('src') || f.src || '').toLowerCase();
      var id  = (f.id || '').toLowerCase();
      var name = (f.name || '').toLowerCase();
      var matched = /officeapps|excel|wopi|collab|outerframe|embed/.test(src) ||
        id === 'wacframe' || name === 'wacframe';
      var r = f.getBoundingClientRect();
      var area = r.width * r.height;
      if (matched && area > bestArea) { best = f; bestArea = area; }
      else if (isOfficeAppPage() && area > bestArea && area > 80000) { best = f; bestArea = area; }
    }
    return best;
  }

  function updateOfficeOverlayGeometry() {
    if (!officeOverlayEl) return;
    var frame = findOfficeGridFrame();
    if (frame) {
      var r = frame.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      officeOverlayEl.style.display = 'block';
      officeOverlayEl.style.top    = r.top + 'px';
      officeOverlayEl.style.left   = r.left + 'px';
      officeOverlayEl.style.width  = r.width + 'px';
      officeOverlayEl.style.height = r.height + 'px';
      return;
    }
    if (isOfficeAppPage()) {
      officeOverlayEl.style.display = 'block';
      officeOverlayEl.style.top    = '148px';
      officeOverlayEl.style.left   = '0';
      officeOverlayEl.style.width  = '100%';
      officeOverlayEl.style.height = 'calc(100vh - 148px)';
    }
  }

  function enableOfficeOverlay() {
    if (window !== window.top) return;
    if (!officeOverlayEl) {
      officeOverlayEl = document.createElement('div');
      officeOverlayEl.id = 'qa-office-capture-overlay';
      officeOverlayEl.className = 'qa-office-capture-overlay';
      officeOverlayEl.addEventListener('mousemove', onOfficeOverlayMove, true);
      officeOverlayEl.addEventListener('click', onOfficeOverlayClick, true);
      document.documentElement.appendChild(officeOverlayEl);
      officeOverlaySync = function () { updateOfficeOverlayGeometry(); };
      window.addEventListener('resize', officeOverlaySync, { passive: true });
      window.addEventListener('scroll', officeOverlaySync, { passive: true, capture: true });
    }
    updateOfficeOverlayGeometry();
    if (!officeOverlayEl._qaGeoInterval) {
      officeOverlayEl._qaGeoInterval = setInterval(updateOfficeOverlayGeometry, 800);
    }
  }

  function disableOfficeOverlay() {
    if (officeOverlayEl) {
      if (officeOverlayEl._qaGeoInterval) {
        clearInterval(officeOverlayEl._qaGeoInterval);
        officeOverlayEl._qaGeoInterval = null;
      }
      officeOverlayEl.removeEventListener('mousemove', onOfficeOverlayMove, true);
      officeOverlayEl.removeEventListener('click', onOfficeOverlayClick, true);
      officeOverlayEl.remove();
      officeOverlayEl = null;
    }
    if (officeOverlaySync) {
      window.removeEventListener('resize', officeOverlaySync, { passive: true });
      window.removeEventListener('scroll', officeOverlaySync, { capture: true });
      officeOverlaySync = null;
    }
  }

  function onOfficeOverlayMove(e) {
    if (!recording || modalOpen) return;
    coordinateCapture = true;
    hoveredCoordinate = { x: e.clientX, y: e.clientY };
    positionHighlightAtPoint(e.clientX, e.clientY, 140, 36);
  }

  function onOfficeOverlayClick(e) {
    if (modalOpen || !recording) return;
    e.preventDefault();
    e.stopPropagation();
    openCaptureAtCoordinate(e.clientX, e.clientY, e.target);
  }

  function openCaptureAtCoordinate(cx, cy, clickedEl) {
    removeHighlight();
    hoveredTarget = null;
    coordinateCapture = false;
    var pad = 70, padY = 18;
    var elemRect = {
      left:   Math.max(0, cx - pad),
      top:    Math.max(0, cy - padY),
      width:  Math.min(140, window.innerWidth),
      height: 36,
      right:  cx + pad,
      bottom: cy + padY,
    };
    var elemData = buildCoordinateElementData(cx, cy);
    setTimeout(function () {
      var unblur = applySmartBlur(document.body);
      var unblurTimer = setTimeout(function () {
        try {
          if (typeof unblur === 'function') {
            unblur();
            unblur = null;
          }
        } catch (_) {}
      }, 2500);
      requestAnimationFrame(function () {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CAPTURE_SCREENSHOT }, function (res) {
          clearTimeout(unblurTimer);
          try {
            if (typeof unblur === 'function') {
              unblur();
              unblur = null;
            }
          } catch (unblurErr) {
            console.warn('[QA] Error unblurring DOM:', unblurErr);
          }
          var fullDataUrl = (res && res.ok) ? res.dataUrl : null;
          var screenRecordingActive = !!(res && res.screenRecordingActive);
          var isMultiTab = !!(res && res.isMultiTab);
          var recordingStartedAt = (res && res.recordingStartedAt) || null;
          chrome.storage.local.get(['qa_ext_settings', 'qa_video_recording_pending'], function (stored) {
            var settings = stored.qa_ext_settings || {};
            var mode     = settings.screenshotMode || 'element_context';
            var videoRecordingPending = !!stored.qa_video_recording_pending;
            function openModal(screenshotDataUrl) {
              showModal({ element: clickedEl || document.body, elemData: elemData, screenshotDataUrl: screenshotDataUrl, fullScreenshotDataUrl: fullDataUrl, settings: settings, screenRecordingActive: screenRecordingActive, isMultiTab: isMultiTab, recordingStartedAt: recordingStartedAt, videoRecordingPending: videoRecordingPending });
            }
            if (!fullDataUrl || elemRect.width === 0) return openModal(fullDataUrl);
            if (mode === 'full')             { openModal(fullDataUrl); }
            else if (mode === 'element_crop'){ cropToElement(fullDataUrl, elemRect, 0,  openModal); }
            else if (mode === 'full_highlighted') { drawHighlight(fullDataUrl, elemRect, openModal); }
            else { cropToElement(fullDataUrl, elemRect, 80, openModal); }
          });
        });
      });
    }, 50);
  }

  function positionHighlightAtPoint(cx, cy, w, h) {
    if (!highlightEl) {
      highlightEl = document.createElement('div');
      highlightEl.id = OVERLAY_ID;
      highlightEl.className = 'qa-reporter-highlight-overlay';
      document.documentElement.appendChild(highlightEl);
    }
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var left = Math.max(4, Math.min(cx - w / 2, vw - w - 4));
    var top  = Math.max(4, Math.min(cy - h / 2, vh - h - 4));
    highlightEl.style.cssText =
      'position: fixed !important;' +
      'top: ' + top + 'px !important;' +
      'left: ' + left + 'px !important;' +
      'width: ' + w + 'px !important;' +
      'height: ' + h + 'px !important;' +
      'display: block !important;';
  }

  function buildCoordinateElementData(cx, cy) {
    var selector = 'coordinate@(' + Math.round(cx) + ',' + Math.round(cy) + ')';
    return {
      tag:          'region',
      tagName:      'region',
      id:           null,
      classList:    [],
      selector:     selector,
      cssSelector:  selector,
      xpath:        null,
      text:         '',
      textContent:  '',
      attributes:   { 'data-qa-coordinate': Math.round(cx) + ',' + Math.round(cy) },
      dataAttributes: {},
      boundingRect: { x: cx, y: cy, width: 140, height: 36, top: cy - 18, left: cx - 70, right: cx + 70, bottom: cy + 18 },
      dimensions:   { x: cx, y: cy, width: 140, height: 36, top: cy - 18, left: cx - 70, right: cx + 70, bottom: cy + 18 },
      computedStyles: {},
      semanticContext: { page: 'canvas-or-iframe', note: 'Captured by pointer position — Excel/Office canvas region' },
      accessibility: {},
      domBreadcrumb: [{ tag: 'region', selector: 'pointer-capture' }],
    };
  }

  function enableHover() {
    disableHover();
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout',  onMouseOut,  true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('scroll',    onScroll,    { passive: true, capture: true });
  }

  function disableHover() {
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout',  onMouseOut,  true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('scroll',    onScroll,    { capture: true });
    removeHighlight();
  }

  function onMouseMove(e) {
    if (!recording || modalOpen) return;
    if (isQAElement(e.target)) return;
    if (officeOverlayEl) return; // grid overlay handles Excel iframe area
    if (coordinateCapture || needsCoordinateCapture(e.target)) {
      coordinateCapture = true;
      hoveredCoordinate = { x: e.clientX, y: e.clientY };
      positionHighlightAtPoint(e.clientX, e.clientY, 140, 36);
    }
  }

  function onMouseOver(e) {
    if (modalOpen) return;
    var target = e.target;
    if (isQAElement(target)) return;

    if (needsCoordinateCapture(target)) {
      coordinateCapture = true;
      hoveredTarget = null;
      hoveredCoordinate = { x: e.clientX, y: e.clientY };
      positionHighlightAtPoint(e.clientX, e.clientY, 140, 36);
      return;
    }

    coordinateCapture = false;
    hoveredCoordinate = null;
    hoveredTarget = target;
    positionHighlight(target);
  }

  function onMouseOut(e) {
    if (modalOpen) return;
    if (coordinateCapture) {
      if (needsCoordinateCapture(e.target)) {
        coordinateCapture = false;
        hoveredCoordinate = null;
        removeHighlight();
      }
      return;
    }
    if (e.target === hoveredTarget) { hoveredTarget = null; removeHighlight(); }
  }

  function onScroll() {
    if (coordinateCapture && hoveredCoordinate) {
      positionHighlightAtPoint(hoveredCoordinate.x, hoveredCoordinate.y, 140, 36);
    } else if (hoveredTarget) {
      positionHighlight(hoveredTarget);
    }
  }

  function positionHighlight(target) {
    if (!highlightEl) {
      highlightEl = document.createElement('div');
      highlightEl.id = OVERLAY_ID;
      highlightEl.className = 'qa-reporter-highlight-overlay';
      document.documentElement.appendChild(highlightEl);
    }
    var rect = target.getBoundingClientRect();
    highlightEl.style.cssText =
      'top: ' + (rect.top + window.scrollY) + 'px !important;' +
      'left: ' + (rect.left + window.scrollX) + 'px !important;' +
      'width: ' + rect.width + 'px !important;' +
      'height: ' + rect.height + 'px !important;' +
      'display: block !important;';
  }

  function removeHighlight() {
    if (highlightEl) highlightEl.style.setProperty('display', 'none', 'important');
  }

  function isQAElement(el) {
    if (!el || !el.closest) return false;
    return !!(el.closest('#' + MODAL_ID) || el.closest('#' + DIM_ID) ||
      el.closest('#qa-office-capture-overlay') || el.id === OVERLAY_ID);
  }

  // ── Click handler ────────────────────────────────────────────────────────────
  function onElementClick(e) {
    if (modalOpen) return;
    if (isQAElement(e.target)) return;
    if (officeOverlayEl && (e.target === officeOverlayEl || officeOverlayEl.contains(e.target))) return;

    e.preventDefault();
    e.stopPropagation();

    var clickedEl = e.target;
    if (needsCoordinateCapture(clickedEl)) {
      openCaptureAtCoordinate(e.clientX, e.clientY, clickedEl);
      return;
    }

    removeHighlight();
    hoveredTarget = null;
    coordinateCapture = false;

    var elemRect = clickedEl.getBoundingClientRect();
    var elemData = null;

    setTimeout(function () {
      var unblur = applySmartBlur(document.body);
      var unblurTimer = setTimeout(function () {
        try {
          if (typeof unblur === 'function') {
            unblur();
            unblur = null;
          }
        } catch (_) {}
      }, 2500);
      requestAnimationFrame(function () {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CAPTURE_SCREENSHOT }, function (res) {
          clearTimeout(unblurTimer);
          try {
            if (typeof unblur === 'function') {
              unblur();
              unblur = null;
            }
          } catch (unblurErr) {
            console.warn('[QA] Error unblurring DOM:', unblurErr);
          }
          var fullDataUrl = (res && res.ok) ? res.dataUrl : null;
          var screenRecordingActive = !!(res && res.screenRecordingActive);
          var isMultiTab = !!(res && res.isMultiTab);
          var recordingStartedAt = (res && res.recordingStartedAt) || null;
          chrome.storage.local.get(['qa_ext_settings', 'qa_video_recording_pending'], function (stored) {
            var settings = stored.qa_ext_settings || {};
            var mode     = settings.screenshotMode || 'element_context';
            var videoRecordingPending = !!stored.qa_video_recording_pending;
            elemData = captureElementData(clickedEl, settings.propBlocklist);

            function openModal(screenshotDataUrl) {
              showModal({ element: clickedEl, elemData: elemData, screenshotDataUrl: screenshotDataUrl, fullScreenshotDataUrl: fullDataUrl, settings: settings, screenRecordingActive: screenRecordingActive, isMultiTab: isMultiTab, recordingStartedAt: recordingStartedAt, videoRecordingPending: videoRecordingPending });
            }

            if (!fullDataUrl || elemRect.width === 0) return openModal(fullDataUrl);

            if (mode === 'full')             { openModal(fullDataUrl); }
            else if (mode === 'element_crop'){ cropToElement(fullDataUrl, elemRect, 0,  openModal); }
            else if (mode === 'full_highlighted') { drawHighlight(fullDataUrl, elemRect, openModal); }
            else { cropToElement(fullDataUrl, elemRect, 80, openModal); } // element_context + both + default
          });
        });
      });
    }, 80);
  }

  // ── B2: Mimik 50-Token Semantic DOM Context Extractor ────────────────────────
  var SEMANTIC_CONTAINERS = ['form', 'nav', 'dialog', 'section', 'main', 'aside', 'header', 'footer', 'article'];
  var INTERACTIVE_SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [tabindex]:not([tabindex="-1"])';

  function textOf(el) {
    return el && el.textContent ? el.textContent.trim() : null;
  }

  function resolveAriaLabelledBy(el) {
    var ids = el.getAttribute('aria-labelledby');
    if (!ids) return null;
    return ids.split(/\s+/).map(function (id) {
      return textOf(document.getElementById(id));
    }).filter(Boolean).join(' ') || null;
  }

  function getLabelForInput(el) {
    var id = el.id;
    if (id) {
      try {
        var label = textOf(document.querySelector('label[for="' + CSS.escape(id) + '"]'));
        if (label) return label;
      } catch (_) {}
    }
    var parentLabel = el.closest('label');
    if (!parentLabel) return null;
    var clone = parentLabel.cloneNode(true);
    var inputs = clone.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) inputs[i].remove();
    return textOf(clone);
  }

  function getAccessibleName(el) {
    if (!el || !(el instanceof Element)) return null;
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    var labelledBy = resolveAriaLabelledBy(el);
    if (labelledBy) return labelledBy.trim();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      var inpLabel = getLabelForInput(el);
      if (inpLabel) return inpLabel.trim();
    }
    var title = el.getAttribute('title');
    if (title) return title.trim();
    var placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
    var text = textOf(el);
    if (text && text.length <= 60) return text;
    return null;
  }

  function isSensitiveElement(el) {
    if (!el) return false;
    if (el instanceof HTMLInputElement && (el.type === 'password' || el.type === 'hidden')) return true;
    var name = (el.getAttribute('name') || el.id || '').toLowerCase();
    var label = (getAccessibleName(el) || '').toLowerCase();
    return isBlockedPropKey(name) || isBlockedPropKey(label);
  }

  function getElementValue(el) {
    if (!el) return null;
    if (isSensitiveElement(el)) return '***';
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      return el.checked ? 'checked' : 'unchecked';
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value ? 'value=' + el.value.slice(0, 40) : null;
    }
    if (el instanceof HTMLSelectElement && el.selectedOptions.length) {
      return 'selected=' + el.selectedOptions[0].text.slice(0, 40);
    }
    return null;
  }

  function findContainer(el) {
    var cur = el ? el.parentElement : null;
    var depth = 0;
    while (cur && cur !== document.body && depth < 4) {
      var tag = cur.tagName.toLowerCase();
      var role = cur.getAttribute('role');
      if (SEMANTIC_CONTAINERS.indexOf(tag) !== -1 || role) {
        var label = cur.getAttribute('aria-label') || textOf(cur.querySelector(':scope > legend, :scope > caption')) || resolveAriaLabelledBy(cur);
        return { tag: tag, role: role, label: label ? label.slice(0, 60) : null, element: cur };
      }
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  function findNearestHeading(el) {
    var cur = el ? el.parentElement : null;
    var depth = 0;
    while (cur && cur !== document.body && depth < 4) {
      var h = cur.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (h) {
        var t = textOf(h);
        if (t) return t.slice(0, 80);
      }
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  function collectInteractiveSiblings(el, containerEl) {
    var parent = containerEl || (el ? el.parentElement : null);
    if (!parent) return [];
    var sibs = [];
    try {
      var list = parent.querySelectorAll(INTERACTIVE_SELECTOR);
      for (var i = 0; i < list.length && sibs.length < 8; i++) {
        var s = list[i];
        if (s === el || s.closest('#qa-reporter-modal') || s.closest('#qa-reporter-highlight')) continue;
        sibs.push({
          tag: s.tagName.toLowerCase(),
          role: s.getAttribute('role') || null,
          name: getAccessibleName(s),
          value: getElementValue(s),
        });
      }
    } catch (_) {}
    return sibs;
  }

  function extractDOMContext(el, action) {
    if (!el || !(el instanceof Element)) {
      return {
        page: { title: document.title, path: window.location.pathname },
        container: null,
        heading: null,
        siblings: [],
        target: { tag: 'unknown', role: null, name: null, value: null, action: action || 'click' },
        rawSummary: 'Page: "' + document.title + '" ' + window.location.pathname,
      };
    }
    var container = findContainer(el);
    var heading = findNearestHeading(el);
    var siblings = collectInteractiveSiblings(el, container ? container.element : null);
    var target = {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      name: getAccessibleName(el),
      value: getElementValue(el),
      action: action || 'click',
    };
    var ctx = {
      page: { title: document.title, path: window.location.pathname },
      container: container ? { tag: container.tag, role: container.role, label: container.label } : null,
      heading: heading,
      siblings: siblings,
      target: target,
    };
    ctx.rawSummary = serializeDOMContext(ctx);
    return ctx;
  }

  function serializeDOMContext(ctx) {
    var parts = [];
    parts.push('Page: "' + (ctx.page.title || '') + '" ' + ctx.page.path);
    if (ctx.container) {
      var cStr = '<' + ctx.container.tag + '>';
      if (ctx.container.role) cStr += ' [role=' + ctx.container.role + ']';
      if (ctx.container.label) cStr += ' "' + ctx.container.label + '"';
      parts.push('Container: ' + cStr);
    }
    if (ctx.heading) parts.push('Heading: "' + ctx.heading + '"');
    if (ctx.siblings && ctx.siblings.length > 0) {
      var sibsStr = ctx.siblings.slice(0, 4).map(function (s) {
        return s.tag + (s.name ? ' "' + s.name + '"' : '');
      }).join(', ');
      parts.push('Siblings: ' + sibsStr);
    }
    var t = ctx.target;
    parts.push('→ Target: <' + t.tag + '>' + (t.name ? ' "' + t.name + '"' : '') + (t.value ? ' [' + t.value + ']' : '') + ' (' + t.action + ')');
    return parts.join(' | ');
  }

  // ── B7: Keystroke Consolidation & Step Recorder (InputSession) ────────────────
  var recordedSteps = [];
  var stepRecordingActive = false;

  var InputSession = {
    active: false,
    target: null,
    stepId: null,
    label: null,
    selector: null,
    startedAt: null,

    start: function (target) {
      if (!target || !(target instanceof HTMLElement)) return;
      this.active = true;
      this.target = target;
      this.stepId = 'step-in-' + Date.now();
      this.label = getAccessibleName(target) || target.name || target.placeholder || 'input field';
      this.selector = getResilientSelector(target);
      this.startedAt = Date.now();
    },

    update: function (target) {
      if (!this.active || this.target !== target) return;
      var isSecret = isSensitiveElement(target);
      var val = target.value || '';
      var desc = isSecret ? 'Type [SECRET] into ' + this.label : (val ? 'Type "' + val + '" into ' + this.label : 'Clear ' + this.label);
      updateOrPushStep({
        id: this.stepId,
        type: 'input',
        action: 'input',
        label: desc,
        targetName: this.label,
        value: isSecret ? '***' : val,
        selector: this.selector,
        timestamp: this.startedAt,
      });
    },

    finalize: function () {
      if (!this.active) return;
      if (this.target) {
        this.update(this.target);
      }
      this.active = false;
      this.target = null;
      this.stepId = null;
      this.label = null;
      this.selector = null;
      this.startedAt = null;
    }
  };

  function updateOrPushStep(step) {
    var idx = -1;
    for (var i = 0; i < recordedSteps.length; i++) {
      if (recordedSteps[i].id === step.id) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      recordedSteps[idx] = step;
    } else {
      step.stepNumber = recordedSteps.length + 1;
      recordedSteps.push(step);
    }
    chrome.storage.local.set({ qa_recorded_steps: recordedSteps });
  }

  function recordClickStep(target) {
    if (!target || !(target instanceof HTMLElement)) return;
    if (target.closest('#qa-reporter-modal') || target.closest('#qa-reporter-highlight')) return;
    var name = getAccessibleName(target) || (target.innerText ? target.innerText.slice(0, 30) : '') || target.tagName.toLowerCase();
    var selector = getResilientSelector(target);
    var step = {
      id: 'step-click-' + Date.now(),
      type: 'click',
      action: 'click',
      label: 'Click "' + name + '" (' + target.tagName.toLowerCase() + ')',
      targetName: name,
      selector: selector,
      timestamp: Date.now(),
    };
    updateOrPushStep(step);
  }

  function setupStepRecordingListeners() {
    window.addEventListener('click', function (e) {
      if (!stepRecordingActive || modalOpen) return;
      if (e.target instanceof HTMLElement) {
        var interactive = e.target.closest(INTERACTIVE_SELECTOR) || e.target;
        if (interactive && interactive instanceof HTMLElement) {
          if (interactive instanceof HTMLInputElement || interactive instanceof HTMLTextAreaElement) {
            if (!InputSession.active || InputSession.target !== interactive) {
              InputSession.finalize();
              InputSession.start(interactive);
            }
          } else {
            InputSession.finalize();
            recordClickStep(interactive);
          }
        }
      }
    }, true);

    window.addEventListener('input', function (e) {
      if (!stepRecordingActive || modalOpen) return;
      if (e.target instanceof HTMLElement) {
        if (!InputSession.active || InputSession.target !== e.target) {
          InputSession.start(e.target);
        }
        InputSession.update(e.target);
      }
    }, { capture: true, passive: true });

    window.addEventListener('keydown', function (e) {
      if (!stepRecordingActive || modalOpen) return;
      if (InputSession.active && (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab')) {
        InputSession.finalize();
      }
    }, true);

    window.addEventListener('focusout', function (e) {
      if (InputSession.active) {
        InputSession.finalize();
      }
    }, { capture: true, passive: true });
  }

  try {
    chrome.storage.local.get(['qa_step_recording', 'qa_recorded_steps'], function (res) {
      stepRecordingActive = !!(res && res.qa_step_recording);
      recordedSteps = (res && res.qa_recorded_steps) || [];
    });
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes.qa_step_recording) {
        stepRecordingActive = !!changes.qa_step_recording.newValue;
      }
      if (changes.qa_recorded_steps) {
        recordedSteps = changes.qa_recorded_steps.newValue || [];
      }
    });
    setupStepRecordingListeners();
  } catch (_) {}

  // ── Modal ────────────────────────────────────────────────────────────────────
  function showModal(opts) {
    var element               = opts.element;
    var elemData              = opts.elemData;
    var screenshotDataUrl     = opts.screenshotDataUrl;
    var fullScreenshotDataUrl = opts.fullScreenshotDataUrl;
    var settings              = opts.settings || {};
    var screenRecordingActive = opts.screenRecordingActive || false;
    var isMultiTab            = opts.isMultiTab || false;
    var recordingStartedAt    = opts.recordingStartedAt || null;
    var videoRecordingPending = opts.videoRecordingPending || false;

    modalOpen = true;
    disableHover();

    var dim = document.createElement('div');
    dim.id = DIM_ID;
    dim.className = 'qa-reporter-modal-overlay';
    document.documentElement.appendChild(dim);

    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'qa-reporter-modal';

    var rect   = element.getBoundingClientRect();
    var vw     = window.innerWidth;
    var vh     = window.innerHeight;
    var modalW = 400;
    var modalH = 600;
    var top, left;
    if (rect.bottom + modalH + 16 < vh) top = rect.bottom + 8;
    else if (rect.top - modalH - 16 > 0) top = rect.top - modalH - 8;
    else top = Math.max(16, (vh - modalH) / 2);
    left = Math.max(8, Math.min(rect.left, vw - modalW - 8));
    top  = Math.max(8, top);

    modal.style.cssText = 'top: ' + top + 'px !important; left: ' + left + 'px !important;';

    var consoleSnap = _consoleBuffer.slice(-10).reverse();
    var networkSnap = _networkBuffer.slice(-10).reverse();

    // ── Slider state ─────────────────────────────────────────────────────────
    var sliderImages = [];
    if (screenshotDataUrl)     sliderImages.push({ dataUrl: screenshotDataUrl,     label: 'Element' });
    if (fullScreenshotDataUrl) sliderImages.push({ dataUrl: fullScreenshotDataUrl, label: 'Full page' });
    var sliderIndex = 0;

    function buildSliderHtml() {
      if (sliderImages.length === 0) return '<div style="height:4px"></div>';
      var img = sliderImages[sliderIndex];
      var navHtml = sliderImages.length > 1
        ? '<button class="qa-slider-nav qa-slider-nav-prev" id="qa-slider-prev">‹</button>' +
          '<button class="qa-slider-nav qa-slider-nav-next" id="qa-slider-next">›</button>' +
          '<span class="qa-slider-counter" id="qa-slider-counter">' + (sliderIndex + 1) + ' / ' + sliderImages.length + '</span>'
        : '';
      return '<div class="qa-modal-slider" id="qa-modal-slider">' +
        '<img class="qa-modal-slider-img" id="qa-slider-img" src="' + img.dataUrl + '" alt="Screenshot">' +
        navHtml +
        '<button class="qa-slider-edit-btn" id="qa-slider-edit">✏ Edit</button>' +
      '</div>';
    }
    var screenshotHtml = buildSliderHtml();

    // ── Replay attachment section ─────────────────────────────────────────────
    var replayElapsedSec = recordingStartedAt ? Math.round((Date.now() - recordingStartedAt) / 1000) : 0;
    var replayElapsedStr = replayElapsedSec > 0
      ? Math.floor(replayElapsedSec / 60) + ':' + String(replayElapsedSec % 60).padStart(2, '0')
      : '';
    var replayHtml = screenRecordingActive
      ? '<div class="qa-replay-section" id="qa-replay-section">' +
          '<div class="qa-replay-header">' +
            '<span class="qa-replay-dot"></span>' +
            '<span>Screen recording active' + (replayElapsedStr ? ' &middot; ' + replayElapsedStr : '') + '</span>' +
          '</div>' +
          '<div class="qa-replay-actions">' +
            '<button class="qa-btn qa-btn-replay-keep" id="qa-btn-attach-keep">Attach clip &amp; continue</button>' +
            '<button class="qa-btn qa-btn-replay-stop" id="qa-btn-stop-attach">Stop &amp; attach</button>' +
          '</div>' +
        '</div>'
      : '';

    // ── Video attach prompt (recorded video pending in the sidepanel) ─────────
    var videoAttachHtml = videoRecordingPending
      ? '<div class="qa-video-attach-prompt">' +
          '<label class="qa-video-attach-label">' +
            '<input type="checkbox" id="qa-attach-video-checkbox" checked />' +
            ' Attach recorded video to this bug' +
          '</label>' +
        '</div>'
      : '';

    // ── ANNOTATION_DONE handler (closure over slider state) ───────────────────
    function onAnnotationDone(message, _sender, sendResponse) {
      if (message.type !== 'ANNOTATION_DONE') return;
      if (message.keepOriginal) {
        sliderImages.splice(message.imageIndex + 1, 0, {
          dataUrl: message.dataUrl,
          label:   'Annotated',
        });
        sliderIndex = message.imageIndex + 1;
      } else {
        sliderImages[message.imageIndex] = {
          dataUrl: message.dataUrl,
          label:   (sliderImages[message.imageIndex].label || '') + ' (annotated)',
        };
      }
      refreshSlider();
      modal.style.pointerEvents = '';
      sendResponse({ ok: true });
      return true;
    }
    chrome.runtime.onMessage.addListener(onAnnotationDone);

    var reactHtml = '';
    if (elemData.react && settings.captureReact !== false) {
      reactHtml =
        '<div class="qa-detail-item"><span class="qa-detail-label">Component</span><code>' + escapeHTML(elemData.react.componentName || '') + '</code></div>' +
        '<div class="qa-detail-item"><span class="qa-detail-label">Tree</span><code>' + escapeHTML(elemData.react.componentTree.join(' > ')) + '</code></div>';
    }

    var semanticHtml = '';
    if (elemData.semanticContext) {
      var ctx = elemData.semanticContext;
      if (ctx.columnHeader) semanticHtml += '<div class="qa-detail-item"><span class="qa-detail-label">Column</span><code>' + escapeHTML(ctx.columnHeader) + '</code></div>';
      if (ctx.nearestLabel) semanticHtml += '<div class="qa-detail-item"><span class="qa-detail-label">Label</span><code>' + escapeHTML(ctx.nearestLabel) + '</code></div>';
      if (ctx.ariaLabel)    semanticHtml += '<div class="qa-detail-item"><span class="qa-detail-label">aria-label</span><code>' + escapeHTML(ctx.ariaLabel) + '</code></div>';
    }

    var consoleHtml = consoleSnap.length === 0
      ? '<span class="qa-collapsible-empty">No console errors captured</span>'
      : consoleSnap.map(function (e) { return '<div class="qa-error-entry">[' + escapeHTML(e.level) + '] ' + escapeHTML(e.message || '') + '</div>'; }).join('');

    var networkHtml = networkSnap.length === 0
      ? '<span class="qa-collapsible-empty">No network errors captured</span>'
      : networkSnap.map(function (e) { return '<div class="qa-network-entry">[' + escapeHTML(String(e.status)) + '] ' + escapeHTML(e.method || '') + ' ' + escapeHTML(e.url || '') + '</div>'; }).join('');

  // ── Speech Recognizer Helper ─────────────────────────────────────────────
  var activeRecognizer = null;
  var activeVoiceBtn = null;

  function isSpeechRecognitionSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function stopVoiceInput() {
    if (activeRecognizer) {
      try {
        activeRecognizer.stop();
      } catch (e) {}
      activeRecognizer = null;
    }
    if (activeVoiceBtn) {
      activeVoiceBtn.classList.remove('qa-voice-btn-active');
      var statusEl = activeVoiceBtn.querySelector('.qa-voice-status');
      if (statusEl) statusEl.textContent = 'Voice';
      activeVoiceBtn = null;
    }
  }

  function toggleVoiceInput(targetInputId, btnEl) {
    var targetInput = document.getElementById(targetInputId);
    if (!targetInput) return;

    if (!isSpeechRecognitionSupported()) {
      showNotification('Speech recognition is not supported in this browser.', 'error');
      return;
    }

    if (activeVoiceBtn === btnEl && activeRecognizer) {
      stopVoiceInput();
      showNotification('Voice input stopped.', 'info');
      return;
    }

    stopVoiceInput();

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = navigator.language || 'en-US';

    var initialValue = targetInput.value;
    var lastFinalText = '';

    recognizer.onstart = function () {
      activeRecognizer = recognizer;
      activeVoiceBtn = btnEl;
      btnEl.classList.add('qa-voice-btn-active');
      var statusEl = btnEl.querySelector('.qa-voice-status');
      if (statusEl) statusEl.textContent = 'Listening…';
      showNotification('Listening… Speak now to dictate text.', 'info');
    };

    recognizer.onresult = function (event) {
      var interimTranscript = '';
      var finalTranscript = '';

      for (var i = event.resultIndex; i < event.results.length; ++i) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        lastFinalText += (lastFinalText ? ' ' : '') + finalTranscript.trim();
      }

      var currentSpeech = (lastFinalText + (interimTranscript ? ' ' + interimTranscript.trim() : '')).trim();
      if (currentSpeech) {
        var prefix = initialValue.trim();
        targetInput.value = prefix ? prefix + ' ' + currentSpeech : currentSpeech;
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    recognizer.onerror = function (event) {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        showNotification('Microphone error: ' + (event.error || 'speech error'), 'error');
      }
      stopVoiceInput();
    };

    recognizer.onend = function () {
      if (activeVoiceBtn === btnEl) {
        stopVoiceInput();
      }
    };

    try {
      recognizer.start();
    } catch (err) {
      showNotification('Could not start microphone listener.', 'error');
      stopVoiceInput();
    }
  }

  function buildLabelWithMic(labelHtml, targetId) {
    var micSvg = '<svg class="qa-mic-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>' +
      '<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>' +
      '<line x1="12" y1="19" x2="12" y2="22"></line>' +
      '</svg>';

    return '<div class="qa-form-label-header">' +
      '<label class="qa-form-label">' + labelHtml + '</label>' +
      '<button type="button" class="qa-voice-btn" data-target-id="' + targetId + '" title="Voice input (dictate with mic)">' +
        micSvg + '<span class="qa-voice-status">Voice</span>' +
      '</button>' +
    '</div>';
  }

    // ── Optional form fields based on settings ────────────────────────────────
    var optionalFieldsHtml = '';
    if (settings.formExpectedResult !== false) {
      optionalFieldsHtml += '<div class="qa-form-group">' + buildLabelWithMic('Expected Result', 'qa-expected-input') + '<textarea class="qa-form-textarea" id="qa-expected-input" rows="2" placeholder="What should happen?"></textarea></div>';
    }
    if (settings.formActualResult !== false) {
      optionalFieldsHtml += '<div class="qa-form-group">' + buildLabelWithMic('Actual Result', 'qa-actual-input') + '<textarea class="qa-form-textarea" id="qa-actual-input" rows="2" placeholder="What actually happened?"></textarea></div>';
    }
    if (settings.formPriority) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Priority</label><select class="qa-form-select" id="qa-priority-select"><option value="Low">Low</option><option value="Medium" selected>Medium</option><option value="High">High</option><option value="Critical">Critical</option></select></div>';
    }
    if (settings.formEnvironment) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Environment</label><select class="qa-form-select" id="qa-environment-select"><option>Production</option><option>Staging</option><option>Development</option><option>QA</option></select></div>';
    }
    if (settings.formLabels) {
      optionalFieldsHtml += '<div class="qa-form-group">' + buildLabelWithMic('Labels', 'qa-labels-input') + '<input type="text" class="qa-form-input" id="qa-labels-input" placeholder="bug, ui, regression (comma-separated)"></div>';
    }
    if (settings.formSprint) {
      optionalFieldsHtml += '<div class="qa-form-group">' + buildLabelWithMic('Sprint', 'qa-sprint-input') + '<input type="text" class="qa-form-input" id="qa-sprint-input" placeholder="Sprint name or number"></div>';
    }
    if (settings.formAssignee) {
      optionalFieldsHtml += '<div class="qa-form-group">' + buildLabelWithMic('Assignee', 'qa-assignee-input') + '<input type="text" class="qa-form-input" id="qa-assignee-input" placeholder="e.g. john@company.com"></div>';
    }

    var domContext = extractDOMContext(element, 'report');

    modal.innerHTML =
      '<div class="qa-modal-header" id="qa-modal-drag-handle">' +
        '<span class="qa-modal-header-title">&#x1F41B; Report a Bug</span>' +
        '<button class="qa-modal-close-btn" id="qa-modal-x-btn" title="Cancel">✕</button>' +
      '</div>' +
      '<div class="qa-modal-scroll"><div class="qa-modal-body">' +
        screenshotHtml +
        replayHtml +
        videoAttachHtml +
        '<div class="qa-modal-tabs" id="qa-modal-tabs">' +
          '<button type="button" class="qa-modal-tab qa-tab-active" id="qa-tab-smart">✨ Smart Mode (AI)</button>' +
          '<button type="button" class="qa-modal-tab" id="qa-tab-standard">Standard Form</button>' +
        '</div>' +
        '<div class="qa-tab-pane" id="qa-pane-smart">' +
          '<div class="qa-dom-summary-badge">' +
            '<span class="qa-badge-icon">📍</span>' +
            '<span class="qa-badge-text">Target: <b>' + escapeHTML(domContext.target.name || elemData.note || elemData.text || elemData.tag) + '</b> &middot; Container: <i>' + escapeHTML(domContext.container ? (domContext.container.label || domContext.container.tag) : 'section') + '</i></span>' +
          '</div>' +
          '<div class="qa-form-group" style="margin-top: 10px;">' +
            '<div class="qa-form-label-header">' +
              '<label class="qa-form-label">What\'s wrong? (Single-input AI reporting)</label>' +
              '<button type="button" class="qa-voice-btn" data-target-id="qa-smart-input" title="Voice input (dictate)">' +
                '<svg class="qa-mic-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>' +
                '<span class="qa-voice-status">Voice</span>' +
              '</button>' +
            '</div>' +
            '<textarea class="qa-form-textarea qa-smart-textarea" id="qa-smart-input" rows="3" placeholder="Describe the issue in your own words (e.g. \'Save button stays disabled after entering valid email\'). BugPilot will synthesize title, steps to reproduce, expected vs actual behavior, and severity."></textarea>' +
          '</div>' +
          '<div class="qa-smart-action-row">' +
            '<button type="button" class="qa-btn qa-btn-autofill" id="qa-btn-smart-autofill">✨ Auto-Fill with AI</button>' +
            '<span class="qa-smart-status-text" id="qa-smart-status"></span>' +
          '</div>' +
          '<div class="qa-smart-preview-card" id="qa-smart-preview-card" style="display:none">' +
            '<div class="qa-preview-header">' +
              '<span class="qa-preview-title" id="qa-preview-title"></span>' +
              '<span class="qa-badge qa-badge-sev" id="qa-preview-sev">Medium</span>' +
            '</div>' +
            '<div class="qa-preview-summary" id="qa-preview-summary"></div>' +
          '</div>' +
          (recordedSteps.length > 0 ? '<div class="qa-recorded-steps-banner">🐾 <b>' + recordedSteps.length + ' recorded workflow steps</b> attached to this bug report.</div>' : '') +
        '</div>' +
        '<div class="qa-tab-pane" id="qa-pane-standard" style="display:none">' +
          '<div class="qa-modal-element-info">' +
            '<span class="qa-element-tag">&lt;' + escapeHTML(elemData.tag) + '&gt;</span>' +
            '<span class="qa-element-text">' + escapeHTML(elemData.note || elemData.text || elemData.cssSelector) + '</span>' +
          '</div>' +
          '<div class="qa-form-group">' +
            buildLabelWithMic('Issue Title <span class="qa-required">*</span>', 'qa-title-input') +
            '<input type="text" class="qa-form-input" id="qa-title-input" placeholder="Brief description of the bug">' +
          '</div>' +
          '<div class="qa-form-group">' +
            buildLabelWithMic('Description', 'qa-desc-input') +
            '<textarea class="qa-form-textarea" id="qa-desc-input" placeholder="Steps to reproduce..." rows="3"></textarea>' +
          '</div>' +
          optionalFieldsHtml +
          '<details class="qa-collapsible">' +
            '<summary>Severity &amp; more</summary>' +
            '<div class="qa-collapsible-body">' +
              '<div class="qa-form-group"><label class="qa-form-label">Severity</label><select class="qa-form-select" id="qa-severity-select"><option value="Low">Low</option><option value="Medium" selected>Medium</option><option value="High">High</option><option value="Critical">Critical</option></select></div>' +
              '<div class="qa-form-group"><label class="qa-form-label">Assignee</label><select class="qa-select" id="qa-assignee-select">' + buildAssigneeOptions(qaLastAssignee) + '</select></div>' +
            '</div>' +
          '</details>' +
          '<details class="qa-collapsible">' +
            '<summary>Element Details</summary>' +
            '<div class="qa-collapsible-body">' +
              (elemData.note ? '<div class="qa-detail-item"><span class="qa-detail-label">Note</span><code>' + escapeHTML(elemData.note) + '</code></div>' : '') +
              '<div class="qa-detail-item"><span class="qa-detail-label">Tag</span><code>' + escapeHTML(elemData.tag) + '</code></div>' +
              (elemData.id ? '<div class="qa-detail-item"><span class="qa-detail-label">ID</span><code>' + escapeHTML(elemData.id) + '</code></div>' : '') +
              (elemData.classList.length ? '<div class="qa-detail-item"><span class="qa-detail-label">Classes</span><code>' + escapeHTML(elemData.classList.join(', ')) + '</code></div>' : '') +
              semanticHtml +
              '<div class="qa-detail-item"><span class="qa-detail-label">CSS Selector</span><code>' + escapeHTML(elemData.cssSelector) + '</code></div>' +
              (settings.captureXPath !== false ? '<div class="qa-detail-item"><span class="qa-detail-label">XPath</span><code>' + escapeHTML(elemData.xpath) + '</code></div>' : '') +
              reactHtml +
            '</div>' +
          '</details>' +
          (settings.captureConsole !== false ? '<details class="qa-collapsible"><summary>Console errors (' + consoleSnap.length + ')</summary><div class="qa-collapsible-body">' + consoleHtml + '</div></details>' : '') +
          (settings.captureNetwork !== false ? '<details class="qa-collapsible"><summary>Network errors (' + networkSnap.length + ')</summary><div class="qa-collapsible-body">' + networkHtml + '</div></details>' : '') +
        '</div>' +
      '</div></div>' +
      '<div class="qa-modal-footer">' +
        '<button class="qa-btn qa-btn-secondary" id="qa-btn-save-continue">Save &amp; Continue</button>' +
        '<button class="qa-btn qa-btn-primary" id="qa-btn-save-submit">Save &amp; Submit</button>' +
        '<button class="qa-btn qa-btn-danger" id="qa-btn-cancel" style="margin-left:auto">✕ Cancel</button>' +
      '</div>';

    document.documentElement.appendChild(modal);
    setTimeout(function () {
      var smartInp = modal.querySelector('#qa-smart-input');
      if (smartInp) smartInp.focus();
      else {
        var inp = modal.querySelector('#qa-title-input');
        if (inp) inp.focus();
      }
    }, 50);
    makeDraggable(modal, document.getElementById('qa-modal-drag-handle'));

    // ── Tab switcher ──────────────────────────────────────────────────────────
    var tabSmart = modal.querySelector('#qa-tab-smart');
    var tabStandard = modal.querySelector('#qa-tab-standard');
    var paneSmart = modal.querySelector('#qa-pane-smart');
    var paneStandard = modal.querySelector('#qa-pane-standard');

    if (tabSmart && tabStandard && paneSmart && paneStandard) {
      tabSmart.addEventListener('click', function () {
        tabSmart.classList.add('qa-tab-active');
        tabStandard.classList.remove('qa-tab-active');
        paneSmart.style.display = 'block';
        paneStandard.style.display = 'none';
        var inp = modal.querySelector('#qa-smart-input');
        if (inp) inp.focus();
      });
      tabStandard.addEventListener('click', function () {
        tabStandard.classList.add('qa-tab-active');
        tabSmart.classList.remove('qa-tab-active');
        paneStandard.style.display = 'block';
        paneSmart.style.display = 'none';
        var inp = modal.querySelector('#qa-title-input');
        if (inp) inp.focus();
      });
    }

    // ── Smart Autofill Interaction ────────────────────────────────────────────
    var btnAutofill = modal.querySelector('#qa-btn-smart-autofill');
    var smartInp = modal.querySelector('#qa-smart-input');
    var smartStatus = modal.querySelector('#qa-smart-status');
    var previewCard = modal.querySelector('#qa-smart-preview-card');
    var previewTitle = modal.querySelector('#qa-preview-title');
    var previewSev = modal.querySelector('#qa-preview-sev');
    var previewSummary = modal.querySelector('#qa-preview-summary');

    function triggerSmartAutofill() {
      var rawText = smartInp ? smartInp.value.trim() : '';
      if (!rawText) {
        if (smartInp) smartInp.focus();
        return;
      }
      if (btnAutofill) {
        btnAutofill.disabled = true;
        btnAutofill.textContent = '✨ Generating…';
      }
      if (smartStatus) smartStatus.textContent = 'Analyzing DOM context…';

      chrome.runtime.sendMessage({
        type: 'SMART_AUTOFILL',
        payload: {
          userInput: rawText,
          domContext: domContext,
          elementInfo: elemData,
          consoleErrors: consoleSnap,
          networkErrors: networkSnap,
          url: window.location.href,
          route: window.location.pathname,
        }
      }, function (res) {
        if (btnAutofill) {
          btnAutofill.disabled = false;
          btnAutofill.textContent = '✨ Auto-Fill with AI';
        }
        if (res && res.ok && res.result) {
          var r = res.result;
          var titleInp = modal.querySelector('#qa-title-input');
          var descInp = modal.querySelector('#qa-desc-input');
          var expInp = modal.querySelector('#qa-expected-input');
          var actInp = modal.querySelector('#qa-actual-input');
          var sevSel = modal.querySelector('#qa-severity-select');
          var labelsInp = modal.querySelector('#qa-labels-input');

          if (titleInp) titleInp.value = r.title;
          if (descInp) descInp.value = r.description;
          if (expInp && r.expectedResult) expInp.value = r.expectedResult;
          if (actInp && r.actualResult) actInp.value = r.actualResult;
          if (sevSel && r.severity) sevSel.value = r.severity;
          if (labelsInp && r.labels && r.labels.length) labelsInp.value = r.labels.join(', ');

          if (previewCard && previewTitle && previewSev && previewSummary) {
            previewCard.style.display = 'block';
            previewTitle.textContent = r.title;
            previewSev.textContent = r.severity;
            previewSev.className = 'qa-badge qa-badge-sev qa-sev-' + (r.severity || 'Medium').toLowerCase();
            previewSummary.textContent = (r.expectedResult ? 'Expected: ' + r.expectedResult.slice(0, 100) : r.domSummary);
          }
          if (smartStatus) smartStatus.textContent = '✓ AI fields ready';
        } else {
          if (smartStatus) smartStatus.textContent = 'Autofill complete';
        }
      });
    }

    if (btnAutofill) {
      btnAutofill.addEventListener('click', triggerSmartAutofill);
    }

    // ── Slider interactivity ──────────────────────────────────────────────────
    function refreshSlider() {
      var imgEl     = modal.querySelector('#qa-slider-img');
      var counterEl = modal.querySelector('#qa-slider-counter');
      if (!imgEl) return;
      imgEl.src = sliderImages[sliderIndex].dataUrl;
      if (counterEl) counterEl.textContent = (sliderIndex + 1) + ' / ' + sliderImages.length;
    }

    var prevBtn = modal.querySelector('#qa-slider-prev');
    var nextBtn = modal.querySelector('#qa-slider-next');
    var editBtn = modal.querySelector('#qa-slider-edit');

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        sliderIndex = (sliderIndex - 1 + sliderImages.length) % sliderImages.length;
        refreshSlider();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        sliderIndex = (sliderIndex + 1) % sliderImages.length;
        refreshSlider();
      });
    }
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        modal.style.pointerEvents = 'none';   // freeze modal while annotating
        chrome.runtime.sendMessage({
          type:       'OPEN_ANNOTATOR',
          dataUrl:    sliderImages[sliderIndex].dataUrl,
          imageIndex: sliderIndex,
        });
      });
    }

    // ── Replay attachment buttons ─────────────────────────────────────────────
    if (screenRecordingActive) {
      var replaySection = modal.querySelector('#qa-replay-section');
      var attachKeepBtn = modal.querySelector('#qa-btn-attach-keep');
      var stopAttachBtn = modal.querySelector('#qa-btn-stop-attach');

      function setReplayConfirmed(msg) {
        if (replaySection) {
          replaySection.innerHTML = '<span class="qa-replay-confirmed">&#10003; ' + msg + '</span>';
        }
      }

      if (attachKeepBtn) {
        attachKeepBtn.addEventListener('click', function () {
          attachKeepBtn.disabled = true;
          if (stopAttachBtn) stopAttachBtn.disabled = true;
          attachKeepBtn.textContent = 'Attaching…';
          chrome.runtime.sendMessage({ type: 'SNAPSHOT_REPLAY' }, function (res) {
            if (res && res.ok) {
              setReplayConfirmed('Clip attached — recording continues');
            } else {
              if (replaySection) replaySection.innerHTML = '<span class="qa-replay-error">Could not attach clip</span>';
            }
          });
        });
      }

      if (stopAttachBtn) {
        stopAttachBtn.addEventListener('click', function () {
          if (attachKeepBtn) attachKeepBtn.disabled = true;
          stopAttachBtn.disabled = true;
          stopAttachBtn.textContent = 'Stopping…';
          chrome.runtime.sendMessage({ type: 'STOP_AND_ATTACH_REPLAY' }, function (res) {
            if (res && res.ok) {
              setReplayConfirmed('Recording stopped — clip attached');
            } else {
              if (replaySection) replaySection.innerHTML = '<span class="qa-replay-error">Could not stop recording</span>';
            }
          });
        });
      }
    }

    // ── Storage listener: restore modal if annotator dismissed via Escape ─────
    function onStorageChanged(changes) {
      if (changes.qa_annotator_data && !changes.qa_annotator_data.newValue) {
        modal.style.pointerEvents = '';
      }
    }
    chrome.storage.onChanged.addListener(onStorageChanged);

    // ── Build issue data ─────────────────────────────────────────────────────
    function buildIssue() {
      var title    = modal.querySelector('#qa-title-input').value.trim();
      var desc     = modal.querySelector('#qa-desc-input').value.trim();
      var sevEl    = modal.querySelector('#qa-severity-select');
      var severity = sevEl ? sevEl.value : 'Medium';

      var smartText = modal.querySelector('#qa-smart-input') ? modal.querySelector('#qa-smart-input').value.trim() : '';
      if (!title && smartText) {
        var tName = domContext.target.name || elemData.note || elemData.text || elemData.tag || 'element';
        title = smartText.length > 5 && smartText.length < 80 ? (smartText.charAt(0).toUpperCase() + smartText.slice(1)) : (tName + ': ' + smartText.slice(0, 60));
        desc = '### 📝 Summary\n' + smartText + '\n\n### 🔄 Steps to Reproduce\n1. Navigate to `' + window.location.pathname + '`\n2. Interact with `' + tName + '`\n3. Observe: ' + smartText;
        var titleInp = modal.querySelector('#qa-title-input');
        if (titleInp) titleInp.value = title;
        var descInp = modal.querySelector('#qa-desc-input');
        if (descInp) descInp.value = desc;
      }

      if (recordedSteps.length > 0) {
        var stepsText = '\n\n### 🐾 Recorded Workflow Steps\n' + recordedSteps.map(function (s, idx) {
          return (idx + 1) + '. ' + s.label;
        }).join('\n');
        if (desc.indexOf('### 🐾 Recorded Workflow Steps') === -1) {
          desc += stepsText;
          var dInp = modal.querySelector('#qa-desc-input');
          if (dInp) dInp.value = desc;
        }
      }

      if (!title) {
        var inp = modal.querySelector('#qa-title-input');
        if (inp) inp.focus();
        inp.style.borderColor = '#ef4444';
        return null;
      }

      function stripBase64Header(dataUrl) {
        return dataUrl ? dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '') : undefined;
      }

      // Send all slider images — no artificial limit
      var allScreenshots = sliderImages.map(function(img) {
        return { label: img.label, data: stripBase64Header(img.dataUrl) };
      });

      // Also populate legacy fields from the first element/full-page slots for backwards compat
      var elementImg = sliderImages.find(function(img) {
        return img.label === 'Element (annotated)' || img.label === 'Annotated';
      }) || sliderImages.find(function(img) { return img.label === 'Element'; }) || sliderImages[0];

      var fullImg = sliderImages.find(function(img) {
        return img.label === 'Full page (annotated)';
      }) || sliderImages.find(function(img) { return img.label === 'Full page'; });

      var issue = {
        id:               generateUUID(),
        title:            title,
        description:      desc,
        severity:         severity,
        url:              window.location.href,
        route:            settings.captureRoute !== false ? window.location.pathname : undefined,
        timestamp:        new Date().toISOString(),
        capturedAt:       new Date().toISOString(),
        screenshot:       elementImg ? stripBase64Header(elementImg.dataUrl) : undefined,
        fullScreenshot:   fullImg    ? stripBase64Header(fullImg.dataUrl)    : undefined,
        allScreenshots:   allScreenshots,
      };

      // Optional form fields
      var expectedInput   = modal.querySelector('#qa-expected-input');
      var actualInput     = modal.querySelector('#qa-actual-input');
      var prioritySelect  = modal.querySelector('#qa-priority-select');
      var envSelect       = modal.querySelector('#qa-environment-select');
      var labelsInput     = modal.querySelector('#qa-labels-input');
      var sprintInput     = modal.querySelector('#qa-sprint-input');
      var assigneeInput   = modal.querySelector('#qa-assignee-input');
      var assigneeSelect  = modal.querySelector('#qa-assignee-select');

      if (expectedInput && expectedInput.value.trim())  issue.expectedResult = expectedInput.value.trim();
      if (actualInput   && actualInput.value.trim())    issue.actualResult   = actualInput.value.trim();
      if (prioritySelect)                               issue.priority       = prioritySelect.value;
      if (envSelect)                                    issue.environment    = envSelect.value;
      if (labelsInput && labelsInput.value.trim())      issue.labels         = labelsInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (sprintInput && sprintInput.value.trim())      issue.sprint         = sprintInput.value.trim();
      if (assigneeInput && assigneeInput.value.trim())  issue.assignee       = assigneeInput.value.trim();

      // Assignee dropdown (always present)
      var rawAssignee      = assigneeSelect ? assigneeSelect.value : '__me__';
      var resolvedAssignee = rawAssignee === '__unassigned__' ? null
                           : rawAssignee === '__me__'         ? (qaOwnerEmail || null)
                           : rawAssignee;
      qaLastAssignee       = rawAssignee; // sticky for next bug
      issue.assignee       = resolvedAssignee;
      issue.metadata       = issue.metadata || {};
      issue.metadata.assignee = resolvedAssignee;

      // Element info
      issue.element = {
        tagName:        elemData.tagName,
        tag:            elemData.tag,
        id:             elemData.id,
        text:           elemData.text,
        textContent:    elemData.textContent,
        cssSelector:    elemData.cssSelector,
        selector:       elemData.cssSelector,
        classList:      elemData.classList,
        dataAttributes: elemData.dataAttributes,
        dimensions:     elemData.dimensions,
        accessibility:  elemData.accessibility,
        semanticContext: elemData.semanticContext,
      };

      if (settings.captureComputedStyles !== false) issue.element.computedStyles = elemData.computedStyles;
      if (settings.captureXPath !== false)          issue.element.xpath          = elemData.xpath;
      if (settings.captureDomHierarchy !== false)   issue.element.domBreadcrumb  = elemData.domBreadcrumb;
      if (settings.captureReact !== false && elemData.react) issue.element.react = elemData.react;

      // Also keep backward-compat field
      issue.elementInfo = {
        tag: elemData.tag, id: elemData.id, text: elemData.text,
        selector: elemData.cssSelector, classList: elemData.classList,
      };

      // Environment
      if (settings.captureBrowserInfo !== false) {
        issue.environment_info = captureEnvironment();
        issue.browserInfo = { browser: getBrowserName(), version: getBrowserVersion(), os: getOS() };
      }

      // Page context
      issue.pageContext = capturePageContext(settings);

      // Performance
      if (settings.capturePerformance !== false) {
        var perf = capturePerformanceMetrics();
        if (perf) issue.performanceMetrics = perf;
      }

      // App state
      if (settings.captureReact !== false) {
        var appState = captureAppState();
        if (appState) issue.appState = appState;
      }

      // Console errors
      if (settings.captureConsole !== false) {
        issue.recentConsoleErrors = consoleSnap;
        issue.consoleErrors = consoleSnap;
      }

      // Network transactions & errors
      if (settings.captureNetwork !== false) {
        issue.networkTransactions   = _networkTransactions.slice();
        issue.recentNetworkRequests = _networkTransactions.slice();
        issue.networkErrors         = _networkTransactions.slice();
      }

      // User info
      if (settings.captureUserInfo) {
        var userInfo = captureUserInfo();
        if (userInfo) issue.userInfo = userInfo;
      }

      // Navigation history
      if (settings.captureNavHistory !== false) {
        issue.navigationHistory = _navigationHistory.slice(-5);
      }

      // 50-token DOM Context & Recorded Steps
      issue.domContext = domContext;
      issue.element.domContext = domContext;
      issue.metadata = issue.metadata || {};
      issue.metadata.domContext = domContext;
      if (recordedSteps && recordedSteps.length > 0) {
        issue.recordedSteps = recordedSteps;
        issue.metadata.recordedSteps = recordedSteps;
      }

      return issue;
    }

    // ── Local closeModal (removes annotation listener) ────────────────────────
    function closeModal() {
      stopVoiceInput();
      modalOpen = false;
      chrome.runtime.onMessage.removeListener(onAnnotationDone);
      chrome.storage.onChanged.removeListener(onStorageChanged);
      var modalEl = document.getElementById(MODAL_ID);
      var dimEl   = document.getElementById(DIM_ID);
      if (modalEl) modalEl.remove();
      if (dimEl)   dimEl.remove();
      if (recording) enableHover();
    }

    // ── Voice Input Button Click Handler ──────────────────────────────────────
    modal.addEventListener('click', function (e) {
      var btn = e.target.closest('.qa-voice-btn');
      if (btn) {
        e.preventDefault();
        var targetId = btn.getAttribute('data-target-id');
        if (targetId) {
          toggleVoiceInput(targetId, btn);
        }
      }
    });

    // ── Buttons ──────────────────────────────────────────────────────────────
    modal.querySelector('#qa-modal-x-btn').addEventListener('click', function () { closeModal(); });
    modal.querySelector('#qa-btn-cancel').addEventListener('click', function () { closeModal(); });
    dim.addEventListener('click', function () { closeModal(); });

    modal.querySelector('#qa-btn-save-continue').addEventListener('click', function () {
      var issue = buildIssue();
      if (!issue) return;
      chrome.storage.local.get(['qa_selected_project'], function (storage) {
        if (storage.qa_selected_project) issue.projectId = storage.qa_selected_project.id;
        bufferIssue(issue, function () {
          capturedCount++;
          closeModal();
          showNotification('Issue saved — continue recording.', 'success');
        });
      });
    });

    modal.querySelector('#qa-btn-save-submit').addEventListener('click', function () {
      var issue = buildIssue();
      if (!issue) return;
      var btn = modal.querySelector('#qa-btn-save-submit');
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      chrome.storage.local.get(['qa_selected_project'], function (storage) {
        if (storage.qa_selected_project) issue.projectId = storage.qa_selected_project.id;
        bufferIssue(issue, function () {
          capturedCount++;
          var attachVideoChecked = !!(modal.querySelector('#qa-attach-video-checkbox') && modal.querySelector('#qa-attach-video-checkbox').checked);
          chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SUBMIT_ISSUE, issue: issue }, function (res) {
            if (res && res.ok) {
              removeFromBuffer(issue, function () {});
              if (attachVideoChecked && res.result && res.result.id) {
                chrome.runtime.sendMessage({ type: 'REQUEST_VIDEO_ATTACH', issueId: res.result.id });
              }
              closeModal();
              showNotification('Issue submitted successfully!', 'success');
            } else {
              closeModal();
              showNotification('Saved locally. Submit failed: ' + ((res && res.error) || 'unknown error'), 'error');
            }
          });
        });
      });
    });
  }

  function closeModal() {
    stopVoiceInput();
    modalOpen = false;
    var modal = document.getElementById(MODAL_ID);
    var dim   = document.getElementById(DIM_ID);
    if (modal) modal.remove();
    if (dim)   dim.remove();
    if (recording) enableHover();
  }

  // ── Buffer helpers ───────────────────────────────────────────────────────────
  function bufferIssue(issue, callback) {
    chrome.storage.local.get([BUFFER_KEY], function (result) {
      var existing = result[BUFFER_KEY] || [];
      existing.push(issue);
      var update = {};
      update[BUFFER_KEY] = existing;
      chrome.storage.local.set(update, callback);
    });
  }

  function removeFromBuffer(issue, callback) {
    chrome.storage.local.get([BUFFER_KEY], function (result) {
      var existing = result[BUFFER_KEY] || [];
      var filtered = existing.filter(function (i) { return i.capturedAt !== issue.capturedAt && i.id !== issue.id; });
      var update = {};
      update[BUFFER_KEY] = filtered;
      chrome.storage.local.set(update, callback);
    });
  }

  // ── Draggable ────────────────────────────────────────────────────────────────
  function makeDraggable(modal, handle) {
    var startX, startY, startLeft, startTop;
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      var computed = window.getComputedStyle(modal);
      startLeft = parseInt(computed.left, 10) || modal.offsetLeft;
      startTop  = parseInt(computed.top,  10) || modal.offsetTop;
      function onMove(ev) {
        var newLeft = Math.max(0, Math.min(startLeft + ev.clientX - startX, window.innerWidth  - modal.offsetWidth));
        var newTop  = Math.max(0, Math.min(startTop  + ev.clientY - startY, window.innerHeight - 60));
        modal.style.setProperty('left', newLeft + 'px', 'important');
        modal.style.setProperty('top',  newTop  + 'px', 'important');
      }
      function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ── Notification toast ───────────────────────────────────────────────────────
  function showNotification(msg, type) {
    type = type || 'success';
    var existing = document.getElementById('qa-notification-toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'qa-notification-toast';
    el.className = 'qa-reporter-notification qa-notif-' + type;
    el.textContent = msg;
    document.documentElement.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 4000);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  // Interceptors must start immediately so early console/network events are not lost
  setupConsoleInterceptor();
  setupNetworkInterceptor();
  setupNavigationTracking();

})();
