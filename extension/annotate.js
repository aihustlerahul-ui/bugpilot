// QA Reporter — Annotation Canvas (injected on demand, MV3)
(function () {
  'use strict';

  // Guard: don't inject twice
  if (document.getElementById('qa-annotator-overlay')) return;

  var TOOLS = { SELECT: 'select', RECT: 'rect', ARROW: 'arrow', CIRCLE: 'circle', PEN: 'pen', TEXT: 'text', BLUR: 'blur' };

  var currentTool  = TOOLS.RECT;
  var currentColor = '#ef4444';
  var imageIndex   = 0;

  // ── Object model ──────────────────────────────────────────────────────────
  // Each shape: { type, color, ...coords }
  // rect/circle/blur: { x1, y1, x2, y2 }
  // arrow:            { x1, y1, x2, y2 }
  // pen:              { points: [{x,y},...] }
  // text:             { x, y, text }
  var shapes   = [];          // committed shapes
  var history  = [];          // array of shapes[] snapshots for undo
  var preview  = null;        // shape being drawn right now (not yet committed)

  // ── Select / drag state ────────────────────────────────────────────────────
  var selectedIndex = -1;     // index into shapes[] of selected shape
  var dragging      = false;
  var dragStartX    = 0, dragStartY    = 0;
  var dragShapeSnap = null;   // deep copy of shape at drag start

  // ── Drawing state ──────────────────────────────────────────────────────────
  var drawing  = false;
  var startX   = 0, startY = 0;
  var penPoints = [];         // accumulated points for current pen stroke

  // ── Base image ────────────────────────────────────────────────────────────
  var baseImage = null;       // Image object — redrawn on every redraw()
  var dispW = 0, dispH = 0;  // CSS display dimensions

  // ── Build overlay DOM ──────────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id = 'qa-annotator-overlay';

  var toolbar = document.createElement('div');
  toolbar.id = 'qa-annotator-toolbar';
  toolbar.innerHTML =
    '<button class="qa-ann-tool" data-tool="select" title="Select &amp; Move (V)">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2 L3 13 L6.5 9.5 L9 14 L10.5 13.3 L8 8 L12 8 Z"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool active" data-tool="rect" title="Rectangle (R)">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="1"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="arrow" title="Arrow (A)">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="2" y1="14" x2="13" y2="3"/><polyline points="7,3 13,3 13,9"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="circle" title="Circle (C)">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="5.5"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="pen" title="Freehand (P)">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13 L5 10 L11 4 L12 5 L6 11 Z"/><line x1="3" y1="13" x2="5" y2="10"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="text" title="Text (T)">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><text x="2" y="13" font-size="12" font-weight="700" font-family="system-ui">T</text></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="blur" title="Blur / Redact (B)">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="12" height="8" rx="1" stroke-dasharray="2 1.5"/><line x1="5" y1="7" x2="11" y2="7"/><line x1="5" y1="9" x2="11" y2="9"/></svg>' +
    '</button>' +
    '<div class="qa-ann-separator"></div>' +
    '<input type="color" id="qa-ann-color-picker" value="#ef4444" title="Color">' +
    '<div class="qa-ann-spacer"></div>' +
    '<button class="qa-ann-btn-undo" id="qa-ann-undo">↩ Undo</button>' +
    '<button class="qa-ann-btn-done" id="qa-ann-done">Done ✓</button>';

  var canvas = document.createElement('canvas');
  canvas.id = 'qa-annotator-canvas';

  var footer = document.createElement('div');
  footer.id = 'qa-annotator-footer';
  footer.style.setProperty('display', 'none', 'important');
  footer.innerHTML =
    '<span class="qa-ann-footer-label">Save as:</span>' +
    '<button class="qa-ann-btn-replace" id="qa-ann-replace">Replace original</button>' +
    '<button class="qa-ann-btn-keep" id="qa-ann-keep">Keep both</button>';

  overlay.appendChild(toolbar);
  overlay.appendChild(canvas);
  overlay.appendChild(footer);
  document.documentElement.appendChild(overlay);

  // ── Canvas setup ───────────────────────────────────────────────────────────
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;

  function setupCanvas() {
    var toolbarH = toolbar.getBoundingClientRect().height || 50;
    dispW = window.innerWidth;
    dispH = window.innerHeight - toolbarH;
    canvas.style.width  = dispW + 'px';
    canvas.style.height = dispH + 'px';
    canvas.width  = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function initCanvas(dataUrl) {
    var img = new Image();
    img.onload = function () {
      baseImage = img;
      setupCanvas();
      history = [[]];   // initial state: empty shapes array
      shapes  = [];
      redraw();
    };
    img.src = dataUrl;
  }

  // ── Redraw everything from scratch ─────────────────────────────────────────
  function redraw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dispW, dispH);

    // Base screenshot
    if (baseImage) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, dispW, dispH);
      var scale = Math.min(dispW / baseImage.naturalWidth, dispH / baseImage.naturalHeight);
      var drawW = baseImage.naturalWidth  * scale;
      var drawH = baseImage.naturalHeight * scale;
      ctx.drawImage(baseImage, (dispW - drawW) / 2, (dispH - drawH) / 2, drawW, drawH);
    }

    // Committed shapes
    shapes.forEach(function (s, i) {
      drawShape(s, i === selectedIndex);
    });

    // Live preview while drawing
    if (preview) drawShape(preview, false);
  }

  // ── Draw a single shape ────────────────────────────────────────────────────
  function drawShape(s, selected) {
    ctx.save();
    if (s.type === 'rect') {
      ctx.strokeStyle = s.color;
      ctx.fillStyle   = s.color + '26';
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.rect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1);
      ctx.fill();
      ctx.stroke();
      if (selected) drawSelectionHandles(Math.min(s.x1,s.x2), Math.min(s.y1,s.y2), Math.abs(s.x2-s.x1), Math.abs(s.y2-s.y1));
    } else if (s.type === 'arrow') {
      drawArrow(s.x1, s.y1, s.x2, s.y2, s.color);
      if (selected) drawSelectionHandles(Math.min(s.x1,s.x2)-4, Math.min(s.y1,s.y2)-4, Math.abs(s.x2-s.x1)+8, Math.abs(s.y2-s.y1)+8);
    } else if (s.type === 'circle') {
      var rx = (s.x2 - s.x1) / 2, ry = (s.y2 - s.y1) / 2;
      ctx.strokeStyle = s.color;
      ctx.fillStyle   = s.color + '26';
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.ellipse(s.x1 + rx, s.y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (selected) drawSelectionHandles(Math.min(s.x1,s.x2), Math.min(s.y1,s.y2), Math.abs(s.x2-s.x1), Math.abs(s.y2-s.y1));
    } else if (s.type === 'pen') {
      if (s.points.length < 2) { ctx.restore(); return; }
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (var i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
      if (selected) {
        var bb = penBoundingBox(s);
        drawSelectionHandles(bb.x, bb.y, bb.w, bb.h);
      }
    } else if (s.type === 'text') {
      ctx.font        = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.lineWidth   = 3;
      ctx.strokeStyle = '#fff';
      ctx.fillStyle   = s.color;
      ctx.strokeText(s.text, s.x, s.y);
      ctx.fillText(s.text, s.x, s.y);
      if (selected) {
        var metrics = ctx.measureText(s.text);
        drawSelectionHandles(s.x - 2, s.y - 16, metrics.width + 4, 20);
      }
    } else if (s.type === 'blur') {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1);
      if (selected) drawSelectionHandles(Math.min(s.x1,s.x2), Math.min(s.y1,s.y2), Math.abs(s.x2-s.x1), Math.abs(s.y2-s.y1));
    }
    ctx.restore();
  }

  function drawSelectionHandles(x, y, w, h) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
    ctx.setLineDash([]);
  }

  function drawArrow(x1, y1, x2, y2, color) {
    var headLen = 14;
    var angle   = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  // ── Hit testing ────────────────────────────────────────────────────────────
  function hitTest(x, y) {
    // Test in reverse order so topmost shape wins
    for (var i = shapes.length - 1; i >= 0; i--) {
      var s = shapes[i];
      if (s.type === 'rect' || s.type === 'circle' || s.type === 'blur') {
        var minX = Math.min(s.x1, s.x2), maxX = Math.max(s.x1, s.x2);
        var minY = Math.min(s.y1, s.y2), maxY = Math.max(s.y1, s.y2);
        if (x >= minX - 4 && x <= maxX + 4 && y >= minY - 4 && y <= maxY + 4) return i;
      } else if (s.type === 'arrow') {
        if (distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) < 8) return i;
      } else if (s.type === 'pen') {
        for (var j = 0; j < s.points.length - 1; j++) {
          if (distToSegment(x, y, s.points[j].x, s.points[j].y, s.points[j+1].x, s.points[j+1].y) < 8) return i;
        }
      } else if (s.type === 'text') {
        ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        var w = ctx.measureText(s.text).width;
        if (x >= s.x - 2 && x <= s.x + w + 2 && y >= s.y - 16 && y <= s.y + 4) return i;
      }
    }
    return -1;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    var t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function penBoundingBox(s) {
    var xs = s.points.map(function(p){ return p.x; });
    var ys = s.points.map(function(p){ return p.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    return { x: minX - 4, y: minY - 4, w: maxX - minX + 8, h: maxY - minY + 8 };
  }

  // ── Deep copy helpers ─────────────────────────────────────────────────────
  function cloneShape(s) {
    var c = Object.assign({}, s);
    if (s.points) c.points = s.points.map(function(p){ return {x: p.x, y: p.y}; });
    return c;
  }
  function cloneShapes() { return shapes.map(cloneShape); }

  // ── Undo stack ────────────────────────────────────────────────────────────
  function pushHistory() {
    history.push(cloneShapes());
  }

  // ── Mouse coordinate helper ────────────────────────────────────────────────
  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ── Tool selection ─────────────────────────────────────────────────────────
  toolbar.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tool]');
    if (!btn) return;
    currentTool = btn.getAttribute('data-tool');
    toolbar.querySelectorAll('.qa-ann-tool').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    selectedIndex = -1;
    canvas.style.cursor = currentTool === TOOLS.SELECT ? 'default' : currentTool === TOOLS.TEXT ? 'text' : 'crosshair';
    redraw();
  });

  document.getElementById('qa-ann-color-picker').addEventListener('input', function (e) {
    currentColor = e.target.value;
    // Update color of selected shape live
    if (selectedIndex >= 0 && shapes[selectedIndex]) {
      pushHistory();
      shapes[selectedIndex].color = currentColor;
      redraw();
    }
  });

  // ── Mouse events ───────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', function (e) {
    var pos = getPos(e);

    // ── SELECT tool ──────────────────────────────────────────────────────────
    if (currentTool === TOOLS.SELECT) {
      var hit = hitTest(pos.x, pos.y);
      if (hit >= 0) {
        selectedIndex  = hit;
        dragging       = true;
        dragStartX     = pos.x;
        dragStartY     = pos.y;
        dragShapeSnap  = cloneShape(shapes[hit]);
        canvas.style.cursor = 'move';
      } else {
        selectedIndex = -1;
      }
      redraw();
      return;
    }

    // ── TEXT tool ────────────────────────────────────────────────────────────
    if (currentTool === TOOLS.TEXT) {
      var text = prompt('Enter label:');
      if (text) {
        pushHistory();
        shapes.push({ type: 'text', x: pos.x, y: pos.y, text: text, color: currentColor });
        selectedIndex = -1;
        redraw();
      }
      return;
    }

    // ── Drawing tools ─────────────────────────────────────────────────────────
    drawing  = true;
    startX   = pos.x;
    startY   = pos.y;
    selectedIndex = -1;

    if (currentTool === TOOLS.PEN) {
      penPoints = [{ x: pos.x, y: pos.y }];
    }
  });

  canvas.addEventListener('mousemove', function (e) {
    var pos = getPos(e);

    // ── Drag selected shape ───────────────────────────────────────────────────
    if (dragging && currentTool === TOOLS.SELECT && selectedIndex >= 0) {
      var dx = pos.x - dragStartX;
      var dy = pos.y - dragStartY;
      var s  = shapes[selectedIndex];
      var snap = dragShapeSnap;

      if (s.type === 'text') {
        s.x = snap.x + dx;
        s.y = snap.y + dy;
      } else if (s.type === 'pen') {
        s.points = snap.points.map(function(p){ return { x: p.x + dx, y: p.y + dy }; });
      } else {
        s.x1 = snap.x1 + dx; s.y1 = snap.y1 + dy;
        s.x2 = snap.x2 + dx; s.y2 = snap.y2 + dy;
      }
      redraw();
      return;
    }

    // ── Cursor feedback in select mode ────────────────────────────────────────
    if (currentTool === TOOLS.SELECT && !dragging) {
      canvas.style.cursor = hitTest(pos.x, pos.y) >= 0 ? 'move' : 'default';
      return;
    }

    if (!drawing) return;

    // ── Live preview for drawing tools ────────────────────────────────────────
    if (currentTool === TOOLS.PEN) {
      penPoints.push({ x: pos.x, y: pos.y });
      preview = { type: 'pen', points: penPoints.slice(), color: currentColor };
    } else {
      var type = currentTool;
      preview = { type: type, x1: startX, y1: startY, x2: pos.x, y2: pos.y, color: currentColor };
    }
    redraw();
  });

  canvas.addEventListener('mouseup', function (e) {
    var pos = getPos(e);

    // ── Finish drag ───────────────────────────────────────────────────────────
    if (dragging) {
      dragging = false;
      canvas.style.cursor = 'move';
      pushHistory();   // commit drag to undo stack
      redraw();
      return;
    }

    if (!drawing) return;
    drawing = false;
    preview = null;

    // ── Commit shape ──────────────────────────────────────────────────────────
    if (currentTool === TOOLS.PEN) {
      if (penPoints.length >= 2) {
        pushHistory();
        shapes.push({ type: 'pen', points: penPoints.slice(), color: currentColor });
      }
      penPoints = [];
    } else {
      // Skip trivially small shapes (accidental clicks)
      if (Math.abs(pos.x - startX) < 3 && Math.abs(pos.y - startY) < 3) { redraw(); return; }
      pushHistory();
      shapes.push({ type: currentTool, x1: startX, y1: startY, x2: pos.x, y2: pos.y, color: currentColor });
    }
    redraw();
  });

  // Click on canvas in select mode deselects if no hit
  canvas.addEventListener('click', function (e) {
    if (currentTool !== TOOLS.SELECT) return;
    var pos = getPos(e);
    if (hitTest(pos.x, pos.y) < 0) {
      selectedIndex = -1;
      redraw();
    }
  });

  // ── Undo ───────────────────────────────────────────────────────────────────
  document.getElementById('qa-ann-undo').addEventListener('click', function () {
    if (history.length <= 1) return;
    history.pop();
    shapes = history[history.length - 1].map(cloneShape);
    selectedIndex = -1;
    redraw();
  });

  // ── Done — show footer ─────────────────────────────────────────────────────
  document.getElementById('qa-ann-done').addEventListener('click', function () {
    selectedIndex = -1;
    redraw();  // clear selection handles before capturing
    toolbar.style.setProperty('display', 'none', 'important');
    footer.style.setProperty('display', 'flex', 'important');
    canvas.style.pointerEvents = 'none';
  });

  function finish(keepOriginal) {
    var annotatedDataUrl = canvas.toDataURL('image/png');
    chrome.runtime.sendMessage({
      type:         'ANNOTATION_DONE',
      dataUrl:      annotatedDataUrl,
      imageIndex:   imageIndex,
      keepOriginal: keepOriginal,
    });
    chrome.storage.local.remove('qa_annotator_data');
    overlay.remove();
  }

  document.getElementById('qa-ann-replace').addEventListener('click', function () { finish(false); });
  document.getElementById('qa-ann-keep').addEventListener('click',    function () { finish(true);  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      chrome.storage.local.remove('qa_annotator_data');
      return;
    }
    // Tool shortcuts (only when not typing in an input)
    if (e.target.tagName === 'INPUT') return;
    var keyMap = { v: 'select', r: 'rect', a: 'arrow', c: 'circle', p: 'pen', t: 'text', b: 'blur' };
    var tool = keyMap[e.key.toLowerCase()];
    if (tool) {
      var btn = toolbar.querySelector('[data-tool="' + tool + '"]');
      if (btn) btn.click();
    }
    // Delete selected shape
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex >= 0) {
      e.preventDefault();
      pushHistory();
      shapes.splice(selectedIndex, 1);
      selectedIndex = -1;
      redraw();
    }
  });

  // ── Load data from storage and init ───────────────────────────────────────
  chrome.storage.local.get(['qa_annotator_data'], function (result) {
    var data = result.qa_annotator_data;
    if (!data || !data.dataUrl) {
      overlay.remove();
      return;
    }
    imageIndex = data.imageIndex || 0;
    initCanvas(data.dataUrl);

    window.addEventListener('resize', function () {
      if (!baseImage) return;
      setupCanvas();
      redraw();
    });
  });

})();
