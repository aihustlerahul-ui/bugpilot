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

  var CONSOLE_BUFFER_SIZE = 15;
  var NETWORK_BUFFER_SIZE = 15;
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

  // ── Early interceptors (always active) ─────────────────────────────────────
  var _consoleBuffer    = [];
  var _networkBuffer    = [];
  var _navigationHistory = [];

  function setupConsoleInterceptor() {
    var levels = ['error', 'warn'];
    levels.forEach(function (level) {
      var original = console[level].bind(console);
      console[level] = function () {
        var args = Array.prototype.slice.call(arguments);
        var message;
        try {
          message = args.map(function (a) {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
            try { return JSON.stringify(a); } catch (e) { return String(a); }
          }).join(' ');
        } catch (e) {
          message = String(args[0]);
        }
        _consoleBuffer.push({ level: level, message: message.substring(0, 300), timestamp: new Date().toISOString() });
        if (_consoleBuffer.length > CONSOLE_BUFFER_SIZE) _consoleBuffer.shift();
        original.apply(console, args);
      };
    });
  }

  function setupNetworkInterceptor() {
    if (window.fetch) {
      var originalFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = (init && init.method) || (input && input.method) || 'GET';
        var start = Date.now();
        return originalFetch(input, init).then(function (response) {
          if (!response.ok) {
            _networkBuffer.push({ method: method.toUpperCase(), url: url.substring(0, 200), status: response.status, duration: Date.now() - start, timestamp: new Date().toISOString() });
            if (_networkBuffer.length > NETWORK_BUFFER_SIZE) _networkBuffer.shift();
          }
          return response;
        }, function (err) {
          _networkBuffer.push({ method: method.toUpperCase(), url: url.substring(0, 200), status: 'failed', duration: Date.now() - start, timestamp: new Date().toISOString() });
          if (_networkBuffer.length > NETWORK_BUFFER_SIZE) _networkBuffer.shift();
          throw err;
        });
      };
    }

    var OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      var xhr = new OriginalXHR();
      var entry = { method: 'GET', url: '', start: 0 };
      var originalOpen = xhr.open.bind(xhr);
      xhr.open = function (method, url) {
        entry.method = method.toUpperCase();
        entry.url = String(url).substring(0, 200);
        return originalOpen.apply(xhr, arguments);
      };
      var originalSend = xhr.send.bind(xhr);
      xhr.send = function () {
        entry.start = Date.now();
        xhr.addEventListener('loadend', function () {
          if (xhr.status >= 400) {
            _networkBuffer.push({ method: entry.method, url: entry.url, status: xhr.status, duration: Date.now() - entry.start, timestamp: new Date().toISOString() });
            if (_networkBuffer.length > NETWORK_BUFFER_SIZE) _networkBuffer.shift();
          }
        });
        return originalSend.apply(xhr, arguments);
      };
      return xhr;
    };
  }

  function setupNavigationTracking() {
    function pushNav() {
      _navigationHistory.push({ url: window.location.href, timestamp: new Date().toISOString() });
      if (_navigationHistory.length > NAV_HISTORY_SIZE) _navigationHistory.shift();
    }

    pushNav(); // record initial page

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
    window.addEventListener('popstate', pushNav);
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

  function cropToElement(dataUrl, rect, padding, callback) {
    var img = new Image();
    img.onload = function () {
      var dpr = window.devicePixelRatio || 1;
      var x = Math.max(0, (rect.left - padding) * dpr);
      var y = Math.max(0, (rect.top  - padding) * dpr);
      var w = Math.min(img.width  - x, (rect.width  + padding * 2) * dpr);
      var h = Math.min(img.height - y, (rect.height + padding * 2) * dpr);
      var canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      var highlightX = padding * dpr;
      var highlightY = padding * dpr;
      var highlightW = rect.width  * dpr;
      var highlightH = rect.height * dpr;
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth   = 3 * dpr;
      ctx.strokeRect(highlightX, highlightY, highlightW, highlightH);
      callback(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function () { callback(dataUrl); };
    img.src = dataUrl;
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
      return Object.keys(metrics).length > 0 ? metrics : null;
    } catch (e) {
      return null;
    }
  }

  // ── App state (React Router + Zustand) ──────────────────────────────────────
  function captureAppState() {
    var result = {};
    try {
      var state = window.history.state;
      if (state && (state.idx !== undefined || state.key !== undefined)) {
        result.reactRouterState = { idx: state.idx, key: state.key, usr: state.usr || null };
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

  function generateCssSelector(element) {
    if (!element || element === document.body) return 'body';
    if (element.id && !isNumericId(element.id)) return '#' + CSS.escape(element.id);
    var dataAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-qa'];
    for (var i = 0; i < dataAttrs.length; i++) {
      var attrVal = element.getAttribute(dataAttrs[i]);
      if (attrVal) return '[' + dataAttrs[i] + '="' + CSS.escape(attrVal) + '"]';
    }
    if (element.classList && element.classList.length > 0) {
      var stableClasses = Array.from(element.classList).filter(function (cls) { return !isGeneratedClass(cls); });
      if (stableClasses.length > 0) {
        var className = stableClasses.map(function (c) { return '.' + CSS.escape(c); }).join('');
        try { if (document.querySelectorAll(className).length === 1) return className; } catch (e) {}
      }
    }
    var stableAttrs = ['name', 'type', 'placeholder', 'aria-label', 'title', 'role'];
    for (var j = 0; j < stableAttrs.length; j++) {
      var val = element.getAttribute(stableAttrs[j]);
      if (val) return element.tagName.toLowerCase() + '[' + stableAttrs[j] + '="' + CSS.escape(val) + '"]';
    }
    var path = [];
    var current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      var sel = current.tagName.toLowerCase();
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function (child) { return child.tagName === current.tagName; });
        if (siblings.length > 1) sel += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      path.unshift(sel);
      current = parent;
    }
    return path.join(' > ');
  }

  function generateXPath(element) {
    if (!element) return '';
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
      if (parent) {
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
    var breadcrumb = [];
    var current = element;
    var depth = 0;
    while (current && current !== document.documentElement && depth < 20) {
      var item = { tag: current.tagName.toLowerCase() };
      if (current.id && !isNumericId(current.id)) item.id = current.id;
      if (current.getAttribute('role')) item.role = current.getAttribute('role');
      if (current.classList && current.classList.length > 0) {
        var stableClasses = Array.from(current.classList).filter(function (c) { return !isGeneratedClass(c); });
        if (stableClasses.length > 0) item.classes = stableClasses.slice(0, 5);
      }
      var parent = current.parentElement;
      if (parent) {
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
  function sanitizeReactProps(props, depth) {
    if (!props || depth > 2) return undefined;
    var result = {};
    var count = 0;
    Object.keys(props).forEach(function (key) {
      if (count >= 15) return;
      if (key === 'children') return;
      var val = props[key];
      if (val === null || val === undefined) return;
      if (typeof val === 'function') return;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        result[key] = val; count++;
      } else if (typeof val === 'object' && !Array.isArray(val) && depth < 2) {
        var nested = sanitizeReactProps(val, depth + 1);
        if (nested && Object.keys(nested).length > 0) { result[key] = nested; count++; }
      }
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }

  function getReactComponentInfo(element) {
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
      while (node && depth < 30) {
        if (node.type && typeof node.type === 'function') {
          var name = node.type.displayName || node.type.name || 'Anonymous';
          if (name && name !== 'Anonymous') {
            componentTree.push(name);
            if (!closestName) {
              closestName = name;
              closestProps = sanitizeReactProps(node.memoizedProps || {}, 0);
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
        var label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
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

  // ── Full element data capture ────────────────────────────────────────────────
  function captureElementData(element) {
    var cssSelector = generateCssSelector(element);
    var xpath       = generateXPath(element);

    var dataAttributes = {};
    DATA_ATTRIBUTES.forEach(function (attr) {
      var value = element.getAttribute(attr);
      if (value) dataAttributes[attr] = value;
    });

    var result = {
      tag:            element.tagName.toLowerCase(),
      tagName:        element.tagName,
      id:             element.id || null,
      classList:      element.classList ? Array.from(element.classList) : [],
      text:           safeGetTextContent(element, 100),
      textContent:    safeGetTextContent(element, 100),
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

    var reactInfo = getReactComponentInfo(element);
    if (reactInfo) result.react = reactInfo;

    return result;
  }

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
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CAPTURE_SCREENSHOT }, function (res) {
        var fullDataUrl = (res && res.ok) ? res.dataUrl : null;
        var screenRecordingActive = !!(res && res.screenRecordingActive);
        var isMultiTab = !!(res && res.isMultiTab);
        var recordingStartedAt = (res && res.recordingStartedAt) || null;
        chrome.storage.local.get(['qa_ext_settings'], function (stored) {
          var settings = stored.qa_ext_settings || {};
          var mode     = settings.screenshotMode || 'element_context';
          function openModal(screenshotDataUrl) {
            showModal({ element: clickedEl || document.body, elemData: elemData, screenshotDataUrl: screenshotDataUrl, fullScreenshotDataUrl: fullDataUrl, settings: settings, screenRecordingActive: screenRecordingActive, isMultiTab: isMultiTab, recordingStartedAt: recordingStartedAt });
          }
          if (!fullDataUrl || elemRect.width === 0) return openModal(fullDataUrl);
          if (mode === 'full')             { openModal(fullDataUrl); }
          else if (mode === 'element_crop'){ cropToElement(fullDataUrl, elemRect, 0,  openModal); }
          else if (mode === 'full_highlighted') { drawHighlight(fullDataUrl, elemRect, openModal); }
          else { cropToElement(fullDataUrl, elemRect, 80, openModal); }
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
    return {
      selector:     'coordinate@(' + Math.round(cx) + ',' + Math.round(cy) + ')',
      tagName:      'region',
      text:         '',
      attributes:   { 'data-qa-coordinate': Math.round(cx) + ',' + Math.round(cy) },
      boundingRect: { x: cx, y: cy, width: 140, height: 36, top: cy - 18, left: cx - 70, right: cx + 70, bottom: cy + 18 },
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
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CAPTURE_SCREENSHOT }, function (res) {
        var fullDataUrl = (res && res.ok) ? res.dataUrl : null;
        var screenRecordingActive = !!(res && res.screenRecordingActive);
        var isMultiTab = !!(res && res.isMultiTab);
        var recordingStartedAt = (res && res.recordingStartedAt) || null;
        elemData = captureElementData(clickedEl);

        chrome.storage.local.get(['qa_ext_settings'], function (stored) {
          var settings = stored.qa_ext_settings || {};
          var mode     = settings.screenshotMode || 'element_context';

          function openModal(screenshotDataUrl) {
            showModal({ element: clickedEl, elemData: elemData, screenshotDataUrl: screenshotDataUrl, fullScreenshotDataUrl: fullDataUrl, settings: settings, screenRecordingActive: screenRecordingActive, isMultiTab: isMultiTab, recordingStartedAt: recordingStartedAt });
          }

          if (!fullDataUrl || elemRect.width === 0) return openModal(fullDataUrl);

          if (mode === 'full')             { openModal(fullDataUrl); }
          else if (mode === 'element_crop'){ cropToElement(fullDataUrl, elemRect, 0,  openModal); }
          else if (mode === 'full_highlighted') { drawHighlight(fullDataUrl, elemRect, openModal); }
          else { cropToElement(fullDataUrl, elemRect, 80, openModal); } // element_context + both + default
        });
      });
    }, 80);
  }

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

    // ── Optional form fields based on settings ────────────────────────────────
    var optionalFieldsHtml = '';
    if (settings.formExpectedResult !== false) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Expected Result</label><textarea class="qa-form-textarea" id="qa-expected-input" rows="2" placeholder="What should happen?"></textarea></div>';
    }
    if (settings.formActualResult !== false) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Actual Result</label><textarea class="qa-form-textarea" id="qa-actual-input" rows="2" placeholder="What actually happened?"></textarea></div>';
    }
    if (settings.formPriority) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Priority</label><select class="qa-form-select" id="qa-priority-select"><option value="Low">Low</option><option value="Medium" selected>Medium</option><option value="High">High</option><option value="Critical">Critical</option></select></div>';
    }
    if (settings.formEnvironment) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Environment</label><select class="qa-form-select" id="qa-environment-select"><option>Production</option><option>Staging</option><option>Development</option><option>QA</option></select></div>';
    }
    if (settings.formLabels) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Labels</label><input type="text" class="qa-form-input" id="qa-labels-input" placeholder="bug, ui, regression (comma-separated)"></div>';
    }
    if (settings.formSprint) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Sprint</label><input type="text" class="qa-form-input" id="qa-sprint-input" placeholder="Sprint name or number"></div>';
    }
    if (settings.formAssignee) {
      optionalFieldsHtml += '<div class="qa-form-group"><label class="qa-form-label">Assignee</label><input type="text" class="qa-form-input" id="qa-assignee-input" placeholder="e.g. john@company.com"></div>';
    }

    modal.innerHTML =
      '<div class="qa-modal-header" id="qa-modal-drag-handle">' +
        '<span class="qa-modal-header-title">&#x1F41B; Report a Bug</span>' +
        '<button class="qa-modal-close-btn" id="qa-modal-x-btn" title="Cancel">✕</button>' +
      '</div>' +
      '<div class="qa-modal-scroll"><div class="qa-modal-body">' +
        screenshotHtml +
        replayHtml +
        '<div class="qa-modal-element-info">' +
          '<span class="qa-element-tag">&lt;' + escapeHTML(elemData.tag) + '&gt;</span>' +
          '<span class="qa-element-text">' + escapeHTML(elemData.text || elemData.cssSelector) + '</span>' +
        '</div>' +
        '<div class="qa-form-group">' +
          '<label class="qa-form-label">Issue Title <span class="qa-required">*</span></label>' +
          '<input type="text" class="qa-form-input" id="qa-title-input" placeholder="Brief description of the bug">' +
        '</div>' +
        '<div class="qa-form-group">' +
          '<label class="qa-form-label">Description</label>' +
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
      '</div></div>' +
      '<div class="qa-modal-footer">' +
        '<button class="qa-btn qa-btn-secondary" id="qa-btn-save-continue">Save &amp; Continue</button>' +
        '<button class="qa-btn qa-btn-primary" id="qa-btn-save-submit">Save &amp; Submit</button>' +
        '<button class="qa-btn qa-btn-danger" id="qa-btn-cancel" style="margin-left:auto">✕ Cancel</button>' +
      '</div>';

    document.documentElement.appendChild(modal);
    setTimeout(function () { var inp = modal.querySelector('#qa-title-input'); if (inp) inp.focus(); }, 50);
    makeDraggable(modal, document.getElementById('qa-modal-drag-handle'));

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

      if (!title) {
        var inp = modal.querySelector('#qa-title-input');
        inp.focus();
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

      // Network errors
      if (settings.captureNetwork !== false) {
        issue.recentNetworkRequests = networkSnap;
        issue.networkErrors = networkSnap;
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

      return issue;
    }

    // ── Local closeModal (removes annotation listener) ────────────────────────
    function closeModal() {
      modalOpen = false;
      chrome.runtime.onMessage.removeListener(onAnnotationDone);
      chrome.storage.onChanged.removeListener(onStorageChanged);
      var modalEl = document.getElementById(MODAL_ID);
      var dimEl   = document.getElementById(DIM_ID);
      if (modalEl) modalEl.remove();
      if (dimEl)   dimEl.remove();
      if (recording) enableHover();
    }

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
          chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SUBMIT_ISSUE, issue: issue }, function (res) {
            if (res && res.ok) {
              removeFromBuffer(issue, function () {});
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
  function init() {
    setupConsoleInterceptor();
    setupNetworkInterceptor();
    setupNavigationTracking();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
