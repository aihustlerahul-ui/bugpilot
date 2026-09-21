// BugPilot — Network Interceptor (MAIN World, runs at document_start)
(function () {
  'use strict';

  if (window.__bugpilotNetworkInterceptorInjected) return;
  window.__bugpilotNetworkInterceptorInjected = true;

  // ── Constants & Limits ───────────────────────────────────────────────────────
  var MAX_PAYLOAD_SIZE = 50 * 1024; // 50KB cap
  var TRUNCATION_NOTICE = '\n... [TRUNCATED - MAX 50KB]';

  var SENSITIVE_HEADERS = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-csrf-token',
    'csrf-token',
    'xsrf-token',
    'x-xsrf-token',
    'x-access-token',
    'proxy-authorization',
    'x-auth-token',
    'apikey',
    'api-key'
  ];

  var SENSITIVE_PROP_PATTERNS = [
    'password',
    'passcode',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'client_secret',
    'auth',
    'apikey',
    'api_key',
    'credit_card',
    'creditcard',
    'cardnumber',
    'cvv',
    'cvc',
    'ssn',
    'pin',
    'sessionid',
    'jwt',
    'bearer',
    'privatekey',
    'private_key'
  ];

  // ── Sanitization Engine ─────────────────────────────────────────────────────
  var RE_CREDIT_CARD   = /\b(?:\d[ -]*?){13,19}\b/g;
  var RE_EMAIL         = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  var RE_SSN           = /\b\d{3}-\d{2}-\d{4}\b/g;
  var RE_AUTH_HEADER   = /(["']?Authorization["']?\s*:\s*["']?(?:Bearer|Basic)\s+)[^"'\r\n\s]+/gi;
  var RE_COOKIE_HEADER = /(["']?Cookie["']?\s*:\s*["']?)[^"'\r\n]+/gi;
  var RE_URL_PARAMS    = /([?&](?:token|access_token|refresh_token|auth|password|pwd|secret|apikey|api_key|api-key|sessionId|jwt|client_secret|private_key|privatekey)=)([^&#\s]+)/gi;

  function isSensitiveHeader(headerName) {
    if (!headerName || typeof headerName !== 'string') return false;
    var lower = headerName.toLowerCase();
    for (var i = 0; i < SENSITIVE_HEADERS.length; i++) {
      if (lower === SENSITIVE_HEADERS[i]) return true;
    }
    return false;
  }

  function isSensitivePropKey(propKey) {
    if (!propKey || typeof propKey !== 'string') return false;
    var lower = propKey.toLowerCase();
    for (var i = 0; i < SENSITIVE_PROP_PATTERNS.length; i++) {
      if (lower.indexOf(SENSITIVE_PROP_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }

  function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(RE_CREDIT_CARD, '[REDACTED_CARD]')
      .replace(RE_EMAIL, '[REDACTED_EMAIL]')
      .replace(RE_SSN, '[REDACTED_SSN]')
      .replace(RE_AUTH_HEADER, '$1[REDACTED_AUTH]')
      .replace(RE_COOKIE_HEADER, '$1[REDACTED_COOKIE]')
      .replace(RE_URL_PARAMS, '$1[REDACTED]');
  }

  function sanitizeJsonObj(obj, depth) {
    if (depth === undefined) depth = 0;
    if (!obj || depth > 8) return obj;
    if (typeof obj === 'string') return sanitizeString(obj);
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map(function (item) {
        return sanitizeJsonObj(item, depth + 1);
      });
    }

    var result = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        if (isSensitivePropKey(k)) {
          result[k] = '[REDACTED]';
        } else {
          result[k] = sanitizeJsonObj(obj[k], depth + 1);
        }
      }
    }
    return result;
  }

  function capLength(str, maxBytes) {
    if (!str || typeof str !== 'string') return str;
    var limit = maxBytes || MAX_PAYLOAD_SIZE;
    if (str.length > limit) {
      return str.slice(0, limit) + TRUNCATION_NOTICE;
    }
    return str;
  }

  function sanitizeBody(body) {
    if (body === undefined || body === null) return null;

    try {
      if (typeof body === 'string') {
        var trimmed = body.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            var parsed = JSON.parse(body);
            var sanitizedObj = sanitizeJsonObj(parsed, 0);
            return capLength(JSON.stringify(sanitizedObj, null, 2));
          } catch (_) {
            // fallback to string sanitization if JSON parse fails
          }
        }
        var stringToSanitize = body.length > MAX_PAYLOAD_SIZE * 2 ? body.slice(0, MAX_PAYLOAD_SIZE * 2) : body;
        return capLength(sanitizeString(stringToSanitize));
      }

      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        var formObj = {};
        try {
          body.forEach(function (value, key) {
            if (isSensitivePropKey(key)) {
              formObj[key] = '[REDACTED]';
            } else if (typeof value === 'string') {
              formObj[key] = sanitizeString(value);
            } else if (value && value.name) {
              formObj[key] = '[File: ' + sanitizeString(value.name) + ' (' + (value.size || 0) + ' bytes)]';
            } else {
              formObj[key] = '[FormData value]';
            }
          });
          return capLength(JSON.stringify(formObj, null, 2));
        } catch (_) {
          return '[FormData payload]';
        }
      }

      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        var paramsObj = {};
        try {
          body.forEach(function (value, key) {
            if (isSensitivePropKey(key)) {
              paramsObj[key] = '[REDACTED]';
            } else {
              paramsObj[key] = sanitizeString(value);
            }
          });
          return capLength(JSON.stringify(paramsObj, null, 2));
        } catch (_) {
          return capLength(sanitizeString(body.toString()));
        }
      }

      if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return '[Binary Blob: ' + (body.type || 'unknown type') + ' (' + body.size + ' bytes)]';
      }

      if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
        return '[ArrayBuffer: ' + body.byteLength + ' bytes]';
      }

      if (typeof body === 'object') {
        var sanitized = sanitizeJsonObj(body, 0);
        return capLength(JSON.stringify(sanitized, null, 2));
      }

      return capLength(sanitizeString(String(body)));
    } catch (_) {
      return null;
    }
  }

  function sanitizeHeaders(headers) {
    if (!headers) return {};
    var result = {};

    try {
      if (headers && typeof headers.forEach === 'function') {
        headers.forEach(function (val, key) {
          if (key !== undefined && key !== null) {
            var k = String(key);
            result[k] = isSensitiveHeader(k) ? '[REDACTED]' : sanitizeString(String(val));
          }
        });
        return result;
      }

      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
          var pair = headers[i];
          if (Array.isArray(pair) && pair.length >= 2) {
            var k = String(pair[0]);
            var v = String(pair[1]);
            result[k] = isSensitiveHeader(k) ? '[REDACTED]' : sanitizeString(v);
          }
        }
        return result;
      }

      if (typeof headers === 'object') {
        for (var key in headers) {
          if (Object.prototype.hasOwnProperty.call(headers, key)) {
            result[key] = isSensitiveHeader(key) ? '[REDACTED]' : sanitizeString(String(headers[key]));
          }
        }
        return result;
      }
    } catch (_) {}

    return result;
  }

  function emitTransaction(tx) {
    try {
      window.postMessage({
        type: 'BUGPILOT_NETWORK_EVENT',
        payload: tx
      }, '*');
    } catch (_) {
      // Safe ignore
    }
  }

  // ── Monkey-Patch Fetch ──────────────────────────────────────────────────────
  if (typeof window.fetch === 'function') {
    var originalFetch = window.fetch;

    window.fetch = function (input, init) {
      var startTime = Date.now();
      var txId = 'tx_' + startTime + '_' + Math.random().toString(36).substr(2, 9);
      var timestamp = new Date().toISOString();

      var rawUrl = '';
      var method = 'GET';
      var rawHeaders = null;
      var rawBody = null;

      if (typeof input === 'string') {
        rawUrl = input;
      } else if (typeof URL !== 'undefined' && input instanceof URL) {
        rawUrl = input.toString();
      } else if (input && typeof input === 'object') {
        rawUrl = input.url || '';
        method = input.method || 'GET';
        rawHeaders = input.headers;
      }

      if (init) {
        if (init.method) method = init.method;
        if (init.headers) rawHeaders = init.headers;
        if (init.body !== undefined) rawBody = init.body;
      }

      var sanitizedUrl = sanitizeString(rawUrl);
      var requestHeaders = sanitizeHeaders(rawHeaders);
      var requestBody = sanitizeBody(rawBody);

      return originalFetch.apply(this, arguments).then(function (response) {
        var duration = Math.max(0, Date.now() - startTime);
        var responseHeaders = sanitizeHeaders(response.headers);
        var status = response.status;
        var statusText = response.statusText;

        try {
          var clone = response.clone();
          clone.text().then(function (text) {
            var sanitizedResponseBody = sanitizeBody(text);
            emitTransaction({
              id: txId,
              timestamp: timestamp,
              method: method.toUpperCase(),
              url: sanitizedUrl,
              status: status,
              statusText: statusText,
              duration: duration,
              requestHeaders: requestHeaders,
              requestBody: requestBody,
              responseHeaders: responseHeaders,
              responseBody: sanitizedResponseBody,
              initiator: 'fetch'
            });
          }).catch(function () {
            emitTransaction({
              id: txId,
              timestamp: timestamp,
              method: method.toUpperCase(),
              url: sanitizedUrl,
              status: status,
              statusText: statusText,
              duration: duration,
              requestHeaders: requestHeaders,
              requestBody: requestBody,
              responseHeaders: responseHeaders,
              responseBody: null,
              initiator: 'fetch'
            });
          });
        } catch (_) {
          emitTransaction({
            id: txId,
            timestamp: timestamp,
            method: method.toUpperCase(),
            url: sanitizedUrl,
            status: status,
            statusText: statusText,
            duration: duration,
            requestHeaders: requestHeaders,
            requestBody: requestBody,
            responseHeaders: responseHeaders,
            responseBody: null,
            initiator: 'fetch'
          });
        }

        return response;
      }, function (err) {
        var duration = Math.max(0, Date.now() - startTime);
        emitTransaction({
          id: txId,
          timestamp: timestamp,
          method: method.toUpperCase(),
          url: sanitizedUrl,
          status: 'failed',
          statusText: 'Failed / Network Error',
          duration: duration,
          requestHeaders: requestHeaders,
          requestBody: requestBody,
          responseHeaders: {},
          responseBody: null,
          error: err && err.message ? err.message : String(err),
          initiator: 'fetch'
        });
        throw err;
      });
    };
  }

  // ── Monkey-Patch XMLHttpRequest ─────────────────────────────────────────────
  if (typeof window.XMLHttpRequest === 'function') {
    var OriginalXHR = window.XMLHttpRequest;
    var origOpen = OriginalXHR.prototype.open;
    var origSetRequestHeader = OriginalXHR.prototype.setRequestHeader;
    var origSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function (method, url) {
      this.__bpTxId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      this.__bpMethod = (method || 'GET').toUpperCase();
      this.__bpUrl = sanitizeString(String(url || ''));
      this.__bpRequestHeaders = {};
      this.__bpHandled = false;
      return origOpen.apply(this, arguments);
    };

    OriginalXHR.prototype.setRequestHeader = function (header, value) {
      if (header && value !== undefined) {
        if (!this.__bpRequestHeaders) this.__bpRequestHeaders = {};
        var lower = String(header).toLowerCase();
        if (isSensitiveHeader(lower)) {
          this.__bpRequestHeaders[header] = '[REDACTED]';
        } else {
          this.__bpRequestHeaders[header] = sanitizeString(String(value));
        }
      }
      return origSetRequestHeader.apply(this, arguments);
    };

    OriginalXHR.prototype.send = function (body) {
      var xhr = this;
      var startTime = Date.now();
      var timestamp = new Date().toISOString();
      var requestBody = sanitizeBody(body);

      var handleEnd = function () {
        if (xhr.__bpHandled) return;
        xhr.__bpHandled = true;

        var duration = Math.max(0, Date.now() - startTime);
        var status = 0;
        var statusText = '';
        try { status = xhr.status || 0; } catch (_) {}
        try { statusText = xhr.statusText || ''; } catch (_) {}
        var responseHeaders = {};

        try {
          var rawHeaders = xhr.getAllResponseHeaders();
          if (rawHeaders) {
            var lines = rawHeaders.trim().split(/[\r\n]+/);
            lines.forEach(function (line) {
              var parts = line.split(': ');
              var key = parts.shift();
              var val = parts.join(': ');
              if (key) {
                responseHeaders[key] = isSensitiveHeader(key) ? '[REDACTED]' : sanitizeString(val);
              }
            });
          }
        } catch (_) {}

        var responseBody = null;
        try {
          if (!xhr.responseType || xhr.responseType === 'text') {
            responseBody = sanitizeBody(xhr.responseText);
          } else if (xhr.responseType === 'json') {
            responseBody = sanitizeBody(xhr.response);
          } else {
            responseBody = '[Binary data: ' + xhr.responseType + ']';
          }
        } catch (_) {
          responseBody = null;
        }

        emitTransaction({
          id: xhr.__bpTxId || ('tx_' + Date.now()),
          timestamp: timestamp,
          method: xhr.__bpMethod || 'GET',
          url: xhr.__bpUrl || '',
          status: status === 0 ? 'failed' : status,
          statusText: statusText,
          duration: duration,
          requestHeaders: xhr.__bpRequestHeaders || {},
          requestBody: requestBody,
          responseHeaders: responseHeaders,
          responseBody: responseBody,
          initiator: 'xhr'
        });
      };

      xhr.addEventListener('loadend', handleEnd);
      xhr.addEventListener('error', handleEnd);
      xhr.addEventListener('abort', handleEnd);
      xhr.addEventListener('readystatechange', function () {
        if (xhr.readyState === 4) handleEnd();
      });

      return origSend.apply(this, arguments);
    };
  }

  // ── Early Global Error & Promise Rejection Interception (MAIN World) ───────
  function emitConsoleEvent(payload) {
    try {
      window.postMessage({
        type: 'BUGPILOT_CONSOLE_EVENT',
        payload: payload
      }, '*');
    } catch (_) {
      // Safe ignore
    }
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('error', function (event) {
      try {
        var errText = (event && event.message) || 'Script error';
        if (event && event.filename) {
          errText += ' (' + event.filename + (event.lineno ? ':' + event.lineno : '') + (event.colno ? ':' + event.colno : '') + ')';
        }
        if (event && event.error && event.error.stack) {
          errText += '\n' + event.error.stack;
        }
        var sanitized = sanitizeString(errText);
        emitConsoleEvent({
          level: 'error',
          message: sanitized,
          timestamp: new Date().toISOString()
        });
      } catch (_) {}
    });

    window.addEventListener('unhandledrejection', function (event) {
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
        var sanitized = sanitizeString(fullMsg);
        emitConsoleEvent({
          level: 'error',
          message: sanitized,
          timestamp: new Date().toISOString()
        });
      } catch (_) {}
    });
  }
})();
