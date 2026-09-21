// Comprehensive tests for Live DOM TreeWalker Smart Blur ported from Mimik
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createDOM } = require('./test-dom-helper');

// Extract Smart Blur logic directly for isolated testing
const SMART_BLUR_PRESETS = {
  email:      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  ssn:        /\b\d{3}-?\d{2}-?\d{4}\b/g,
  creditCard: /\b(?:\d[ -]*?){13,19}\b/g,
  phone:      /(?:\+\d{1,3}[\s.-]?\d{2,5}[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b0\d{1,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}|\b\d{10,11})\b/g,
  ipAddress:  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
};

const SMART_BLUR_EXCLUDE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

function findTextMatches(text, patterns) {
  const ranges = [];
  for (let i = 0; i < patterns.length; i++) {
    let pat = patterns[i];
    if (!pat.global) pat = new RegExp(pat.source, pat.flags + 'g');
    pat.lastIndex = 0;
    let match = pat.exec(text);
    while (match !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      match = pat.exec(text);
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (let j = 0; j < ranges.length; j++) {
    const r = ranges[j];
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

function applySmartBlur(root, doc) {
  const document = doc || root.ownerDocument;
  const patterns = Object.values(SMART_BLUR_PRESETS).map(p => new RegExp(p.source, p.flags));

  const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode: (node) => {
      if (!node.parentElement) return 2 /* FILTER_REJECT */;
      if (SMART_BLUR_EXCLUDE.has(node.parentElement.tagName)) return 2 /* FILTER_REJECT */;
      if (node.parentElement.closest && node.parentElement.closest('[data-qa-blur]')) return 2 /* FILTER_REJECT */;
      if (!node.textContent || !node.textContent.trim()) return 2 /* FILTER_REJECT */;
      return 1 /* FILTER_ACCEPT */;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (let i = 0; i < textNodes.length; i++) {
    const tNode = textNodes[i];
    const text = tNode.textContent || '';
    const matches = findTextMatches(text, patterns);
    if (matches.length === 0) continue;

    const frag = document.createDocumentFragment();
    let lastEnd = 0;
    for (let m = 0; m < matches.length; m++) {
      const range = matches[m];
      if (range.start > lastEnd) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd, range.start)));
      }
      const span = document.createElement('span');
      span.className = 'qa-smart-blur';
      span.setAttribute('data-qa-blur', 'regex');
      span.style.setProperty('filter', 'blur(10px)');
      span.style.setProperty('display', 'inline-block');
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

  const inputs = Array.from(root.querySelectorAll ? root.querySelectorAll('input, textarea') : []);
  for (let k = 0; k < inputs.length; k++) {
    const inp = inputs[k];
    if (inp.getAttribute && inp.getAttribute('data-qa-blur')) continue;
    const val = inp.value;
    if (!val) continue;
    if (findTextMatches(val, patterns).length > 0) {
      inp.style.setProperty('filter', 'blur(10px)');
      inp.setAttribute('data-qa-blur', 'input');
    }
  }

  return function unblur() {
    const spans = Array.from(root.querySelectorAll ? root.querySelectorAll('span[data-qa-blur="regex"]') : []);
    for (let s = 0; s < spans.length; s++) {
      const sp = spans[s];
      const txt = document.createTextNode(sp.textContent || '');
      const parent = sp.parentNode;
      if (parent) {
        parent.replaceChild(txt, sp);
        if (parent.normalize) parent.normalize();
      }
    }
    const blurredInputs = Array.from(root.querySelectorAll ? root.querySelectorAll('[data-qa-blur="input"]') : []);
    for (let b = 0; b < blurredInputs.length; b++) {
      blurredInputs[b].style.removeProperty('filter');
      blurredInputs[b].removeAttribute('data-qa-blur');
    }
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('smart blur: regex matches valid emails and ignores non-emails', () => {
  const patterns = [new RegExp(SMART_BLUR_PRESETS.email.source, SMART_BLUR_PRESETS.email.flags)];
  const text = 'Contact john.doe@company.org or support+qa@sub.example.co.uk for help.';
  const matches = findTextMatches(text, patterns);
  assert.strictEqual(matches.length, 2);
  assert.strictEqual(text.slice(matches[0].start, matches[0].end), 'john.doe@company.org');
  assert.strictEqual(text.slice(matches[1].start, matches[1].end), 'support+qa@sub.example.co.uk');

  const cleanText = 'This text has no emails at all.';
  assert.strictEqual(findTextMatches(cleanText, patterns).length, 0);
});

test('smart blur: regex matches SSNs and Credit Cards', () => {
  const ssnPat = [new RegExp(SMART_BLUR_PRESETS.ssn.source, SMART_BLUR_PRESETS.ssn.flags)];
  const ccPat  = [new RegExp(SMART_BLUR_PRESETS.creditCard.source, SMART_BLUR_PRESETS.creditCard.flags)];

  const ssnText = 'User SSN is 123-45-6789 confidential.';
  const ssnMatches = findTextMatches(ssnText, ssnPat);
  assert.strictEqual(ssnMatches.length, 1);
  assert.strictEqual(ssnText.slice(ssnMatches[0].start, ssnMatches[0].end), '123-45-6789');

  const ccText = 'Card number: 4532 0150 1234 5678 expiring soon.';
  const ccMatches = findTextMatches(ccText, ccPat);
  assert.strictEqual(ccMatches.length, 1);
  assert.strictEqual(ccText.slice(ccMatches[0].start, ccMatches[0].end), '4532 0150 1234 5678');
});

test('smart blur: regex matches IP addresses and Phone Numbers', () => {
  const ipPat = [new RegExp(SMART_BLUR_PRESETS.ipAddress.source, SMART_BLUR_PRESETS.ipAddress.flags)];
  const phPat = [new RegExp(SMART_BLUR_PRESETS.phone.source, SMART_BLUR_PRESETS.phone.flags)];

  const ipText = 'Server IP: 192.168.1.254 and DNS: 8.8.8.8';
  const ipMatches = findTextMatches(ipText, ipPat);
  assert.strictEqual(ipMatches.length, 2);
  assert.strictEqual(ipText.slice(ipMatches[0].start, ipMatches[0].end), '192.168.1.254');
  assert.strictEqual(ipText.slice(ipMatches[1].start, ipMatches[1].end), '8.8.8.8');

  const phText = 'Call support at +1-800-555-0199 or (555) 234-5678 today.';
  const phMatches = findTextMatches(phText, phPat);
  assert.ok(phMatches.length >= 1);
});

test('smart blur: findTextMatches merges overlapping / adjacent ranges', () => {
  const patterns = [
    /test\d+/g,
    /\d+extra/g
  ];
  const text = 'prefix test123extra suffix';
  const matches = findTextMatches(text, patterns);
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(text.slice(matches[0].start, matches[0].end), 'test123extra');
});

test('smart blur: redacts live DOM text nodes with blurred spans and unblurs cleanly', () => {
  const { document } = createDOM();
  const p = document.createElement('p');
  p.textContent = 'Account holder john@company.com with IP 10.0.0.1 recorded.';
  document.body.appendChild(p);

  const unblur = applySmartBlur(document.body, document);

  // Check blurred spans were created
  const spans = document.body.querySelectorAll('span[data-qa-blur="regex"]');
  assert.strictEqual(spans.length, 2);
  assert.strictEqual(spans[0].textContent, 'john@company.com');
  assert.strictEqual(spans[0].style.filter, 'blur(10px)');
  assert.strictEqual(spans[1].textContent, '10.0.0.1');

  // Verify unblur restores original text and structure
  unblur();
  const spansAfter = document.body.querySelectorAll('span[data-qa-blur="regex"]');
  assert.strictEqual(spansAfter.length, 0);
  assert.strictEqual(p.textContent, 'Account holder john@company.com with IP 10.0.0.1 recorded.');
});

test('smart blur: blurs input fields containing sensitive values and restores them', () => {
  const { document } = createDOM();
  const input = document.createElement('input');
  input.value = 'user@bank.com';
  document.body.appendChild(input);

  const unblur = applySmartBlur(document.body, document);
  assert.strictEqual(input.getAttribute('data-qa-blur'), 'input');
  assert.strictEqual(input.style.filter, 'blur(10px)');

  unblur();
  assert.strictEqual(input.getAttribute('data-qa-blur'), null);
  assert.strictEqual(input.style.filter, '');
});

test('smart blur: excludes script and style tags from redaction', () => {
  const { document } = createDOM();
  const script = document.createElement('script');
  script.textContent = 'var email = "admin@internal.system";';
  document.body.appendChild(script);

  const unblur = applySmartBlur(document.body, document);
  const spans = document.body.querySelectorAll('span[data-qa-blur="regex"]');
  assert.strictEqual(spans.length, 0);
  unblur();
});

test('smart blur: findTextMatches safely handles non-global regexes without infinite loop', () => {
  // Non-global regex (missing 'g' flag)
  const nonGlobalPat = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
  assert.strictEqual(nonGlobalPat.global, false, 'Pattern must be non-global for this test');

  const text = 'Primary: user1@example.com, Secondary: user2@sample.org';
  const matches = findTextMatches(text, [nonGlobalPat]);

  assert.strictEqual(matches.length, 2, 'Must match all occurrences even when regex lacks g flag');
  assert.strictEqual(text.slice(matches[0].start, matches[0].end), 'user1@example.com');
  assert.strictEqual(text.slice(matches[1].start, matches[1].end), 'user2@sample.org');
});

test('smart blur: content.js findTextMatches contains global flag guard and unblur fallback timer', () => {
  const fs = require('fs');
  const path = require('path');
  const contentJs = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

  // Verify findTextMatches guards against non-global regexes
  assert.match(
    contentJs,
    /if\s*\(!pat\.global\)\s*pat\s*=\s*new\s*RegExp\(pat\.source,\s*pat\.flags\s*\+\s*["']g["']\);/,
    'content.js must ensure each regex has the g flag to prevent infinite loops'
  );

  // Verify fallback timer for unblur exists (2500ms)
  assert.match(
    contentJs,
    /var\s+unblurTimer\s*=\s*setTimeout\(function\s*\(\)\s*\{[\s\S]*?unblur\(\);[\s\S]*?2500\);/,
    'content.js must have a 2500ms unblurTimer safety fallback'
  );

  // Verify clearTimeout(unblurTimer) is called in the response callback
  assert.match(
    contentJs,
    /clearTimeout\(unblurTimer\);/,
    'content.js must clearTimeout(unblurTimer) in screenshot capture callback'
  );
});
