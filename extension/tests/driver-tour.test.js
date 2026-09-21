// Unit tests for Driver.js Tour & Spotlight Engine in Chrome Extension
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createDOM, TestElement } = require('./test-dom-helper');
const { driver } = require('../driver');

function setupTestEnvironment() {
  const dom = createDOM();
  const doc = dom.document;

  // Add getBoundingClientRect stub
  TestElement.prototype.getBoundingClientRect = function () {
    return {
      top: 100,
      left: 50,
      width: 200,
      height: 40,
      bottom: 140,
      right: 250,
      x: 50,
      y: 100
    };
  };

  TestElement.prototype.scrollIntoView = function () {};

  // Mock global DOM environment
  global.document = doc;
  global.window = dom.window;
  global.window.innerWidth = 1024;
  global.window.innerHeight = 768;
  global.window.addEventListener = (evt, fn) => {
    global.window[`_on_${evt}`] = fn;
  };
  global.window.removeEventListener = (evt) => {
    delete global.window[`_on_${evt}`];
  };

  return { dom, doc };
}

test('driver: initializes correctly and returns instance API', () => {
  setupTestEnvironment();
  const d = driver({ steps: [] });

  assert.strictEqual(typeof d.drive, 'function');
  assert.strictEqual(typeof d.moveNext, 'function');
  assert.strictEqual(typeof d.movePrevious, 'function');
  assert.strictEqual(typeof d.destroy, 'function');
  assert.strictEqual(typeof d.hasNextStep, 'function');
  assert.strictEqual(typeof d.hasPreviousStep, 'function');
  assert.strictEqual(typeof d.getActiveIndex, 'function');
  assert.strictEqual(d.getActiveIndex(), -1);
});

test('driver: drives through step sequence and updates active index', () => {
  const { doc } = setupTestEnvironment();

  const el1 = doc.createElement('button');
  el1.id = 'project-select';
  doc.body.appendChild(el1);

  const el2 = doc.createElement('button');
  el2.id = 'btn-toggle-recording';
  doc.body.appendChild(el2);

  const d = driver({
    steps: [
      {
        element: '#project-select',
        popover: { title: 'Project Select', description: 'Choose your workspace project' }
      },
      {
        element: '#btn-toggle-recording',
        popover: { title: 'Capture Now', description: 'Click element to record' }
      }
    ]
  });

  d.drive(0);
  assert.strictEqual(d.getActiveIndex(), 0);
  assert.strictEqual(d.isFirstStep(), true);
  assert.strictEqual(d.hasNextStep(), true);
  assert.strictEqual(d.hasPreviousStep(), false);

  d.moveNext();
  assert.strictEqual(d.getActiveIndex(), 1);
  assert.strictEqual(d.isLastStep(), true);
  assert.strictEqual(d.hasNextStep(), false);
  assert.strictEqual(d.hasPreviousStep(), true);

  d.movePrevious();
  assert.strictEqual(d.getActiveIndex(), 0);

  d.destroy();
  assert.strictEqual(d.getActiveIndex(), -1);
});

test('driver: renders popover content with title, description, and progress counter', () => {
  const { doc } = setupTestEnvironment();

  const target = doc.createElement('div');
  target.id = 'screen-rec-row';
  doc.body.appendChild(target);

  const d = driver({
    showProgress: true,
    progressText: 'Step {{current}} of {{total}}',
    steps: [
      {
        element: '#screen-rec-row',
        popover: {
          title: '🎬 Replay & Screen Recording',
          description: 'Capture DOM mutations using rrweb sliding window.'
        }
      },
      {
        element: '#screen-rec-row',
        popover: {
          title: '🐾 Bug Steps',
          description: 'Record user interactions.'
        }
      }
    ]
  });

  d.drive(0);

  const popover = d.getPopover();
  assert.ok(popover, 'Popover element should exist');

  const title = popover.querySelector('.driver-popover-title');
  assert.ok(title);
  assert.strictEqual(title.textContent, '🎬 Replay & Screen Recording');

  const desc = popover.querySelector('.driver-popover-description');
  assert.ok(desc);
  assert.strictEqual(desc.textContent, 'Capture DOM mutations using rrweb sliding window.');

  const progress = popover.querySelector('.driver-popover-progress');
  assert.ok(progress);
  assert.strictEqual(progress.textContent, 'Step 1 of 2');

  d.destroy();
});

test('driver: handles missing or zero-dimension target elements without error', () => {
  const { doc } = setupTestEnvironment();

  const d = driver({
    steps: [
      {
        element: '#non-existent-target',
        popover: { title: 'Missing Element', description: 'Graceful fallback' }
      }
    ]
  });

  assert.doesNotThrow(() => {
    d.drive(0);
  });

  assert.strictEqual(d.getActiveIndex(), 0);
  assert.strictEqual(d.getActiveElement(), null);
  assert.ok(d.getPopover());

  d.destroy();
});

test('driver: cleanup on destroy removes overlay and popover from DOM', () => {
  const { doc } = setupTestEnvironment();

  const el = doc.createElement('button');
  el.id = 'target-btn';
  doc.body.appendChild(el);

  let destroyedCalled = false;
  const d = driver({
    steps: [{ element: '#target-btn', popover: { title: 'Test' } }],
    onDestroyed: () => { destroyedCalled = true; }
  });

  d.drive(0);
  assert.ok(d.getPopover());
  assert.ok(doc.body.querySelector('.driver-popover'));

  d.destroy();
  assert.strictEqual(d.getPopover(), null);
  assert.strictEqual(doc.body.querySelector('.driver-popover'), null);
  assert.strictEqual(destroyedCalled, true);
});

test('driver: sidepanel tour step definitions are complete and valid', () => {
  const sidepanelSteps = [
    { element: '#project-select', title: '📁 1. Active Target Project' },
    { element: '#btn-toggle-recording', title: '⚡ 2. One-Click Element Capture' },
    { element: '#screen-rec-row', title: '🎬 3. Replay & Screen Recording' },
    { element: '#step-rec-row', title: '🐾 4. Record Bug Steps' },
    { element: '#issue-list', title: '📋 5. Buffered Issues Queue' },
    { element: '#btn-submit-all', title: '🚀 6. Sync to Issue Trackers' },
    { element: '#btn-start-tour', title: '💡 7. Need Help Anytime?' }
  ];

  assert.strictEqual(sidepanelSteps.length, 7);
  sidepanelSteps.forEach(step => {
    assert.ok(step.element.startsWith('#'));
    assert.ok(step.title.length > 5);
  });
});
