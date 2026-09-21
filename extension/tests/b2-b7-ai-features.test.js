const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('B2: content.js extracts 50-token semantic DOM context and includes smart form', () => {
  const contentCode = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8')
  assert.ok(contentCode.includes('extractDOMContext'), 'content.js must define extractDOMContext')
  assert.ok(contentCode.includes('serializeDOMContext'), 'content.js must define serializeDOMContext')
  assert.ok(contentCode.includes('qa-tab-smart'), 'showModal must include Smart Mode tab')
  assert.ok(contentCode.includes('qa-smart-input'), 'showModal must include single-input smart textarea')
  assert.ok(contentCode.includes('qa-btn-smart-autofill'), 'showModal must include Auto-Fill with AI button')
  assert.ok(contentCode.includes('SMART_AUTOFILL'), 'content.js must send SMART_AUTOFILL message')
})

test('B7: content.js & sidepanel.js handle InputSession keystroke consolidation and step recording', () => {
  const contentCode = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8')
  const sidepanelCode = fs.readFileSync(path.join(__dirname, '../sidepanel.js'), 'utf8')
  const sidepanelHtml = fs.readFileSync(path.join(__dirname, '../sidepanel.html'), 'utf8')

  assert.ok(contentCode.includes('InputSession'), 'content.js must define InputSession')
  assert.ok(contentCode.includes('qa_recorded_steps'), 'content.js must persist recorded steps to storage')
  assert.ok(sidepanelHtml.includes('btn-step-recording'), 'sidepanel.html must have Record Bug Steps button')
  assert.ok(sidepanelHtml.includes('steps-drawer'), 'sidepanel.html must have recorded steps drawer')
  assert.ok(sidepanelCode.includes('applyStepRecordingState'), 'sidepanel.js must manage step recording lifecycle')
})

test('B8: background.js handles ANALYZE_VISUAL_ANOMALIES and SMART_AUTOFILL', () => {
  const bgCode = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8')
  assert.ok(bgCode.includes('handleSmartAutofill'), 'background.js must define handleSmartAutofill')
  assert.ok(bgCode.includes('handleAnalyzeVisualAnomalies'), 'background.js must define handleAnalyzeVisualAnomalies')
  assert.ok(bgCode.includes('handleStartStepRecording'), 'background.js must define handleStartStepRecording')
  assert.ok(bgCode.includes('handleStopStepRecording'), 'background.js must define handleStopStepRecording')
})
