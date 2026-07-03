/**
 * QA Reporter Content Script
 * Self-contained script that handles element selection and issue reporting
 * This script is injected into all pages
 */

(function() {
  'use strict';

  // ========================================
  // Constants
  // ========================================

  var MESSAGE_TYPES = {
    START_REPORTING: 'START_REPORTING',
    STOP_REPORTING: 'STOP_REPORTING',
    REPORTING_STATUS: 'REPORTING_STATUS',
    ELEMENT_SELECTED: 'ELEMENT_SELECTED',
    SAVE_ISSUE: 'SAVE_ISSUE',
    GET_ISSUES: 'GET_ISSUES',
    DELETE_ISSUE: 'DELETE_ISSUE',
    CLEAR_ISSUES: 'CLEAR_ISSUES',
    EXPORT_ISSUES: 'EXPORT_ISSUES',
    GET_ISSUE_COUNT: 'GET_ISSUE_COUNT',
    ERROR: 'ERROR'
  };

  var STORAGE_KEYS = {
    ISSUES: 'qa_reporter_issues',
    REPORTING_MODE: 'qa_reporter_mode'
  };

  var SEVERITY_LEVELS = {
    LOW: 'Low',
    MEDIUM: 'Medium',
    HIGH: 'High',
    CRITICAL: 'Critical'
  };

  var DATA_ATTRIBUTES = [
    'data-feature',
    'data-component',
    'data-module'
  ];

  var CONSOLE_BUFFER_SIZE = 20;
  var NETWORK_BUFFER_SIZE = 20;
  var NAVIGATION_BUFFER_SIZE = 15;
  var SCREENSHOT_MAX_WIDTH = 1280;

  // ========================================
  // Runtime Interceptors (set up early)
  // ========================================

  var _consoleBuffer = [];
  var _networkBuffer = [];
  var _navigationHistory = [];
  var _pendingScreenshot = null;

  function setupConsoleInterceptor() {
    var levels = ['error', 'warn'];
    levels.forEach(function(level) {
      var original = console[level].bind(console);
      console[level] = function() {
        var args = Array.prototype.slice.call(arguments);
        var message;
        try {
          message = args.map(function(a) {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
            try { return JSON.stringify(a); } catch(e) { return String(a); }
          }).join(' ');
        } catch(e) {
          message = String(args[0]);
        }
        _consoleBuffer.push({ level: level, message: message.substring(0, 300), timestamp: new Date().toISOString() });
        if (_consoleBuffer.length > CONSOLE_BUFFER_SIZE) _consoleBuffer.shift();
        original.apply(console, args);
      };
    });
  }

  function setupNetworkInterceptor() {
    // Intercept fetch
    if (window.fetch) {
      var originalFetch = window.fetch.bind(window);
      window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = (init && init.method) || (input && input.method) || 'GET';
        var start = Date.now();
        return originalFetch(input, init).then(function(response) {
          _networkBuffer.push({
            method: method.toUpperCase(),
            url: url.substring(0, 200),
            status: response.status,
            duration: Date.now() - start,
            timestamp: new Date().toISOString()
          });
          if (_networkBuffer.length > NETWORK_BUFFER_SIZE) _networkBuffer.shift();
          return response;
        }, function(err) {
          _networkBuffer.push({
            method: method.toUpperCase(),
            url: url.substring(0, 200),
            status: 'failed',
            duration: Date.now() - start,
            timestamp: new Date().toISOString()
          });
          if (_networkBuffer.length > NETWORK_BUFFER_SIZE) _networkBuffer.shift();
          throw err;
        });
      };
    }

    // Intercept XHR
    var OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
      var xhr = new OriginalXHR();
      var entry = { method: 'GET', url: '', start: 0 };
      var originalOpen = xhr.open.bind(xhr);
      xhr.open = function(method, url) {
        entry.method = method.toUpperCase();
        entry.url = String(url).substring(0, 200);
        return originalOpen.apply(xhr, arguments);
      };
      var originalSend = xhr.send.bind(xhr);
      xhr.send = function() {
        entry.start = Date.now();
        xhr.addEventListener('loadend', function() {
          _networkBuffer.push({
            method: entry.method,
            url: entry.url,
            status: xhr.status,
            duration: Date.now() - entry.start,
            timestamp: new Date().toISOString()
          });
          if (_networkBuffer.length > NETWORK_BUFFER_SIZE) _networkBuffer.shift();
        });
        return originalSend.apply(xhr, arguments);
      };
      return xhr;
    };
  }

  function setupNavigationTracker() {
    function record(url) {
      _navigationHistory.push({ url: url, timestamp: new Date().toISOString() });
      if (_navigationHistory.length > NAVIGATION_BUFFER_SIZE) _navigationHistory.shift();
    }

    var originalPushState = history.pushState.bind(history);
    var originalReplaceState = history.replaceState.bind(history);

    history.pushState = function() {
      originalPushState.apply(history, arguments);
      record(window.location.href);
    };
    history.replaceState = function() {
      originalReplaceState.apply(history, arguments);
    };

    window.addEventListener('popstate', function() {
      record(window.location.href);
    });

    record(window.location.href);
  }

  // ========================================
  // Utility Functions
  // ========================================

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getTimestamp() {
    return new Date().toISOString();
  }

  function safeGetTextContent(element, maxLength) {
    maxLength = maxLength || 100;
    if (!element || !element.textContent) return '';
    var text = element.textContent.trim();
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  function preventDefaultAndStop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ========================================
  // Selector Generator
  // ========================================

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
    return patterns.some(function(pattern) {
      return pattern.test(className);
    });
  }

  function generateCssSelector(element) {
    if (!element || element === document.body) return 'body';

    if (element.id && !isNumericId(element.id)) {
      return '#' + CSS.escape(element.id);
    }

    var dataAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-qa'];
    for (var i = 0; i < dataAttrs.length; i++) {
      var attrVal = element.getAttribute(dataAttrs[i]);
      if (attrVal) return '[' + dataAttrs[i] + '="' + CSS.escape(attrVal) + '"]';
    }

    if (element.classList && element.classList.length > 0) {
      var stableClasses = Array.from(element.classList).filter(function(cls) {
        return !isGeneratedClass(cls);
      });
      if (stableClasses.length > 0) {
        var className = stableClasses.map(function(c) { return '.' + CSS.escape(c); }).join('');
        try {
          if (document.querySelectorAll(className).length === 1) return className;
        } catch(e) {}
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
        var siblings = Array.from(parent.children).filter(function(child) { return child.tagName === current.tagName; });
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

    if (element.id && !isNumericId(element.id)) {
      return '//*[@id="' + element.id + '"]';
    }

    var dataAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-qa'];
    for (var i = 0; i < dataAttrs.length; i++) {
      var val = element.getAttribute(dataAttrs[i]);
      if (val) return '//*[@' + dataAttrs[i] + '="' + val + '"]';
    }

    var parts = [];
    var current = element;
    while (current && current !== document.documentElement) {
      var part = current.tagName.toLowerCase();
      if (current.id && !isNumericId(current.id)) {
        parts.unshift('//*[@id="' + current.id + '"]');
        break;
      }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName; });
        if (siblings.length > 1) part += '[' + (siblings.indexOf(current) + 1) + ']';
      }
      parts.unshift(part);
      current = parent;
    }
    return '/' + parts.join('/');
  }

  function getBestSelector(element) {
    return {
      cssSelector: generateCssSelector(element),
      xpath: generateXPath(element)
    };
  }

  // ========================================
  // React Component Tree
  // ========================================

  function sanitizeReactProps(props, depth) {
    if (!props || depth > 2) return undefined;
    var result = {};
    var count = 0;
    Object.keys(props).forEach(function(key) {
      if (count >= 15) return;
      if (key === 'children') return;
      var val = props[key];
      if (val === null || val === undefined) return;
      if (typeof val === 'function') return;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        result[key] = val;
        count++;
      } else if (typeof val === 'object' && !Array.isArray(val) && depth < 2) {
        var nested = sanitizeReactProps(val, depth + 1);
        if (nested && Object.keys(nested).length > 0) {
          result[key] = nested;
          count++;
        }
      }
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }

  function getReactComponentInfo(element) {
    try {
      var fiberKey = Object.keys(element).find(function(k) {
        return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$');
      });
      if (!fiberKey) return null;

      var fiber = element[fiberKey];
      var componentTree = [];
      var closestProps = null;
      var closestName = null;
      var node = fiber;
      var depth = 0;

      while (node && depth < 30) {
        if (node.type && typeof node.type === 'function') {
          var name = node.type.displayName || node.type.name || 'Anonymous';
          if (name && name !== 'Anonymous') {
            componentTree.push(name);
            if (!closestName) {
              closestName = name;
              closestProps = sanitizeReactProps(node.memoizedProps || {}, 0);
            }
          }
        }
        node = node.return;
        depth++;
      }

      if (componentTree.length === 0) return null;

      return {
        componentName: closestName,
        componentTree: componentTree.slice(0, 10),
        props: closestProps || {}
      };
    } catch(e) {
      return null;
    }
  }

  // ========================================
  // DOM Breadcrumb (ancestor chain with React component names)
  // ========================================

  function getReactComponentNameForNode(domNode) {
    try {
      var fiberKey = Object.keys(domNode).find(function(k) {
        return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$');
      });
      if (!fiberKey) return null;
      var node = domNode[fiberKey];
      while (node) {
        if (node.type && typeof node.type === 'function') {
          var name = node.type.displayName || node.type.name;
          if (name && name !== 'Anonymous') return name;
        }
        node = node.return;
      }
    } catch(e) {}
    return null;
  }

  function getDomBreadcrumb(element) {
    var breadcrumb = [];
    var current = element;
    var depth = 0;

    while (current && current !== document.documentElement && depth < 20) {
      var entry = { tag: current.tagName.toLowerCase() };

      if (current.id && !isNumericId(current.id)) entry.id = current.id;

      var dataAttrs = {};
      ['data-feature', 'data-component', 'data-module', 'data-testid', 'data-section',
       'data-page', 'data-cy', 'data-qa', 'data-view'].forEach(function(attr) {
        var val = current.getAttribute(attr);
        if (val) dataAttrs[attr] = val;
      });
      if (Object.keys(dataAttrs).length) entry.dataAttrs = dataAttrs;

      var role = current.getAttribute('role');
      var ariaLabel = current.getAttribute('aria-label');
      if (role) entry.role = role;
      if (ariaLabel) entry.ariaLabel = ariaLabel;

      if (current.classList && current.classList.length) {
        var stable = Array.from(current.classList).filter(function(c) {
          return !isGeneratedClass(c);
        }).slice(0, 4);
        if (stable.length) entry.classes = stable;
      }

      var reactName = getReactComponentNameForNode(current);
      if (reactName) entry.reactComponent = reactName;

      // Position among siblings (useful for lists/tables)
      if (current.parentElement) {
        var siblings = Array.from(current.parentElement.children).filter(function(c) {
          return c.tagName === current.tagName;
        });
        if (siblings.length > 1) entry.nthOfType = siblings.indexOf(current) + 1;
      }

      breadcrumb.unshift(entry);
      current = current.parentElement;
      depth++;
    }

    return breadcrumb;
  }

  // ========================================
  // Accessibility Info
  // ========================================

  function captureAccessibilityInfo(element) {
    try {
      var inputTypes = ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'];
      var tag = element.tagName.toLowerCase();
      var result = {
        role: element.getAttribute('role') || tag,
        isFocusable: element.tabIndex >= 0 || inputTypes.indexOf(tag) !== -1,
        tabIndex: element.getAttribute('tabindex') !== null ? element.tabIndex : undefined
      };

      var ariaKeys = [
        'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-required',
        'aria-disabled', 'aria-expanded', 'aria-selected', 'aria-checked',
        'aria-hidden', 'aria-live', 'aria-atomic', 'aria-haspopup',
        'aria-invalid', 'aria-pressed', 'aria-current', 'aria-owns'
      ];
      ariaKeys.forEach(function(attr) {
        var val = element.getAttribute(attr);
        if (val !== null) result[attr] = val;
      });

      // For inputs, capture type/name/value
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        if (element.type) result.inputType = element.type;
        if (element.name) result.inputName = element.name;
        if (element.placeholder) result.placeholder = element.placeholder;
        result.hasValue = element.value ? element.value.length > 0 : false;
      }

      // For links/buttons
      if (tag === 'a' && element.href) result.href = element.getAttribute('href');
      if (tag === 'button' || tag === 'input') result.isDisabled = element.disabled;

      // Remove undefined keys
      Object.keys(result).forEach(function(k) { if (result[k] === undefined) delete result[k]; });
      return result;
    } catch(e) {
      return {};
    }
  }

  // ========================================
  // Performance Metrics
  // ========================================

  function capturePerformanceMetrics() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      var paint = {};
      performance.getEntriesByType('paint').forEach(function(entry) {
        paint[entry.name] = Math.round(entry.startTime);
      });

      var result = {};
      if (nav) {
        result.pageLoadMs = Math.round(nav.loadEventEnd - nav.fetchStart);
        result.domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd - nav.fetchStart);
        result.ttfbMs = Math.round(nav.responseStart - nav.requestStart);
        result.transferSizeBytes = nav.transferSize || undefined;
      }
      if (paint['first-paint']) result.firstPaintMs = paint['first-paint'];
      if (paint['first-contentful-paint']) result.firstContentfulPaintMs = paint['first-contentful-paint'];

      // User timing marks (e.g. app-specific milestones)
      var marks = performance.getEntriesByType('mark');
      if (marks.length) {
        result.userTimingMarks = marks.slice(-10).map(function(m) {
          return { name: m.name, time: Math.round(m.startTime) };
        });
      }

      Object.keys(result).forEach(function(k) { if (result[k] === undefined) delete result[k]; });
      return result;
    } catch(e) {
      return {};
    }
  }

  // ========================================
  // App State Detection
  // ========================================

  function detectAppState() {
    var state = {};

    // Redux — look for common store patterns
    try {
      var reduxStore = window.__REDUX_STORE__ || window.store || window.reduxStore;
      if (reduxStore && typeof reduxStore.getState === 'function') {
        var s = reduxStore.getState();
        var keys = Object.keys(s).slice(0, 12);
        var summary = {};
        keys.forEach(function(k) {
          var val = s[k];
          if (val === null || val === undefined) { summary[k] = null; }
          else if (typeof val !== 'object') { summary[k] = val; }
          else if (Array.isArray(val)) { summary[k] = '[Array(' + val.length + ')]'; }
          else { summary[k] = '{' + Object.keys(val).slice(0, 5).join(', ') + (Object.keys(val).length > 5 ? '...' : '') + '}'; }
        });
        state.redux = summary;
      }
    } catch(e) {}

    // Zustand — stores often exposed on window in dev
    try {
      var zustandKeys = Object.keys(window).filter(function(k) {
        return k.endsWith('Store') || k.endsWith('store');
      }).slice(0, 3);
      if (zustandKeys.length) {
        state.zustandStoreKeys = zustandKeys;
      }
    } catch(e) {}

    // Next.js router
    try {
      if (window.__NEXT_DATA__) {
        state.nextJs = {
          page: window.__NEXT_DATA__.page,
          query: window.__NEXT_DATA__.query,
          buildId: window.__NEXT_DATA__.buildId
        };
      }
    } catch(e) {}

    // React Router location (v5 uses window.history.state)
    try {
      if (window.history.state && window.history.state.key) {
        state.reactRouterState = window.history.state;
      }
    } catch(e) {}

    return Object.keys(state).length ? state : undefined;
  }

  // ========================================
  // Annotated Screenshot
  // ========================================

  function captureAnnotatedScreenshot(elementRect) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, function(response) {
        if (chrome.runtime.lastError || !response || !response.success || !response.dataUrl) {
          resolve(null);
          return;
        }

        var img = new Image();
        img.onload = function() {
          try {
            var scaleX = img.width / window.innerWidth;
            var scaleY = img.height / window.innerHeight;

            // Scale down to max width to save storage space
            var scale = Math.min(1, SCREENSHOT_MAX_WIDTH / img.width);
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            var rx = elementRect.left * scaleX * scale;
            var ry = elementRect.top * scaleY * scale;
            var rw = elementRect.width * scaleX * scale;
            var rh = elementRect.height * scaleY * scale;

            // Outer glow
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 8;
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 3;
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.shadowBlur = 0;

            // Semi-transparent fill
            ctx.fillStyle = 'rgba(255, 0, 0, 0.12)';
            ctx.fillRect(rx, ry, rw, rh);

            // Label badge
            var labelY = ry > 24 ? ry - 6 : ry + rh + 18;
            ctx.fillStyle = '#ff0000';
            ctx.font = 'bold 13px Arial, sans-serif';
            var labelText = '⚠ QA Issue';
            var textWidth = ctx.measureText(labelText).width;
            ctx.fillRect(rx - 1, labelY - 16, textWidth + 12, 20);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(labelText, rx + 5, labelY - 1);

            resolve(canvas.toDataURL('image/jpeg', 0.85));
          } catch(e) {
            resolve(null);
          }
        };
        img.onerror = function() { resolve(null); };
        img.src = response.dataUrl;
      });
    });
  }

  // ========================================
  // Element Dimensions & Styles
  // ========================================

  var STYLE_KEYS = [
    'display', 'position', 'visibility', 'opacity',
    'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight',
    'textAlign', 'lineHeight', 'letterSpacing',
    'padding', 'margin', 'border', 'borderRadius',
    'width', 'height', 'overflow'
  ];

  function captureComputedStyles(element) {
    try {
      var computed = window.getComputedStyle(element);
      var styles = {};
      STYLE_KEYS.forEach(function(key) {
        var val = computed[key];
        if (val && val !== 'none' && val !== 'normal' && val !== 'auto') {
          styles[key] = val;
        }
      });
      return styles;
    } catch(e) {
      return {};
    }
  }

  function captureElementDimensions(element) {
    try {
      var rect = element.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY)
      };
    } catch(e) {
      return {};
    }
  }

  // ========================================
  // Semantic Context
  // ========================================

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
    } catch(e) {
      return null;
    }
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
    } catch(e) {
      return null;
    }
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
    // Remove null keys for cleaner output
    Object.keys(context).forEach(function(k) { if (!context[k]) delete context[k]; });
    return context;
  }

  // ========================================
  // Environment & Page Context
  // ========================================

  function captureEnvironment() {
    try {
      var ua = navigator.userAgent;
      var browserName = 'Unknown';
      var browserVersion = '';

      if (/Chrome\/([0-9.]+)/.test(ua) && !/Edg\//.test(ua)) {
        browserName = 'Chrome'; browserVersion = RegExp.$1.split('.')[0];
      } else if (/Firefox\/([0-9.]+)/.test(ua)) {
        browserName = 'Firefox'; browserVersion = RegExp.$1.split('.')[0];
      } else if (/Safari\/([0-9.]+)/.test(ua) && !/Chrome/.test(ua)) {
        browserName = 'Safari'; browserVersion = RegExp.$1.split('.')[0];
      } else if (/Edg\/([0-9.]+)/.test(ua)) {
        browserName = 'Edge'; browserVersion = RegExp.$1.split('.')[0];
      }

      var os = 'Unknown';
      if (/Windows NT/.test(ua)) os = 'Windows';
      else if (/Mac OS X/.test(ua)) os = 'macOS';
      else if (/Linux/.test(ua)) os = 'Linux';
      else if (/Android/.test(ua)) os = 'Android';
      else if (/iPhone|iPad/.test(ua)) os = 'iOS';

      return {
        browser: browserName + (browserVersion ? ' ' + browserVersion : ''),
        os: os,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio || 1,
        language: navigator.language || navigator.userLanguage || 'Unknown',
        userAgent: ua
      };
    } catch(e) {
      return {};
    }
  }

  function capturePageContext() {
    try {
      var loc = window.location;
      var params = {};
      new URLSearchParams(loc.search).forEach(function(v, k) { params[k] = v; });

      var stateKeys = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          stateKeys.push(localStorage.key(i));
        }
      } catch(e) {}

      return {
        title: document.title,
        route: loc.pathname,
        hash: loc.hash || null,
        queryParams: Object.keys(params).length > 0 ? params : undefined,
        scrollPosition: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
        localStorageKeys: stateKeys.slice(0, 20)
      };
    } catch(e) {
      return {};
    }
  }

  // ========================================
  // Full Element Data Capture
  // ========================================

  function captureElementData(element) {
    var selectors = getBestSelector(element);
    var dataAttributes = {};

    DATA_ATTRIBUTES.forEach(function(attr) {
      var value = element.getAttribute(attr);
      if (value) dataAttributes[attr] = value;
    });

    var result = {
      tagName: element.tagName.toUpperCase(),
      id: element.id || null,
      classList: element.classList && element.classList.length > 0 ? Array.from(element.classList) : [],
      textContent: safeGetTextContent(element, 200),
      cssSelector: selectors.cssSelector,
      xpath: selectors.xpath,
      dataAttributes: dataAttributes,
      dimensions: captureElementDimensions(element),
      computedStyles: captureComputedStyles(element),
      semanticContext: getSemanticContext(element),
      accessibility: captureAccessibilityInfo(element),
      domBreadcrumb: getDomBreadcrumb(element)
    };

    var reactInfo = getReactComponentInfo(element);
    if (reactInfo) result.react = reactInfo;

    return result;
  }

  // ========================================
  // State Management
  // ========================================

  var isActive = false;
  var highlightOverlay = null;
  var currentHighlightedElement = null;
  var modalInstance = null;
  var isDragging = false;
  var dragOffset = { x: 0, y: 0 };

  // ========================================
  // Element Selection Mode
  // ========================================

  function createHighlightOverlay() {
    if (highlightOverlay) return;
    highlightOverlay = document.createElement('div');
    highlightOverlay.style.cssText = 'position: absolute; pointer-events: none; border: 2px solid #ff4444; background: rgba(255, 68, 68, 0.1); box-sizing: border-box; z-index: 2147483646; transition: all 0.1s ease-out; display: none;';
    document.body.appendChild(highlightOverlay);
  }

  function removeHighlightOverlay() {
    if (highlightOverlay) { highlightOverlay.remove(); highlightOverlay = null; }
  }

  function highlightElement(element) {
    if (!highlightOverlay || !element) return;
    var rect = element.getBoundingClientRect();
    highlightOverlay.style.display = 'block';
    highlightOverlay.style.top = (rect.top + window.scrollY) + 'px';
    highlightOverlay.style.left = (rect.left + window.scrollX) + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
  }

  function hideHighlight() {
    if (highlightOverlay) highlightOverlay.style.display = 'none';
  }

  function isInternalElement(element) {
    if (!element || !element.classList) return false;
    return (
      element.classList.contains('qa-reporter-highlight-overlay') ||
      element.classList.contains('qa-reporter-modal') ||
      element.closest('.qa-reporter-modal') !== null ||
      element.closest('.qa-reporter-modal-overlay') !== null
    );
  }

  function addActiveIndicator() {
    if (document.querySelector('.qa-reporter-active-indicator')) return;
    var indicator = document.createElement('div');
    indicator.className = 'qa-reporter-active-indicator';
    indicator.innerHTML = '<div class="qa-indicator-content"><span class="qa-indicator-dot"></span><span>QA Reporter Active - Click an element to report an issue</span><button class="qa-indicator-close" aria-label="Cancel selection">&times;</button></div>';
    indicator.addEventListener('click', function(e) {
      if (e.target.classList.contains('qa-indicator-close')) stopSelectionMode();
    });
    document.body.appendChild(indicator);
  }

  function removeActiveIndicator() {
    var indicator = document.querySelector('.qa-reporter-active-indicator');
    if (indicator) indicator.remove();
  }

  function handleMouseOver(e) {
    if (!isActive) return;
    var element = e.target;
    if (isInternalElement(element) || element === highlightOverlay) return;
    currentHighlightedElement = element;
    highlightElement(element);
  }

  function handleMouseOut(e) {
    if (!isActive) return;
    if (e.target === currentHighlightedElement) {
      hideHighlight();
      currentHighlightedElement = null;
    }
  }

  function handleClick(e, onElementSelected) {
    if (!isActive) return;
    var element = e.target;
    if (isInternalElement(element)) return;
    preventDefaultAndStop(e);
    stopSelectionMode();
    var elementData = captureElementData(element);
    if (onElementSelected) onElementSelected(element, elementData);
  }

  function startSelectionMode(onElementSelected) {
    if (isActive) return;
    isActive = true;
    createHighlightOverlay();
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', function(e) { handleClick(e, onElementSelected); }, true);
    document.body.style.cursor = 'crosshair';
    addActiveIndicator();
    window._qaReporterOnElementSelected = onElementSelected;
  }

  function stopSelectionMode() {
    if (!isActive) return;
    isActive = false;
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    removeHighlightOverlay();
    document.body.style.cursor = '';
    removeActiveIndicator();
    currentHighlightedElement = null;
  }

  // ========================================
  // Modal
  // ========================================

  function removeModal() {
    if (modalInstance && modalInstance.overlay) {
      modalInstance.overlay.remove();
      modalInstance = null;
    }
  }

  function isModalOpen() {
    return modalInstance !== null;
  }

  function positionModal(modal, selectedElement) {
    var rect = selectedElement.getBoundingClientRect();
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;

    var left = rect.right + 20;
    var top = rect.top + window.scrollY;

    if (left + 400 > viewportWidth) left = rect.left - 420;
    if (left < 20) {
      left = (viewportWidth - 400) / 2;
      top = rect.bottom + window.scrollY + 20;
    }
    if (top + 500 > viewportHeight + window.scrollY) top = viewportHeight + window.scrollY - 520;

    modal.style.left = Math.max(20, Math.min(left, viewportWidth - 420)) + 'px';
    modal.style.top = Math.max(20, top) + 'px';
  }

  function buildModalContent(elementData) {
    var maxText = elementData.textContent
      ? elementData.textContent.substring(0, 50) + (elementData.textContent.length > 50 ? '...' : '')
      : '';

    var dataAttributesHtml = '';
    if (elementData.dataAttributes) {
      Object.entries(elementData.dataAttributes).forEach(function(entry) {
        dataAttributesHtml += '<div class="qa-detail-item"><span class="qa-detail-label">' + entry[0] + ':</span><code>' + escapeHtml(entry[1]) + '</code></div>';
      });
    }

    var classListHtml = elementData.classList && elementData.classList.length > 0
      ? '<div class="qa-detail-item"><span class="qa-detail-label">Classes:</span><code>' + escapeHtml(elementData.classList.join(', ')) + '</code></div>'
      : '';

    var idHtml = elementData.id
      ? '<div class="qa-detail-item"><span class="qa-detail-label">ID:</span><code>' + escapeHtml(elementData.id) + '</code></div>'
      : '';

    var reactHtml = '';
    if (elementData.react) {
      reactHtml = '<div class="qa-detail-item"><span class="qa-detail-label">Component:</span><code>' + escapeHtml(elementData.react.componentName || '') + '</code></div>' +
        '<div class="qa-detail-item"><span class="qa-detail-label">Tree:</span><code>' + escapeHtml(elementData.react.componentTree.join(' > ')) + '</code></div>';
    }

    var semanticHtml = '';
    if (elementData.semanticContext) {
      var ctx = elementData.semanticContext;
      if (ctx.columnHeader) semanticHtml += '<div class="qa-detail-item"><span class="qa-detail-label">Column:</span><code>' + escapeHtml(ctx.columnHeader) + '</code></div>';
      if (ctx.nearestLabel) semanticHtml += '<div class="qa-detail-item"><span class="qa-detail-label">Label:</span><code>' + escapeHtml(ctx.nearestLabel) + '</code></div>';
    }

    return '<div class="qa-modal-header">' +
      '<h2 id="qa-reporter-modal-title" class="qa-modal-title">Report Issue</h2>' +
      '<button class="qa-modal-close" aria-label="Close modal">&times;</button>' +
    '</div>' +
    '<div class="qa-modal-element-info">' +
      '<span class="qa-element-tag">' + elementData.tagName + '</span>' +
      '<span class="qa-element-text" title="' + escapeHtml(elementData.textContent || '') + '">' + escapeHtml(maxText) + '</span>' +
    '</div>' +
    '<div class="qa-modal-body">' +
      '<div class="qa-form-group">' +
        '<label for="qa-title-input" class="qa-form-label">Issue Title *</label>' +
        '<input type="text" id="qa-title-input" class="qa-form-input" placeholder="Enter issue title" required />' +
      '</div>' +
      '<div class="qa-form-group">' +
        '<label for="qa-description-input" class="qa-form-label">Issue Description</label>' +
        '<textarea id="qa-description-input" class="qa-form-textarea" placeholder="Describe the issue" rows="4"></textarea>' +
      '</div>' +
      '<div class="qa-form-group">' +
        '<label for="qa-severity-select" class="qa-form-label">Severity</label>' +
        '<select id="qa-severity-select" class="qa-form-select">' +
          '<option value="' + SEVERITY_LEVELS.LOW + '">Low</option>' +
          '<option value="' + SEVERITY_LEVELS.MEDIUM + '" selected>Medium</option>' +
          '<option value="' + SEVERITY_LEVELS.HIGH + '">High</option>' +
          '<option value="' + SEVERITY_LEVELS.CRITICAL + '">Critical</option>' +
        '</select>' +
      '</div>' +
      '<div class="qa-element-details">' +
        '<details>' +
          '<summary class="qa-details-summary">Element Details</summary>' +
          '<div class="qa-details-content">' +
            '<div class="qa-detail-item"><span class="qa-detail-label">Tag:</span><code>' + elementData.tagName + '</code></div>' +
            idHtml +
            classListHtml +
            semanticHtml +
            '<div class="qa-detail-item"><span class="qa-detail-label">CSS Selector:</span><code class="qa-selector">' + escapeHtml(elementData.cssSelector) + '</code></div>' +
            '<div class="qa-detail-item"><span class="qa-detail-label">XPath:</span><code class="qa-selector">' + escapeHtml(elementData.xpath) + '</code></div>' +
            reactHtml +
            dataAttributesHtml +
          '</div>' +
        '</details>' +
      '</div>' +
    '</div>' +
    '<div class="qa-modal-footer">' +
      '<button class="qa-btn qa-btn-secondary qa-cancel-btn">Cancel</button>' +
      '<button class="qa-btn qa-btn-primary qa-save-btn">Save Issue</button>' +
    '</div>';
  }

  function createIssueModal(selectedElement, elementData, onSave, onClose) {
    removeModal();

    var overlay = document.createElement('div');
    overlay.className = 'qa-reporter-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'qa-reporter-modal-title');

    var modal = document.createElement('div');
    modal.className = 'qa-reporter-modal';

    positionModal(modal, selectedElement);
    modal.innerHTML = buildModalContent(elementData);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modalInstance = { overlay: overlay, modal: modal };

    var closeBtn = modal.querySelector('.qa-modal-close');
    var cancelBtn = modal.querySelector('.qa-cancel-btn');
    var saveBtn = modal.querySelector('.qa-save-btn');
    var titleInput = modal.querySelector('#qa-title-input');
    var descInput = modal.querySelector('#qa-description-input');
    var severitySelect = modal.querySelector('#qa-severity-select');
    var header = modal.querySelector('.qa-modal-header');

    header.addEventListener('mousedown', function(e) {
      if (e.target.classList.contains('qa-modal-close')) return;
      isDragging = true;
      var rect = modal.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;

      var moveHandler = function(e) {
        if (!isDragging) return;
        modal.style.left = Math.max(0, e.clientX - dragOffset.x) + 'px';
        modal.style.top = Math.max(0, e.clientY - dragOffset.y + window.scrollY) + 'px';
      };
      var upHandler = function() {
        isDragging = false;
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
    });

    saveBtn.addEventListener('click', function() {
      var title = titleInput.value.trim();
      if (!title) {
        titleInput.classList.add('qa-input-error');
        titleInput.focus();
        return;
      }

      var issueData = {
        id: generateUUID(),
        title: title,
        description: descInput.value.trim(),
        severity: severitySelect.value,
        url: window.location.href,
        timestamp: getTimestamp(),
        element: elementData,
        environment: captureEnvironment(),
        pageContext: capturePageContext(),
        recentConsoleErrors: _consoleBuffer.slice(),
        recentNetworkRequests: _networkBuffer.slice()
      };

      onSave(issueData);
      removeModal();
    });

    cancelBtn.addEventListener('click', function() { removeModal(); if (onClose) onClose(); });
    closeBtn.addEventListener('click', function() { removeModal(); if (onClose) onClose(); });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { removeModal(); if (onClose) onClose(); }
    });

    var escHandler = function(e) {
      if (e.key === 'Escape') {
        removeModal();
        document.removeEventListener('keydown', escHandler);
        if (onClose) onClose();
      }
    };
    document.addEventListener('keydown', escHandler);

    setTimeout(function() { if (titleInput) titleInput.focus(); }, 100);
  }

  // ========================================
  // Notifications
  // ========================================

  function showNotification(message, type) {
    type = type || 'success';
    var existing = document.querySelector('.qa-reporter-notification');
    if (existing) existing.remove();

    var notification = document.createElement('div');
    notification.className = 'qa-reporter-notification qa-notification-' + type;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(function() {
      if (notification.parentElement) {
        notification.classList.add('qa-notification-fade-out');
        setTimeout(function() { notification.remove(); }, 300);
      }
    }, 3000);
  }

  // ========================================
  // Storage Operations
  // ========================================

  function saveIssueToStorage(issueData) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(
        { type: MESSAGE_TYPES.SAVE_ISSUE, data: issueData },
        function(response) {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        }
      );
    });
  }

  function getIssueCount() {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage(
        { type: MESSAGE_TYPES.GET_ISSUE_COUNT },
        function(response) { resolve(response && response.success ? response.count : 0); }
      );
    });
  }

  // ========================================
  // Main Logic
  // ========================================

  async function handleElementSelected(element, elementData) {
    // Capture screenshot while the element is still visible on screen (before modal covers it)
    var rect = element.getBoundingClientRect();
    _pendingScreenshot = await captureAnnotatedScreenshot(rect);
    createIssueModal(element, elementData, handleSaveIssue, handleModalClose);
  }

  async function handleSaveIssue(issueData) {
    try {
      // Attach screenshot and page-level context at save time
      if (_pendingScreenshot) {
        issueData.screenshot = _pendingScreenshot;
        _pendingScreenshot = null;
      }
      issueData.navigationHistory = _navigationHistory.slice();
      issueData.performanceMetrics = capturePerformanceMetrics();
      issueData.appState = detectAppState();

      await saveIssueToStorage(issueData);
      showNotification('Issue saved successfully!', 'success');
      setTimeout(async function() {
        if (await isReportingModeEnabled()) startSelectionMode(handleElementSelected);
      }, 500);
    } catch(error) {
      console.error('Failed to save issue:', error);
      showNotification('Failed to save issue. Please try again.', 'error');
    }
  }

  async function handleModalClose() {
    if (await isReportingModeEnabled()) startSelectionMode(handleElementSelected);
  }

  function isReportingModeEnabled() {
    return new Promise(function(resolve) {
      chrome.storage.local.get([STORAGE_KEYS.REPORTING_MODE], function(result) {
        resolve(result[STORAGE_KEYS.REPORTING_MODE] === true);
      });
    });
  }

  function enableReportingMode() {
    if (isModalOpen()) removeModal();
    chrome.storage.local.set({ qa_reporter_mode: true });
    startSelectionMode(handleElementSelected);
  }

  function disableReportingMode() {
    chrome.storage.local.set({ qa_reporter_mode: false });
    stopSelectionMode();
    removeModal();
  }

  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case MESSAGE_TYPES.START_REPORTING:
        enableReportingMode();
        sendResponse({ success: true });
        break;
      case MESSAGE_TYPES.STOP_REPORTING:
        disableReportingMode();
        sendResponse({ success: true });
        break;
      case MESSAGE_TYPES.GET_ISSUE_COUNT:
        getIssueCount().then(function(count) { sendResponse({ success: true, count: count }); });
        break;
      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
    return true;
  }

  async function restoreReportingState() {
    var isEnabled = await isReportingModeEnabled();
    if (isEnabled && !isModalOpen()) startSelectionMode(handleElementSelected);
  }

  function init() {
    setupConsoleInterceptor();
    setupNetworkInterceptor();
    setupNavigationTracker();
    chrome.runtime.onMessage.addListener(handleMessage);
    restoreReportingState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
