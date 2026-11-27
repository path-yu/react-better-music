import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual'

/*
 * Drag-to-reorder for the virtualized play queue on the song page, with the
 * same feel as the library lists (components/common/ReorderableList.tsx):
 * the carried row lifts and follows the pointer, the rows it passes slide
 * out of its way, and on release it glides into the gap. Esc cancels; with
 * the grip focused, ↑ / ↓ move a song one place.
 *
 * Rows are absolutely positioned by the virtualizer (`transform` set by
 * React), so motion goes through CSS variables the row's transform reads:
 * `--queue-shift` (px) and `--queue-scale`. React never touches those, so a
 * scroll re-render cannot undo the drag, and rows the virtualizer mounts
 * mid-drag pick their shift up on the next frame.
 */

/** Distance before a press on the grip turns into a drag. */
const DRAG_THRESHOLD = 4
const AUTOSCROLL_EDGE = 64
const AUTOSCROLL_SPEED = 12
/** Matches the `.np-queue-list[data-reordering]` transition in styles.css. */
const SETTLE_MS = 200
const LIFT_SCALE = 1.02

interface Session {
  from: number
  to: number
  pointerId: number
  handle: HTMLElement
  startY: number
  lastY: number
  startScroll: number
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useQueueReorder({
  scrollRef,
  rowSize,
  count,
  enabled,
  onMove,
  describeMove,
}: {
  /** The list's scroll container (also the element holding the rows). */
  scrollRef: RefObject<HTMLElement | null>
  /** Fixed height of one virtual row. */
  rowSize: number
  count: number
  /** False while the queue is filtered: positions are not queue indices. */
  enabled: boolean
  onMove: (from: number, to: number) => void
  /** Screen-reader text after a keyboard move (1-based position). */
  describeMove: (position: number, total: number) => string
}) {
  const sessionRef = useRef<Session | null>(null)
  const pendingRef = useRef<{ index: number; pointerId: number; y: number } | null>(null)
  const frameRef = useRef<number | null>(null)
  const settleRef = useRef<number | null>(null)
  /** Index the virtualizer must keep mounted (the carried row). */
  const pinnedRef = useRef<number | null>(null)
  /** Applied after a keyboard move once React re-rendered the rows. */
  const keyboardRef = useRef<{ from: number; to: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // Bumped after a keyboard move so the layout effect below runs.
  const [moveToken, setMoveToken] = useState(0)

  const rows = () =>
    Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>('[data-queue-pos]') ?? [],
    )

  const clearRows = (animate: boolean) => {
    const list = rows()
    for (const row of list) {
      if (!animate) row.style.transition = 'none'
      row.style.removeProperty('--queue-shift')
      row.style.removeProperty('--queue-scale')
      delete row.dataset.lifted
      delete row.dataset.settling
    }
    if (animate || !list.length) return
    void list[0].offsetHeight
    for (const row of list) row.style.transition = ''
  }

  const offsetOf = (session: Session) => {
    const scroll = scrollRef.current?.scrollTop ?? 0
    const raw = session.lastY - session.startY + (scroll - session.startScroll)
    // Keep the carried row inside the queue.
    return Math.min((count - 1 - session.from) * rowSize, Math.max(-session.from * rowSize, raw))
  }

  const layout = () => {
    const session = sessionRef.current
    if (!session) return
    const offset = offsetOf(session)
    const { from } = session
    const to = Math.min(count - 1, Math.max(0, Math.round(from + offset / rowSize)))
    session.to = to
    for (const row of rows()) {
      const pos = Number(row.dataset.queuePos)
      if (pos === from) {
        row.dataset.lifted = ''
        row.style.setProperty('--queue-shift', `${offset.toFixed(1)}px`)
        row.style.setProperty('--queue-scale', String(LIFT_SCALE))
        continue
      }
      const shift =
        from < pos && pos <= to ? -rowSize : to <= pos && pos < from ? rowSize : 0
      if (shift) row.style.setProperty('--queue-shift', `${shift}px`)
      else row.style.removeProperty('--queue-shift')
    }
  }

  const tick = () => {
    const session = sessionRef.current
    const scroller = scrollRef.current
    if (!session || !scroller) {
      frameRef.current = null
      return
    }
    const rect = scroller.getBoundingClientRect()
    if (session.lastY < rect.top + AUTOSCROLL_EDGE) scroller.scrollTop -= AUTOSCROLL_SPEED
    else if (session.lastY > rect.bottom - AUTOSCROLL_EDGE) scroller.scrollTop += AUTOSCROLL_SPEED
    layout()
    frameRef.current = requestAnimationFrame(tick)
  }

  const stopFrame = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  const releaseCapture = (session: Session) => {
    if (session.handle.hasPointerCapture(session.pointerId)) {
      session.handle.releasePointerCapture(session.pointerId)
    }
  }

  const finish = (drop: boolean) => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    pendingRef.current = null
    stopFrame()
    releaseCapture(session)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    setDragging(false)
    const { from } = session
    const to = drop ? session.to : from
    const carried = rows().find((row) => Number(row.dataset.queuePos) === from)
    if (carried) {
      delete carried.dataset.lifted
      carried.dataset.settling = ''
    }
    const settle = reducedMotion() ? 0 : SETTLE_MS
    if (to === from) {
      // Cancelled or dropped in place: everything slides home.
      for (const row of rows()) {
        row.style.removeProperty('--queue-shift')
        row.style.removeProperty('--queue-scale')
      }
    } else if (carried) {
      carried.style.setProperty('--queue-shift', `${(to - from) * rowSize}px`)
      carried.style.removeProperty('--queue-scale')
    }
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null
      pinnedRef.current = null
      if (to !== from) onMove(from, to)
      // Moved rows remount under new keys; clear whatever was kept.
      requestAnimationFrame(() => {
        if (!sessionRef.current) {
          clearRows(false)
          delete scrollRef.current?.dataset.reordering
        }
      })
    }, settle)
  }

  const teardown = () => {
    stopFrame()
    if (settleRef.current !== null) window.clearTimeout(settleRef.current)
    settleRef.current = null
    const session = sessionRef.current
    if (session) releaseCapture(session)
    sessionRef.current = null
    pendingRef.current = null
    pinnedRef.current = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    clearRows(false)
    delete scrollRef.current?.dataset.reordering
  }

  // Filtering the queue or leaving the list view ends any drag.
  useEffect(() => {
    if (!enabled) {
      teardown()
      setDragging(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => teardown, [])

  useEffect(() => {
    if (!dragging) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Capture phase: the song page must not close on this Esc.
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  // Keyboard move: slide the two swapped rows from their old places.
  useLayoutEffect(() => {
    const move = keyboardRef.current
    if (!move) return
    keyboardRef.current = null
    const list = rows()
    const moved = list.find((row) => Number(row.dataset.queuePos) === move.to)
    const other = list.find((row) => Number(row.dataset.queuePos) === move.from)
    moved?.querySelector<HTMLElement>('[data-queue-grip]')?.focus({ preventScroll: true })
    if (reducedMotion()) return
    const pairs: Array<[HTMLElement | undefined, number]> = [
      [moved, (move.from - move.to) * rowSize],
      [other, (move.to - move.from) * rowSize],
    ]
    const animated: HTMLElement[] = []
    for (const [row, shift] of pairs) {
      if (!row) continue
      row.style.transition = 'none'
      row.style.setProperty('--queue-shift', `${shift}px`)
      animated.push(row)
    }
    if (!animated.length) return
    if (scrollRef.current) scrollRef.current.dataset.reordering = ''
    void animated[0].offsetHeight
    for (const row of animated) {
      row.style.transition = ''
      row.style.removeProperty('--queue-shift')
    }
    const timer = window.setTimeout(() => {
      if (!sessionRef.current) delete scrollRef.current?.dataset.reordering
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveToken])

  /** Keep the carried row mounted even when it is scrolled out of view. */
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range)
    const pinned = pinnedRef.current
    if (pinned === null || indexes.includes(pinned)) return indexes
    return [...indexes, pinned].sort((a, b) => a - b)
  }, [])

  const gripProps = (index: number) => ({
    'data-queue-grip': '',
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return
      if (sessionRef.current || settleRef.current !== null) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      pendingRef.current = { index, pointerId: event.pointerId, y: event.clientY }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const pending = pendingRef.current
      if (pending && !sessionRef.current) {
        if (Math.abs(event.clientY - pending.y) < DRAG_THRESHOLD) return
        const scroller = scrollRef.current
        if (!scroller) return
        sessionRef.current = {
          from: pending.index,
          to: pending.index,
          pointerId: pending.pointerId,
          handle: event.currentTarget,
          startY: pending.y,
          lastY: pending.y,
          startScroll: scroller.scrollTop,
        }
        pinnedRef.current = pending.index
        scroller.dataset.reordering = ''
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
        setDragging(true)
        frameRef.current = requestAnimationFrame(tick)
      }
      const session = sessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      session.lastY = event.clientY
      layout()
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (sessionRef.current) {
        finish(true)
        return
      }
      pendingRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    onPointerCancel: () => {
      if (sessionRef.current) finish(false)
      pendingRef.current = null
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      event.stopPropagation()
      if (!enabled || sessionRef.current || settleRef.current !== null) return
      const to = index + (event.key === 'ArrowUp' ? -1 : 1)
      if (to < 0 || to >= count) return
      keyboardRef.current = { from: index, to }
      onMove(index, to)
      setMoveToken((value) => value + 1)
      setAnnouncement(describeMove(to + 1, count))
    },
    // A click on the grip must not play the song.
    onClick: (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation(),
  })

  return { dragging, announcement, rangeExtractor, gripProps }
}
