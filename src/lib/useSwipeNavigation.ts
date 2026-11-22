import { useEffect, useRef } from 'react'

/** -1 = previous tab, 1 = next tab, 0 = not a swipe. */
export type SwipeStep = -1 | 0 | 1

export const SWIPE_MIN_DISTANCE = 56
export const SWIPE_MAX_DURATION = 800
/** Horizontal travel must clearly beat vertical, or it is a scroll. */
export const SWIPE_DOMINANCE = 1.6
export const WHEEL_TRIGGER = 90
const WHEEL_QUIET_MS = 220

/**
 * Touch / pen swipe. Finger moving left (dx < 0) reveals the next tab, like
 * every mobile pager.
 */
export function classifySwipe(dx: number, dy: number, ms: number): SwipeStep {
  if (ms > SWIPE_MAX_DURATION) return 0
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return 0
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return 0
  return dx < 0 ? 1 : -1
}

/** Trackpad two-finger swipe, accumulated over one gesture. */
export function classifyWheel(accumulatedX: number): SwipeStep {
  if (Math.abs(accumulatedX) < WHEEL_TRIGGER) return 0
  return accumulatedX > 0 ? 1 : -1
}

/** Neighbouring tab; stops at both ends instead of wrapping around. */
export function stepTab<T>(order: readonly T[], current: T, step: SwipeStep): T {
  const index = order.indexOf(current)
  if (index < 0 || step === 0) return current
  const next = index + step
  return next < 0 || next >= order.length ? current : order[next]
}

/**
 * Controls that own horizontal movement themselves: sliders, text fields,
 * the queue drag handle, anything draggable, or opted out explicitly.
 */
const OWN_GESTURE =
  'input, textarea, select, [role="slider"], .seek-slider, .np-queue-drag, [draggable="true"], [data-no-swipe]'

function ownsHorizontalGesture(target: EventTarget | null, root: HTMLElement) {
  if (!(target instanceof Element)) return true
  if (target.closest(OWN_GESTURE)) return true
  // A horizontally scrollable strip inside the view keeps its own swipe.
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
  }
  return false
}

/**
 * Horizontal swipe navigation for a tabbed area: touch / pen swipes and
 * trackpad two-finger swipes. Plain mouse drags are ignored so text selection,
 * drag-to-reorder and sliders keep working.
 */
export function useSwipeNavigation(
  /** Pass the element itself (e.g. from a state callback ref) so listeners
      attach whenever it mounts, also after the first render. */
  root: HTMLElement | null,
  options: { enabled: () => boolean; onSwipe: (step: 1 | -1) => void },
) {
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    if (!root) return

    let start: { id: number; x: number; y: number; t: number } | null = null
    let wheelX = 0
    let wheelLocked = false
    let wheelTimer: ReturnType<typeof setTimeout> | undefined

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return
      if (!latest.current.enabled() || ownsHorizontalGesture(event.target, root)) return
      start = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return
      const step = classifySwipe(
        event.clientX - start.x,
        event.clientY - start.y,
        event.timeStamp - start.t,
      )
      start = null
      if (step !== 0) latest.current.onSwipe(step)
    }
    // A vertical pan hands the pointer to the browser's scroller.
    const onPointerCancel = () => {
      start = null
    }

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !latest.current.enabled()) return
      // Trackpad inertia keeps firing after a trigger: wait for a quiet gap.
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => {
        wheelX = 0
        wheelLocked = false
      }, WHEEL_QUIET_MS)
      if (wheelLocked) return
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * SWIPE_DOMINANCE) return
      if (ownsHorizontalGesture(event.target, root)) return
      wheelX += event.deltaX
      const step = classifyWheel(wheelX)
      if (step === 0) return
      wheelLocked = true
      wheelX = 0
      latest.current.onSwipe(step)
    }

    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('pointerup', onPointerUp)
    root.addEventListener('pointercancel', onPointerCancel)
    root.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      clearTimeout(wheelTimer)
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('pointerup', onPointerUp)
      root.removeEventListener('pointercancel', onPointerCancel)
      root.removeEventListener('wheel', onWheel)
    }
  }, [root])
}
