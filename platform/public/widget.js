/**
 * BugPilot Embeddable Guest Feedback & Bug Reporting Widget (v2.1)
 * Usage: <script src="https://your-domain.com/widget.js" data-project-id="YOUR_PROJECT_ID" data-api-url="https://api.your-domain.com"></script>
 */
(function () {
  'use strict';

  if (window.__BUGPILOT_WIDGET_LOADED__) return;
  window.__BUGPILOT_WIDGET_LOADED__ = true;

  // 1. Locate configuration from script tag
  var currentScript = document.currentScript || document.querySelector('script[data-project-id]');
  var projectId = currentScript ? currentScript.getAttribute('data-project-id') : null;
  var apiUrl = (currentScript && currentScript.getAttribute('data-api-url')) || window.location.origin;

  // 2. In-memory telemetry flight recorder
  var consoleErrors = [];
  var origError = console.error;
  console.error = function () {
    var args = Array.prototype.slice.call(arguments);
    consoleErrors.push({
      level: 'error',
      message: args.map(function (a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' '),
      timestamp: Date.now(),
    });
    if (consoleErrors.length > 30) consoleErrors.shift();
    return origError.apply(console, arguments);
  };

  window.addEventListener('error', function (e) {
    consoleErrors.push({
      level: 'error',
      message: (e.message || 'Script error') + ' at ' + (e.filename || '') + ':' + (e.lineno || 0),
      timestamp: Date.now(),
    });
  });

  // 3. Inject Shadow DOM container
  var host = document.createElement('div');
  host.id = 'bugpilot-widget-root';
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647; bottom:24px; right:24px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  document.documentElement.appendChild(host);

  var shadow = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .trigger-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: #4f46e5;
      color: #ffffff;
      border: none;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
      transition: all 0.2s ease;
    }
    .trigger-btn:hover {
      background: #4338ca;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.5);
    }
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.open {
      display: flex;
    }
    .modal-card {
      background: #ffffff;
      width: 440px;
      max-width: 90vw;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .modal-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }
    .close-btn {
      background: none;
      border: none;
      font-size: 18px;
      color: #64748b;
      cursor: pointer;
    }
    .field {
      margin-bottom: 14px;
    }
    .label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #334155;
      margin-bottom: 6px;
    }
    .input, .textarea, .select {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    .input:focus, .textarea:focus, .select:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }
    .textarea {
      resize: vertical;
      min-height: 80px;
    }
    .submit-btn {
      width: 100%;
      padding: 10px;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      margin-top: 8px;
    }
    .submit-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .success-msg {
      color: #16a34a;
      font-size: 13px;
      text-align: center;
      margin-top: 10px;
    }
  `;
  shadow.appendChild(style);

  var container = document.createElement('div');
  container.innerHTML = `
    <button class="trigger-btn" id="bp-open-btn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
      Report Bug
    </button>
    <div class="modal-overlay" id="bp-modal">
      <div class="modal-card">
        <div class="modal-header">
          <h3 class="modal-title">Report an Issue</h3>
          <button class="close-btn" id="bp-close-btn">&times;</button>
        </div>
        <form id="bp-form">
          <div class="field">
            <label class="label">What went wrong?</label>
            <textarea class="textarea" id="bp-desc" required placeholder="Describe what happened..."></textarea>
          </div>
          <div class="field">
            <label class="label">Your Email (Optional)</label>
            <input type="email" class="input" id="bp-email" placeholder="you@company.com" />
          </div>
          <div class="field">
            <label class="label">Severity</label>
            <select class="select" id="bp-severity">
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
              <option value="low">Low</option>
            </select>
          </div>
          <button type="submit" class="submit-btn" id="bp-submit">Submit Bug Report</button>
          <p class="success-msg" id="bp-success" style="display:none;">✓ Thank you! Bug reported successfully.</p>
        </form>
      </div>
    </div>
  `;
  shadow.appendChild(container);

  var openBtn = shadow.getElementById('bp-open-btn');
  var closeBtn = shadow.getElementById('bp-close-btn');
  var modal = shadow.getElementById('bp-modal');
  var form = shadow.getElementById('bp-form');
  var submitBtn = shadow.getElementById('bp-submit');
  var successMsg = shadow.getElementById('bp-success');

  openBtn.addEventListener('click', function () {
    modal.classList.add('open');
  });

  closeBtn.addEventListener('click', function () {
    modal.classList.remove('open');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    var description = shadow.getElementById('bp-desc').value;
    var email = shadow.getElementById('bp-email').value;
    var severity = shadow.getElementById('bp-severity').value;

    var payload = {
      project_id: projectId,
      title: description.slice(0, 100),
      description: description,
      url: window.location.href,
      route: window.location.pathname,
      severity: severity,
      browser_info: {
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      metadata: {
        reporterEmail: email || 'guest@anonymous',
        consoleErrors: consoleErrors,
        reportedVia: 'EmbedWidget',
      },
    };

    fetch(apiUrl + '/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Submission failed');
        return res.json();
      })
      .then(function () {
        form.reset();
        successMsg.style.display = 'block';
        submitBtn.style.display = 'none';
        setTimeout(function () {
          modal.classList.remove('open');
          successMsg.style.display = 'none';
          submitBtn.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Bug Report';
        }, 2000);
      })
      .catch(function (err) {
        alert('Failed to submit bug: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Bug Report';
      });
  });
})();
