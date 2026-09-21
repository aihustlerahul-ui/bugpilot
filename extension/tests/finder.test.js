// Comprehensive tests for Anton Medvedev finder & CSS selector generation
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createDOM } = require('./test-dom-helper');
const { finder } = require('../finder');

test('finder: generates unique ID selector when element has ID', () => {
  const { document } = createDOM();
  const btn = document.createElement('button');
  btn.id = 'login-btn';
  document.body.appendChild(btn);

  const sel = finder(btn, { root: document.body });
  assert.strictEqual(sel, '#login-btn');
  assert.strictEqual(document.body.querySelectorAll(sel).length, 1);
});

test('finder: generates unique attribute selector for data-testid', () => {
  const { document } = createDOM();
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'hero-header');
  document.body.appendChild(div);

  const sel = finder(div, {
    root: document.body,
    attr: (name) => name === 'data-testid'
  });
  assert.strictEqual(sel, '[data-testid="hero-header"]');
  assert.strictEqual(document.body.querySelectorAll(sel).length, 1);
});

test('finder: generates unique class selector', () => {
  const { document } = createDOM();
  const p1 = document.createElement('p');
  p1.classList.add('lead-paragraph');
  document.body.appendChild(p1);

  const p2 = document.createElement('p');
  document.body.appendChild(p2);

  const sel = finder(p1, { root: document.body });
  assert.strictEqual(sel, '.lead-paragraph');
  assert.strictEqual(document.body.querySelectorAll(sel).length, 1);
});

test('finder: resolves nested element with combination path', () => {
  const { document } = createDOM();
  const section = document.createElement('section');
  section.id = 'pricing';
  const card = document.createElement('div');
  card.classList.add('card');
  const btn = document.createElement('button');
  card.appendChild(btn);
  section.appendChild(card);
  document.body.appendChild(section);

  const sel = finder(btn, { root: document.body });
  assert.ok(sel.includes('#pricing') || sel.includes('.card') || sel.includes('button'));
  assert.strictEqual(document.body.querySelectorAll(sel).length, 1);
});

test('finder: distinguishes siblings with nth-of-type', () => {
  const { document } = createDOM();
  const ul = document.createElement('ul');
  ul.id = 'items';
  const li1 = document.createElement('li');
  const li2 = document.createElement('li');
  const li3 = document.createElement('li');
  ul.appendChild(li1);
  ul.appendChild(li2);
  ul.appendChild(li3);
  document.body.appendChild(ul);

  const sel2 = finder(li2, { root: document.body });
  assert.ok(sel2.includes('li:nth-of-type(2)'));
  assert.strictEqual(document.body.querySelectorAll(sel2).length, 1);
});

test('finder: handles root elements (html, body)', () => {
  const { document } = createDOM();
  assert.strictEqual(finder(document.documentElement), 'html');
  assert.strictEqual(finder(document.body), 'body');
});

test('finder: throws on invalid non-element input', () => {
  assert.throws(() => {
    finder(null);
  }, /Can not find selector for non-element node/);

  assert.throws(() => {
    finder({ nodeType: 3 });
  }, /Can not find selector for non-element node/);
});

test('finder: ignores dynamic / generated classes when configured', () => {
  const { document } = createDOM();
  const div = document.createElement('div');
  div.id = 'stable-container';
  const span = document.createElement('span');
  span.classList.add('sc-12345'); // styled-components hash
  span.classList.add('badge');
  div.appendChild(span);
  document.body.appendChild(div);

  const sel = finder(span, {
    root: document.body,
    className: (cls) => !cls.startsWith('sc-')
  });
  assert.ok(!sel.includes('sc-12345'));
  assert.ok(sel.includes('.badge'));
});
