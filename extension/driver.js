/**
 * Driver.js — In-Browser Product Tour & Spotlight Engine
 * Manifest V3 Extension compatible (no external dependencies, zero eval)
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    var exp = factory();
    module.exports = exp.driver;
    module.exports.driver = exp.driver;
  } else {
    var exp = factory();
    root.driver = exp.driver;
  }
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function driver(config) {
    var currentConfig = Object.assign({
      steps: [],
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next →',
      prevBtnText: '← Back',
      doneBtnText: 'Got it ✓',
      closeBtnText: '✕',
      allowClose: true,
      overlayColor: '#0f172a',
      overlayOpacity: 0.7,
      stagePadding: 6,
      stageRadius: 8,
      animate: true,
      onDestroyed: null,
      onHighlightStarted: null,
      onHighlighted: null,
      onDeselected: null
    }, config || {});

    var activeIndex = -1;
    var overlayEl = null;
    var popoverEl = null;
    var activeElement = null;
    var keydownHandler = null;

    function createOverlay() {
      if (overlayEl) return overlayEl;

      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'driver-overlay');
      svg.style.position = 'fixed';
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.width = '100vw';
      svg.style.height = '100vh';
      svg.style.zIndex = '999998';
      svg.style.pointerEvents = 'auto';

      svg.innerHTML =
        '<defs>' +
          '<mask id="ext-driver-mask">' +
            '<rect x="0" y="0" width="100%" height="100%" fill="white" />' +
            '<rect id="ext-driver-cutout" x="0" y="0" width="0" height="0" rx="' + (currentConfig.stageRadius || 8) + '" fill="black" />' +
          '</mask>' +
        '</defs>' +
        '<rect x="0" y="0" width="100%" height="100%" fill="' + currentConfig.overlayColor + '" fill-opacity="' + currentConfig.overlayOpacity + '" mask="url(#ext-driver-mask)" />';

      if (currentConfig.allowClose) {
        svg.addEventListener('click', function (e) {
          if (e.target === svg || (e.target && e.target.tagName === 'rect')) {
            destroy();
          }
        });
      }

      document.body.appendChild(svg);
      overlayEl = svg;
      return svg;
    }

    function updateCutout(rect) {
      if (!overlayEl) return;
      var cutout = overlayEl.querySelector('#ext-driver-cutout');
      if (!cutout) return;

      if (!rect || (rect.width === 0 && rect.height === 0)) {
        cutout.setAttribute('x', '0');
        cutout.setAttribute('y', '0');
        cutout.setAttribute('width', '0');
        cutout.setAttribute('height', '0');
        return;
      }

      var pad = currentConfig.stagePadding || 6;
      var x = Math.max(0, rect.left - pad);
      var y = Math.max(0, rect.top - pad);
      var w = rect.width + pad * 2;
      var h = rect.height + pad * 2;

      cutout.setAttribute('x', String(x));
      cutout.setAttribute('y', String(y));
      cutout.setAttribute('width', String(w));
      cutout.setAttribute('height', String(h));
    }

    function resolveElement(target) {
      if (!target) return null;
      if (typeof target === 'string') {
        return document.querySelector(target);
      }
      if (typeof target === 'function') {
        return target();
      }
      return target;
    }

    function positionPopover(popover, targetRect, side, align) {
      side = side || 'bottom';
      align = align || 'start';
      var margin = 10;
      var popoverRect = popover.getBoundingClientRect();
      var viewportW = window.innerWidth;
      var viewportH = window.innerHeight;

      if (!targetRect || side === 'over' || (targetRect.width === 0 && targetRect.height === 0)) {
        popover.style.top = Math.max(12, (viewportH - popoverRect.height) / 2) + 'px';
        popover.style.left = Math.max(12, (viewportW - popoverRect.width) / 2) + 'px';
        return;
      }

      var top = 0;
      var left = 0;

      if (side === 'bottom') {
        top = targetRect.bottom + margin;
        if (top + popoverRect.height > viewportH - 8) {
          top = Math.max(8, targetRect.top - popoverRect.height - margin);
        }
      } else if (side === 'top') {
        top = targetRect.top - popoverRect.height - margin;
        if (top < 8) {
          top = targetRect.bottom + margin;
        }
      } else if (side === 'left') {
        left = targetRect.left - popoverRect.width - margin;
        top = targetRect.top;
        if (left < 8) {
          left = targetRect.right + margin;
        }
      } else if (side === 'right') {
        left = targetRect.right + margin;
        top = targetRect.top;
        if (left + popoverRect.width > viewportW - 8) {
          left = Math.max(8, targetRect.left - popoverRect.width - margin);
        }
      }

      if (side === 'top' || side === 'bottom') {
        if (align === 'start') {
          left = targetRect.left;
        } else if (align === 'center') {
          left = targetRect.left + (targetRect.width - popoverRect.width) / 2;
        } else if (align === 'end') {
          left = targetRect.right - popoverRect.width;
        }
      }

      left = Math.max(8, Math.min(left, viewportW - popoverRect.width - 8));
      top = Math.max(8, Math.min(top, viewportH - popoverRect.height - 8));

      popover.style.top = top + 'px';
      popover.style.left = left + 'px';
    }

    function renderPopover(step) {
      if (popoverEl && popoverEl.parentNode) popoverEl.parentNode.removeChild(popoverEl);

      var p = step.popover || {};
      var totalSteps = currentConfig.steps ? currentConfig.steps.length : 1;
      var currentStepNum = activeIndex + 1;

      var popover = document.createElement('div');
      popover.className = 'driver-popover';
      popover.style.position = 'fixed';
      popover.style.zIndex = '999999';

      var progressText = (currentConfig.progressText || '{{current}} of {{total}}')
        .replace('{{current}}', String(currentStepNum))
        .replace('{{total}}', String(totalSteps));

      var isFirst = activeIndex === 0;
      var isLast = activeIndex === totalSteps - 1;

      popover.innerHTML =
        '<div class="driver-popover-content">' +
          '<div class="driver-popover-header">' +
            (p.title ? '<h3 class="driver-popover-title">' + p.title + '</h3>' : '') +
            (currentConfig.allowClose ? '<button class="driver-popover-close" type="button" aria-label="Close">' + (p.closeBtnText || currentConfig.closeBtnText || '✕') + '</button>' : '') +
          '</div>' +
          (p.description ? '<div class="driver-popover-description">' + p.description + '</div>' : '') +
          '<div class="driver-popover-footer">' +
            (currentConfig.showProgress && totalSteps > 1 ? '<span class="driver-popover-progress">' + progressText + '</span>' : '<span></span>') +
            '<div class="driver-popover-btn-group">' +
              (!isFirst ? '<button class="driver-btn driver-btn-prev" type="button">' + (p.prevBtnText || currentConfig.prevBtnText || '← Back') + '</button>' : '') +
              '<button class="driver-btn driver-btn-next ' + (isLast ? 'driver-btn-done' : '') + '" type="button">' +
                (isLast ? (p.doneBtnText || currentConfig.doneBtnText || 'Got it ✓') : (p.nextBtnText || currentConfig.nextBtnText || 'Next →')) +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      var closeBtn = popover.querySelector('.driver-popover-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          if (p.onCloseClick) p.onCloseClick();
          destroy();
        });
      }

      var prevBtn = popover.querySelector('.driver-btn-prev');
      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (p.onPrevClick) p.onPrevClick();
          movePrevious();
        });
      }

      var nextBtn = popover.querySelector('.driver-btn-next');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (isLast) {
            if (p.onNextClick) p.onNextClick();
            destroy();
          } else {
            if (p.onNextClick) p.onNextClick();
            moveNext();
          }
        });
      }

      document.body.appendChild(popover);
      popoverEl = popover;
      return popover;
    }

    function highlight(index) {
      var steps = currentConfig.steps || [];
      if (index < 0 || index >= steps.length) {
        destroy();
        return;
      }

      if (activeElement && currentConfig.onDeselected) {
        currentConfig.onDeselected(activeElement, steps[activeIndex]);
      }
      if (activeElement) {
        activeElement.classList.remove('driver-highlighted-element');
      }

      activeIndex = index;
      var step = steps[index];
      var el = resolveElement(step.element);
      activeElement = el;

      if (currentConfig.onHighlightStarted) {
        currentConfig.onHighlightStarted(el || undefined, step);
      }

      createOverlay();

      if (el) {
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
        el.classList.add('driver-highlighted-element');
      }

      var targetRect = el ? el.getBoundingClientRect() : null;
      updateCutout(targetRect);

      var popover = renderPopover(step);
      positionPopover(popover, targetRect, step.popover ? step.popover.side : 'bottom', step.popover ? step.popover.align : 'start');

      if (currentConfig.onHighlighted) {
        currentConfig.onHighlighted(el || undefined, step);
      }
    }

    function drive(stepIndex) {
      destroy();
      keydownHandler = function (e) {
        if (e.key === 'Escape' && currentConfig.allowClose) {
          destroy();
        } else if (e.key === 'ArrowRight') {
          moveNext();
        } else if (e.key === 'ArrowLeft') {
          movePrevious();
        }
      };
      window.addEventListener('keydown', keydownHandler);
      window.addEventListener('resize', refresh);
      highlight(stepIndex || 0);
    }

    function moveNext() {
      var steps = currentConfig.steps || [];
      if (activeIndex + 1 < steps.length) {
        highlight(activeIndex + 1);
      } else {
        destroy();
      }
    }

    function movePrevious() {
      if (activeIndex - 1 >= 0) {
        highlight(activeIndex - 1);
      }
    }

    function refresh() {
      if (activeIndex >= 0) {
        var step = currentConfig.steps ? currentConfig.steps[activeIndex] : null;
        if (step) {
          var targetRect = activeElement ? activeElement.getBoundingClientRect() : null;
          updateCutout(targetRect);
          if (popoverEl) {
            positionPopover(popoverEl, targetRect, step.popover ? step.popover.side : 'bottom', step.popover ? step.popover.align : 'start');
          }
        }
      }
    }

    function destroy() {
      if (activeElement) {
        activeElement.classList.remove('driver-highlighted-element');
      }
      if (popoverEl && popoverEl.parentNode) {
        popoverEl.parentNode.removeChild(popoverEl);
        popoverEl = null;
      }
      if (overlayEl && overlayEl.parentNode) {
        overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = null;
      }
      if (keydownHandler) {
        window.removeEventListener('keydown', keydownHandler);
        keydownHandler = null;
      }
      window.removeEventListener('resize', refresh);

      var wasActive = activeIndex >= 0;
      activeIndex = -1;
      activeElement = null;

      if (wasActive && typeof currentConfig.onDestroyed === 'function') {
        currentConfig.onDestroyed();
      }
    }

    return {
      drive: drive,
      moveNext: moveNext,
      movePrevious: movePrevious,
      hasNextStep: function () { return activeIndex + 1 < (currentConfig.steps ? currentConfig.steps.length : 0); },
      hasPreviousStep: function () { return activeIndex > 0; },
      isFirstStep: function () { return activeIndex === 0; },
      isLastStep: function () { return activeIndex === (currentConfig.steps ? currentConfig.steps.length : 0) - 1; },
      getActiveStep: function () { return currentConfig.steps ? currentConfig.steps[activeIndex] : null; },
      getActiveIndex: function () { return activeIndex; },
      getActiveElement: function () { return activeElement; },
      getPopover: function () { return popoverEl; },
      destroy: destroy,
      reset: destroy,
      refresh: refresh
    };
  }

  return { driver: driver };
}));
