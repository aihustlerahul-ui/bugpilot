// QA Reporter — Annotation Canvas (injected on demand, MV3)
(function () {
  'use strict';

  // Guard: don't inject twice
  if (document.getElementById('qa-annotator-overlay')) return;

  var TOOLS = { RECT: 'rect', ARROW: 'arrow', CIRCLE: 'circle', PEN: 'pen', TEXT: 'text', BLUR: 'blur' };

  var currentTool  = TOOLS.RECT;
  var currentColor = '#ef4444';
  var drawing      = false;
  var startX = 0, startY = 0;
  var history      = [];   // array of ImageData snapshots
  var snapshot     = null; // ImageData before current stroke (for live preview)
  var imageIndex   = 0;

  // ── Build overlay DOM ──────────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id = 'qa-annotator-overlay';

  var toolbar = document.createElement('div');
  toolbar.id = 'qa-annotator-toolbar';
  toolbar.innerHTML =
    '<button class="qa-ann-tool active" data-tool="rect" title="Rectangle">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="1"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="arrow" title="Arrow">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="2" y1="14" x2="13" y2="3"/><polyline points="7,3 13,3 13,9"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="circle" title="Circle">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="5.5"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="pen" title="Freehand">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13 L5 10 L11 4 L12 5 L6 11 Z"/><line x1="3" y1="13" x2="5" y2="10"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="text" title="Text label">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><text x="2" y="13" font-size="12" font-weight="700" font-family="system-ui">T</text></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="blur" title="Blur / Redact">' +
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
  footer.style.display = 'none';
  footer.innerHTML =
    '<span class="qa-ann-footer-label">Save as:</span>' +
    '<button class="qa-ann-btn-replace" id="qa-ann-replace">Replace original</button>' +
    '<button class="qa-ann-btn-keep" id="qa-ann-keep">Keep both</button>';

  overlay.appendChild(toolbar);
  overlay.appendChild(canvas);
  overlay.appendChild(footer);
  document.documentElement.appendChild(overlay);

  // ── Canvas init ────────────────────────────────────────────────────────────
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;

  function initCanvas(dataUrl) {
    var img = new Image();
    img.onload = function () {
      // Display size: fill viewport minus toolbar (approx 50px) and footer (when shown, 54px)
      // Use the actual image aspect ratio scaled to viewport
      var toolbarH = toolbar.getBoundingClientRect().height || 50;
      var dispW = window.innerWidth;
      var dispH = window.innerHeight - toolbarH;

      canvas.style.width  = dispW + 'px';
      canvas.style.height = dispH + 'px';
      canvas.width  = Math.round(dispW  * dpr);
      canvas.height = Math.round(dispH * dpr);
      ctx.scale(dpr, dpr);

      // Fill background black then draw image centered/fitted
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, dispW, dispH);

      var scale = Math.min(dispW / img.naturalWidth, dispH / img.naturalHeight);
      var drawW = img.naturalWidth  * scale;
      var drawH = img.naturalHeight * scale;
      var drawX = (dispW - drawW) / 2;
      var drawY = (dispH - drawH) / 2;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      // Save base state as first history entry (cannot undo past this)
      history = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
    };
    img.src = dataUrl;
  }

  // ── Tool selection ─────────────────────────────────────────────────────────
  toolbar.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tool]');
    if (!btn) return;
    currentTool = btn.getAttribute('data-tool');
    toolbar.querySelectorAll('.qa-ann-tool').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    canvas.style.cursor = currentTool === 'text' ? 'text' : 'crosshair';
  });

  document.getElementById('qa-ann-color-picker').addEventListener('input', function (e) {
    currentColor = e.target.value;
  });

  // ── Mouse coordinate helper ────────────────────────────────────────────────
  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ── Drawing helpers ────────────────────────────────────────────────────────
  function drawArrow(x1, y1, x2, y2) {
    var headLen = 14;
    var angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = currentColor;
    ctx.fillStyle   = currentColor;
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

  function drawRect(x1, y1, x2, y2) {
    ctx.strokeStyle = currentColor;
    ctx.fillStyle   = currentColor + '26'; // 15% opacity
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
    ctx.fill();
    ctx.stroke();
  }

  function drawCircle(x1, y1, x2, y2) {
    var rx = (x2 - x1) / 2;
    var ry = (y2 - y1) / 2;
    ctx.strokeStyle = currentColor;
    ctx.fillStyle   = currentColor + '26';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.ellipse(x1 + rx, y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawBlur(x1, y1, x2, y2) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }

  // ── Mouse events ───────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', function (e) {
    var pos = getPos(e);
    startX = pos.x;
    startY = pos.y;

    if (currentTool === TOOLS.TEXT) {
      var text = prompt('Enter label:');
      if (text) {
        ctx.font         = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.lineWidth    = 3;
        ctx.strokeStyle  = '#fff';
        ctx.fillStyle    = currentColor;
        ctx.strokeText(text, pos.x, pos.y);
        ctx.fillText(text, pos.x, pos.y);
        history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      }
      return;
    }

    drawing  = true;
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  });

  canvas.addEventListener('mousemove', function (e) {
    if (!drawing) return;
    var pos = getPos(e);

    if (currentTool === TOOLS.PEN) {
      // For pen: draw incrementally, each move updates snapshot
      ctx.strokeStyle = currentColor;
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      startX = pos.x;
      startY = pos.y;
      // Update snapshot so undo removes the whole stroke on mouseup
      return;
    }

    // For all other tools: restore snapshot then redraw preview
    ctx.putImageData(snapshot, 0, 0);

    if      (currentTool === TOOLS.RECT)   drawRect(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.ARROW)  drawArrow(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.CIRCLE) drawCircle(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.BLUR)   drawBlur(startX, startY, pos.x, pos.y);
  });

  canvas.addEventListener('mouseup', function (e) {
    if (!drawing) return;
    drawing = false;

    if (currentTool === TOOLS.PEN) {
      // Pen: save snapshot of the completed stroke
      history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      return;
    }

    var pos = getPos(e);
    // Final draw (no preview flicker)
    if (snapshot) ctx.putImageData(snapshot, 0, 0);
    if      (currentTool === TOOLS.RECT)   drawRect(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.ARROW)  drawArrow(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.CIRCLE) drawCircle(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.BLUR)   drawBlur(startX, startY, pos.x, pos.y);

    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  });

  // ── Undo ───────────────────────────────────────────────────────────────────
  document.getElementById('qa-ann-undo').addEventListener('click', function () {
    if (history.length <= 1) return; // can't undo past base screenshot
    history.pop();
    ctx.putImageData(history[history.length - 1], 0, 0);
  });

  // ── Done — show footer ─────────────────────────────────────────────────────
  document.getElementById('qa-ann-done').addEventListener('click', function () {
    toolbar.style.display = 'none';
    footer.style.display  = 'flex';
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
    // Clean up
    chrome.storage.local.remove('qa_annotator_data');
    overlay.remove();
  }

  document.getElementById('qa-ann-replace').addEventListener('click', function () { finish(false); });
  document.getElementById('qa-ann-keep').addEventListener('click',    function () { finish(true);  });

  // ── Keyboard: Escape to cancel ─────────────────────────────────────────────
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      chrome.storage.local.remove('qa_annotator_data');
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

    // ── Resize handler: redraw canvas at new viewport size ──────────────────
    window.addEventListener('resize', function () {
      if (history.length === 0) return;
      var currentState = history[history.length - 1];
      var toolbarH = toolbar.getBoundingClientRect().height || 50;
      var dispW = window.innerWidth;
      var dispH = window.innerHeight - toolbarH;
      canvas.style.width  = dispW + 'px';
      canvas.style.height = dispH + 'px';
      canvas.width  = Math.round(dispW  * dpr);
      canvas.height = Math.round(dispH * dpr);
      ctx.scale(dpr, dpr);
      ctx.putImageData(currentState, 0, 0);
    });
  });

})();
