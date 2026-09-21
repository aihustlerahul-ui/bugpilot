const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('annotate.js: declares and handles STEP callout badge tool', () => {
  const code = fs.readFileSync(path.join(__dirname, '../annotate.js'), 'utf8')
  assert.ok(code.includes("STEP: 'step'"), 'TOOLS object must contain STEP tool')
  assert.ok(code.includes('data-tool="step"'), 'Toolbar must contain step tool button')
  assert.ok(code.includes("s.type === 'step'"), 'drawShape must handle step shape rendering')
  assert.ok(code.includes("currentTool === TOOLS.STEP"), 'mousedown must handle step creation')
})

test('step callouts: auto-increments step numbers and computes bounds', () => {
  const shapes = []
  function addStep(x, y, color = '#ef4444') {
    const existing = shapes.filter(s => s.type === 'step').length
    const s = { type: 'step', x, y, number: existing + 1, color, radius: 13 }
    shapes.push(s)
    return s
  }

  const s1 = addStep(100, 150)
  assert.equal(s1.number, 1)
  assert.equal(s1.x, 100)

  const s2 = addStep(200, 250)
  assert.equal(s2.number, 2)

  const s3 = addStep(300, 350)
  assert.equal(s3.number, 3)

  // Bounds
  const r = s1.radius
  const bounds = { x: s1.x - r - 2, y: s1.y - r - 2, w: (r + 2) * 2, h: (r + 2) * 2 }
  assert.equal(bounds.w, 30)
  assert.equal(bounds.h, 30)

  // Hit testing
  const hit = Math.hypot(105 - s1.x, 152 - s1.y) <= r + 4
  assert.ok(hit, 'Click within radius should hit test')
})
