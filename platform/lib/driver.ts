/**
 * Driver.js — Lightweight, zero-dependency product tour & spotlight engine
 * Compatible with Driver.js v1.x API
 */

export interface PopoverConfig {
  title?: string
  description?: string
  side?: 'top' | 'right' | 'bottom' | 'left' | 'over'
  align?: 'start' | 'center' | 'end'
  showButtons?: ('next' | 'previous' | 'close')[]
  nextBtnText?: string
  prevBtnText?: string
  doneBtnText?: string
  closeBtnText?: string
  onNextClick?: () => void
  onPrevClick?: () => void
  onCloseClick?: () => void
}

export interface DriveStep {
  element?: string | HTMLElement | (() => HTMLElement | null)
  popover?: PopoverConfig
  disableActiveInteraction?: boolean
}

export interface DriverConfig {
  steps?: DriveStep[]
  showProgress?: boolean
  progressText?: string
  nextBtnText?: string
  prevBtnText?: string
  doneBtnText?: string
  closeBtnText?: string
  allowClose?: boolean
  overlayColor?: string
  overlayOpacity?: number
  stagePadding?: number
  stageRadius?: number
  animate?: boolean
  onDestroyed?: () => void
  onHighlightStarted?: (element?: Element, step?: DriveStep) => void
  onHighlighted?: (element?: Element, step?: DriveStep) => void
  onDeselected?: (element?: Element, step?: DriveStep) => void
}

export interface DriverInstance {
  drive: (stepIndex?: number) => void
  moveNext: () => void
  movePrevious: () => void
  hasNextStep: () => boolean
  hasPreviousStep: () => boolean
  isFirstStep: () => boolean
  isLastStep: () => boolean
  getActiveStep: () => DriveStep | null
  getActiveIndex: () => number
  getActiveElement: () => Element | null
  getPopover: () => HTMLElement | null
  destroy: () => void
  reset: () => void
  setConfig: (config: Partial<DriverConfig>) => void
  refresh: () => void
}

export function driver(config: DriverConfig = {}): DriverInstance {
  let currentConfig: DriverConfig = {
    steps: [],
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Got it ✓',
    closeBtnText: '✕',
    allowClose: true,
    overlayColor: '#0f172a',
    overlayOpacity: 0.65,
    stagePadding: 6,
    stageRadius: 8,
    animate: true,
    ...config,
  }

  let activeIndex = -1
  let overlayEl: SVGSVGElement | null = null
  let popoverEl: HTMLElement | null = null
  let activeElement: HTMLElement | null = null
  let resizeObserver: ResizeObserver | null = null
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null

  function createOverlay(): SVGSVGElement {
    if (overlayEl) return overlayEl

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'driver-overlay')
    svg.style.position = 'fixed'
    svg.style.top = '0'
    svg.style.left = '0'
    svg.style.width = '100vw'
    svg.style.height = '100vh'
    svg.style.zIndex = '999998'
    svg.style.pointerEvents = 'auto'
    svg.style.transition = currentConfig.animate ? 'opacity 0.2s ease-in-out' : 'none'

    svg.innerHTML = `
      <defs>
        <mask id="driver-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <rect id="driver-cutout" x="0" y="0" width="0" height="0" rx="${currentConfig.stageRadius}" fill="black" />
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="${currentConfig.overlayColor}" fill-opacity="${currentConfig.overlayOpacity}" mask="url(#driver-mask)" />
    `

    if (currentConfig.allowClose) {
      svg.addEventListener('click', (e) => {
        if (e.target === svg || (e.target as HTMLElement).tagName === 'rect') {
          destroy()
        }
      })
    }

    document.body.appendChild(svg)
    overlayEl = svg
    return svg
  }

  function updateCutout(rect: DOMRect | null) {
    if (!overlayEl) return
    const cutout = overlayEl.querySelector('#driver-cutout') as SVGRectElement | null
    if (!cutout) return

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      cutout.setAttribute('x', '0')
      cutout.setAttribute('y', '0')
      cutout.setAttribute('width', '0')
      cutout.setAttribute('height', '0')
      return
    }

    const padding = currentConfig.stagePadding ?? 6
    const x = Math.max(0, rect.left - padding)
    const y = Math.max(0, rect.top - padding)
    const width = rect.width + padding * 2
    const height = rect.height + padding * 2

    cutout.setAttribute('x', String(x))
    cutout.setAttribute('y', String(y))
    cutout.setAttribute('width', String(width))
    cutout.setAttribute('height', String(height))
  }

  function resolveElement(target?: string | HTMLElement | (() => HTMLElement | null)): HTMLElement | null {
    if (!target) return null
    if (typeof target === 'string') {
      return document.querySelector<HTMLElement>(target)
    }
    if (typeof target === 'function') {
      return target()
    }
    return target
  }

  function positionPopover(popover: HTMLElement, targetRect: DOMRect | null, side: string = 'bottom', align: string = 'start') {
    const margin = 12
    const popoverRect = popover.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    if (!targetRect || side === 'over' || (targetRect.width === 0 && targetRect.height === 0)) {
      // Center in screen
      popover.style.top = `${Math.max(20, (viewportH - popoverRect.height) / 2)}px`
      popover.style.left = `${Math.max(20, (viewportW - popoverRect.width) / 2)}px`
      popover.classList.remove('has-arrow')
      return
    }

    let top = 0
    let left = 0

    // Compute side
    if (side === 'bottom') {
      top = targetRect.bottom + margin
      if (top + popoverRect.height > viewportH - 10) {
        top = Math.max(10, targetRect.top - popoverRect.height - margin)
      }
    } else if (side === 'top') {
      top = targetRect.top - popoverRect.height - margin
      if (top < 10) {
        top = targetRect.bottom + margin
      }
    } else if (side === 'left') {
      left = targetRect.left - popoverRect.width - margin
      top = targetRect.top
      if (left < 10) {
        left = targetRect.right + margin
      }
    } else if (side === 'right') {
      left = targetRect.right + margin
      top = targetRect.top
      if (left + popoverRect.width > viewportW - 10) {
        left = Math.max(10, targetRect.left - popoverRect.width - margin)
      }
    }

    // Compute align
    if (side === 'top' || side === 'bottom') {
      if (align === 'start') {
        left = targetRect.left
      } else if (align === 'center') {
        left = targetRect.left + (targetRect.width - popoverRect.width) / 2
      } else if (align === 'end') {
        left = targetRect.right - popoverRect.width
      }
    } else if (side === 'left' || side === 'right') {
      if (align === 'center') {
        top = targetRect.top + (targetRect.height - popoverRect.height) / 2
      } else if (align === 'end') {
        top = targetRect.bottom - popoverRect.height
      }
    }

    // Clamp inside viewport
    left = Math.max(16, Math.min(left, viewportW - popoverRect.width - 16))
    top = Math.max(16, Math.min(top, viewportH - popoverRect.height - 16))

    popover.style.top = `${top}px`
    popover.style.left = `${left}px`
  }

  function renderPopover(step: DriveStep): HTMLElement {
    if (popoverEl) popoverEl.remove()

    const p = step.popover || {}
    const totalSteps = currentConfig.steps?.length || 1
    const currentStepNum = activeIndex + 1

    const popover = document.createElement('div')
    popover.className = 'driver-popover'
    popover.style.position = 'fixed'
    popover.style.zIndex = '999999'

    const progressText = (currentConfig.progressText || '{{current}} of {{total}}')
      .replace('{{current}}', String(currentStepNum))
      .replace('{{total}}', String(totalSteps))

    const isFirst = activeIndex === 0
    const isLast = activeIndex === totalSteps - 1

    popover.innerHTML = `
      <div class="driver-popover-content">
        <div class="driver-popover-header">
          ${p.title ? `<h3 class="driver-popover-title">${p.title}</h3>` : ''}
          ${currentConfig.allowClose ? `<button class="driver-popover-close" type="button" aria-label="Close">${p.closeBtnText || currentConfig.closeBtnText || '✕'}</button>` : ''}
        </div>
        ${p.description ? `<div class="driver-popover-description">${p.description}</div>` : ''}
        <div class="driver-popover-footer">
          ${currentConfig.showProgress && totalSteps > 1 ? `<span class="driver-popover-progress">${progressText}</span>` : '<span></span>'}
          <div class="driver-popover-btn-group">
            ${!isFirst ? `<button class="driver-btn driver-btn-prev" type="button">${p.prevBtnText || currentConfig.prevBtnText || '← Back'}</button>` : ''}
            <button class="driver-btn driver-btn-next ${isLast ? 'driver-btn-done' : ''}" type="button">
              ${isLast ? (p.doneBtnText || currentConfig.doneBtnText || 'Got it ✓') : (p.nextBtnText || currentConfig.nextBtnText || 'Next →')}
            </button>
          </div>
        </div>
      </div>
    `

    // Attach listeners
    const closeBtn = popover.querySelector('.driver-popover-close')
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (p.onCloseClick) p.onCloseClick()
        destroy()
      })
    }

    const prevBtn = popover.querySelector('.driver-btn-prev')
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (p.onPrevClick) p.onPrevClick()
        movePrevious()
      })
    }

    const nextBtn = popover.querySelector('.driver-btn-next')
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (isLast) {
          if (p.onNextClick) p.onNextClick()
          destroy()
        } else {
          if (p.onNextClick) p.onNextClick()
          moveNext()
        }
      })
    }

    document.body.appendChild(popover)
    popoverEl = popover
    return popover
  }

  function highlight(index: number) {
    const steps = currentConfig.steps || []
    if (index < 0 || index >= steps.length) {
      destroy()
      return
    }

    if (activeElement && currentConfig.onDeselected) {
      currentConfig.onDeselected(activeElement, steps[activeIndex])
    }

    activeIndex = index
    const step = steps[index]
    const el = resolveElement(step.element)
    activeElement = el

    if (currentConfig.onHighlightStarted) {
      currentConfig.onHighlightStarted(el ?? undefined, step)
    }

    createOverlay()

    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      el.classList.add('driver-highlighted-element')
    }

    const targetRect = el ? el.getBoundingClientRect() : null
    updateCutout(targetRect)

    const popover = renderPopover(step)
    positionPopover(popover, targetRect, step.popover?.side || 'bottom', step.popover?.align || 'start')

    if (currentConfig.onHighlighted) {
      currentConfig.onHighlighted(el ?? undefined, step)
    }

    if (resizeObserver) resizeObserver.disconnect()
    resizeObserver = new ResizeObserver(() => {
      if (activeElement) {
        const rect = activeElement.getBoundingClientRect()
        updateCutout(rect)
        if (popoverEl) {
          positionPopover(popoverEl, rect, step.popover?.side || 'bottom', step.popover?.align || 'start')
        }
      }
    })
    if (el) resizeObserver.observe(el)
    resizeObserver.observe(document.body)
  }

  function drive(stepIndex: number = 0) {
    destroy()
    keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && currentConfig.allowClose) {
        destroy()
      } else if (e.key === 'ArrowRight') {
        moveNext()
      } else if (e.key === 'ArrowLeft') {
        movePrevious()
      }
    }
    window.addEventListener('keydown', keydownHandler)
    window.addEventListener('resize', refresh)
    highlight(stepIndex)
  }

  function moveNext() {
    const steps = currentConfig.steps || []
    if (activeIndex + 1 < steps.length) {
      highlight(activeIndex + 1)
    } else {
      destroy()
    }
  }

  function movePrevious() {
    if (activeIndex - 1 >= 0) {
      highlight(activeIndex - 1)
    }
  }

  function hasNextStep(): boolean {
    return activeIndex + 1 < (currentConfig.steps?.length || 0)
  }

  function hasPreviousStep(): boolean {
    return activeIndex > 0
  }

  function isFirstStep(): boolean {
    return activeIndex === 0
  }

  function isLastStep(): boolean {
    return activeIndex === (currentConfig.steps?.length || 0) - 1
  }

  function getActiveStep(): DriveStep | null {
    return currentConfig.steps?.[activeIndex] || null
  }

  function getActiveIndex(): number {
    return activeIndex
  }

  function getActiveElement(): Element | null {
    return activeElement
  }

  function getPopover(): HTMLElement | null {
    return popoverEl
  }

  function refresh() {
    if (activeIndex >= 0) {
      const step = currentConfig.steps?.[activeIndex]
      if (step) {
        const targetRect = activeElement ? activeElement.getBoundingClientRect() : null
        updateCutout(targetRect)
        if (popoverEl) {
          positionPopover(popoverEl, targetRect, step.popover?.side || 'bottom', step.popover?.align || 'start')
        }
      }
    }
  }

  function destroy() {
    if (activeElement) {
      activeElement.classList.remove('driver-highlighted-element')
    }
    if (popoverEl) {
      popoverEl.remove()
      popoverEl = null
    }
    if (overlayEl) {
      overlayEl.remove()
      overlayEl = null
    }
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler)
      keydownHandler = null
    }
    window.removeEventListener('resize', refresh)

    const wasActive = activeIndex >= 0
    activeIndex = -1
    activeElement = null

    if (wasActive && currentConfig.onDestroyed) {
      currentConfig.onDestroyed()
    }
  }

  function setConfig(newConfig: Partial<DriverConfig>) {
    currentConfig = { ...currentConfig, ...newConfig }
  }

  return {
    drive,
    moveNext,
    movePrevious,
    hasNextStep,
    hasPreviousStep,
    isFirstStep,
    isLastStep,
    getActiveStep,
    getActiveIndex,
    getActiveElement,
    getPopover,
    destroy,
    reset: destroy,
    setConfig,
    refresh,
  }
}
