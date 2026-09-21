/**
 * Finder — Shortest unique CSS selector generator (1.1KB)
 * Adapted from Anton Medvedev (MIT License)
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    var exp = factory();
    module.exports = exp.finder;
    module.exports.finder = exp.finder;
  } else {
    var exp = factory();
    root.finder = exp.finder;
  }
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function safeEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return String(value).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  function finder(input, options) {
    if (!input || input.nodeType !== 1) {
      throw new Error('Can not find selector for non-element node.');
    }

    var tagName = input.tagName ? input.tagName.toLowerCase() : '';
    if (tagName === 'html') return 'html';
    if (tagName === 'body') return 'body';

    var doc = input.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var defaultRoot = (doc && doc.body) ? doc.body : (input.parentElement || input);

    var defaults = {
      root: defaultRoot,
      idName: function () { return true; },
      className: function () { return true; },
      tagName: function () { return true; },
      attr: function () { return false; },
      seedMinLength: 1,
      optimizedMinLength: 2,
      threshold: 1,
      maxNumberOfTries: 1000
    };

    var config = Object.assign({}, defaults, options || {});
    var root = config.root || defaultRoot;

    function isUnique(selector) {
      if (!selector) return false;
      try {
        return root.querySelectorAll(selector).length === 1;
      } catch (_) {
        return false;
      }
    }

    // Candidate selectors for a single element
    function getCandidates(el) {
      var candidates = [];

      // 1. ID selector
      if (el.id && config.idName(el.id)) {
        var idSel = '#' + safeEscape(el.id);
        candidates.push(idSel);
      }

      // 2. Attribute selectors
      if (el.attributes && el.attributes.length > 0) {
        for (var i = 0; i < el.attributes.length; i++) {
          var attr = el.attributes[i];
          if (config.attr(attr.name, attr.value)) {
            candidates.push('[' + safeEscape(attr.name) + '="' + safeEscape(attr.value) + '"]');
          }
        }
      }

      // 3. Class selectors
      if (el.classList && el.classList.length > 0) {
        var classArr = Array.from(el.classList);
        var validClasses = [];
        for (var c = 0; c < classArr.length; c++) {
          var cls = classArr[c];
          if (cls && config.className(cls)) {
            validClasses.push(cls);
            candidates.push('.' + safeEscape(cls));
          }
        }
        if (validClasses.length > 1) {
          var fullClass = '.' + validClasses.map(safeEscape).join('.');
          candidates.push(fullClass);
        }
      }

      // 4. Tag name selector
      var tag = el.tagName ? el.tagName.toLowerCase() : '*';
      if (config.tagName(tag)) {
        candidates.push(tag);
      }

      // 5. nth-of-type / nth-child if siblings exist
      var parent = el.parentElement;
      if (parent && parent.children) {
        var siblings = Array.from(parent.children).filter(function (s) {
          return s.tagName === el.tagName;
        });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(el) + 1;
          candidates.push(tag + ':nth-of-type(' + idx + ')');
        }
      }

      return candidates;
    }

    // Check if input element itself has a unique candidate
    var selfCandidates = getCandidates(input);
    for (var s = 0; s < selfCandidates.length; s++) {
      if (isUnique(selfCandidates[s])) {
        return selfCandidates[s];
      }
    }

    // Traverse upwards and build path combinations
    var elements = [];
    var curr = input;
    while (curr && curr !== root && curr.nodeType === 1) {
      elements.push(curr);
      curr = curr.parentElement;
    }

    // Try combining candidate selectors from input upwards
    var path = [];
    for (var e = 0; e < elements.length; e++) {
      var candidates = getCandidates(elements[e]);
      var chosen = candidates[0] || (elements[e].tagName ? elements[e].tagName.toLowerCase() : '*');
      path.unshift(chosen);

      var currentSelector = path.join(' > ');
      if (isUnique(currentSelector)) {
        // Optimize path by removing unnecessary prefix segments
        return optimizePath(path, root);
      }
    }

    // Fallback: full nth-of-type traversal
    var fallbackPath = [];
    curr = input;
    while (curr && curr !== root && curr !== (doc ? doc.documentElement : null)) {
      var t = curr.tagName ? curr.tagName.toLowerCase() : '*';
      var p = curr.parentElement;
      if (p && p.children) {
        var sameTag = Array.from(p.children).filter(function (c) { return c.tagName === curr.tagName; });
        if (sameTag.length > 1) {
          t += ':nth-of-type(' + (sameTag.indexOf(curr) + 1) + ')';
        }
      }
      fallbackPath.unshift(t);
      curr = p;
    }

    var fullFallback = fallbackPath.join(' > ');
    return fullFallback || (input.tagName ? input.tagName.toLowerCase() : '*');
  }

  // Optimize path by dropping intermediate ancestors if selector remains unique
  function optimizePath(path, root) {
    if (path.length <= 1) return path.join(' > ');

    var optimized = path.slice();
    for (var i = 0; i < optimized.length - 1; i++) {
      // Try removing intermediate segments
      var test = optimized.slice();
      test.splice(i, 1);
      var testSelector = test.join(' > ');
      try {
        if (root.querySelectorAll(testSelector).length === 1) {
          optimized = test;
          i--; // re-check at current index
        }
      } catch (_) {}
    }
    return optimized.join(' > ');
  }

  return { finder: finder };
}));
