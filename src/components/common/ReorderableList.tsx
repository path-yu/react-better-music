import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { GripVertical } from 'lucide-react'
import { cn } from '../../lib/format'
import {
  applyLocalOrder,
  useLocalOrder,
  writeLocalOrder,
} from '../../lib/localOrder'

interface ReorderableListProps<T> {
  items: T[]
  getId: (item: T) => string
  /** localStorage key; every list keeps its own order. */
  storageKey: string
  /** One row's content (cover, title, trailing meta). */
  renderItem: (item: T, dragging: boolean) => ReactNode
  className?: string
}

/** Distance before a press turns into a drag, so clicks still work. */
const DRAG_THRESHOLD = 4
/** Pixels from the scroll container's edge where auto-scroll kicks in. */
const AUTOSCROLL_EDGE = 72
const AUTOSCROLL_SPEED = 14
/** Time the dropped row takes to glide into its slot (matches the CSS). */
const SETTLE_MS = 200
/** Scale of the row being carried. */
const LIFT_SCALE = 1.02

interface RowBox {
  id: string
  top: number
  height: number
}

interface DragSession {
  id: string
  pointerId: number
  handle: HTMLElement
  /** Index of the carried row when the drag started. */
  from: number
  /** Index it would land on if dropped now. */
  to: number
  startY: number
  lastY: number
  startScroll: number
  /** Row boxes measured when the drag started, in list order. */
  rows: RowBox[]
  /** Distance the other rows move to make room: carried row + gap. */
  slot: number
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function findScroller(start: HTMLElement | null): HTMLElement {
  let node = start
  while (node && node !== document.body) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node
    node = node.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

/** Drop drag transforms; without animation they vanish in the same frame. */
function resetRows(rows: Iterable<HTMLElement>, animate: boolean) {
  const list = [...rows]
  for (const row of list) {
    if (!animate) row.style.transition = 'none'
    row.style.transform = ''
  }
  if (animate || !list.length) return
  // Commit the instant reset before transitions come back.
  void list[0].offsetHeight
  for (const row of list) row.style.transition = ''
}

/**
 * Vertical list whose order can be changed by dragging a row's handle, like
 * a macOS / Music sidebar: the carried row lifts and follows the pointer, the
 * other rows slide out of its way, and on release it glides into the gap.
 * Esc cancels; with the handle focused, ↑ / ↓ move the row one place. The
 * order is saved locally by id, so it survives restarts and never touches
 * the API.
 *
 * Pointer events, not HTML5 drag-and-drop: during a native drag the browser
 * swallows wheel events, so the list could not be scrolled with the wheel while
 * a row was held. A pointer session keeps the wheel working and lets the list
 * auto-scroll near its edges. Motion is written to the DOM directly, so
 * dragging never re-renders the rows.
 */
export function ReorderableList<T>({
  items,
  getId,
  storageKey,
  renderItem,
  className,
}: ReorderableListProps<T>) {
  const { i18n } = useLingui()
  // Shared with the sidebar: a drop here re-sorts its groups at once.
  const order = useLocalOrder(storageKey)
  const [dragId, setDragId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const listRef = useRef<HTMLUListElement>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const pendingRef = useRef<{ id: string; pointerId: number; y: number } | null>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  /** The next order commit must drop the drag transforms before paint. */
  const resetAfterCommitRef = useRef(false)
  /** Row tops before a keyboard move, for a FLIP slide. */
  const flipRef = useRef<Map<string, number> | null>(null)
  /** Handle to refocus after a keyboard move re-inserted its row. */
  const refocusRef = useRef<string | null>(null)

  const ordered = useMemo(
    () => applyLocalOrder(items, order, getId),
    [items, order, getId],
  )

  const commit = useCallback(
    (ids: string[]) => {
      writeLocalOrder(storageKey, ids)
    },
    [storageKey],
  )

  /** Stop any drag or settle without committing (unmount, list switch). */
  const teardown = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = null
    const session = sessionRef.current
    if (session?.handle.hasPointerCapture(session.pointerId)) {
      session.handle.releasePointerCapture(session.pointerId)
    }
    sessionRef.current = null
    pendingRef.current = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    delete listRef.current?.dataset.reordering
    for (const row of rowRefs.current.values()) {
      delete row.dataset.lifted
      delete row.dataset.settling
    }
    resetRows(rowRefs.current.values(), false)
  }

  // Switching tabs swaps the storage key and therefore the order.
  useEffect(() => {
    teardown()
    setDragId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => teardown, [])

  // Runs after every commit of the order: settle the DOM before paint.
  useLayoutEffect(() => {
    const rows = rowRefs.current
    if (resetAfterCommitRef.current) {
      resetAfterCommitRef.current = false
      for (const row of rows.values()) delete row.dataset.settling
      resetRows(rows.values(), false)
    }
    const flip = flipRef.current
    if (flip) {
      flipRef.current = null
      const moved: HTMLElement[] = []
      for (const [id, row] of rows) {
        const before = flip.get(id)
        const delta = before === undefined ? 0 : before - row.offsetTop
        if (!delta) continue
        row.style.transition = 'none'
        row.style.transform = `translate3d(0, ${delta}px, 0)`
        moved.push(row)
      }
      if (moved.length) {
        void moved[0].offsetHeight
        for (const row of moved) {
          row.style.transition = ''
          row.style.transform = ''
        }
      }
    }
    const focusId = refocusRef.current
    if (focusId) {
      refocusRef.current = null
      const row = rows.get(focusId)
      row?.querySelector<HTMLElement>('[data-reorder-handle]')?.focus({ preventScroll: true })
      row?.scrollIntoView({ block: 'nearest' })
    }
  }, [ordered])

  /* ------------------------------ drag layout ----------------------------- */

  const currentOffset = (session: DragSession) => {
    const scroll = scrollerRef.current?.scrollTop ?? 0
    const raw = session.lastY - session.startY + (scroll - session.startScroll)
    const { rows, from } = session
    const carried = rows[from]
    const first = rows[0]
    const last = rows[rows.length - 1]
    // Keep the carried row within the list, like a sidebar.
    const min = first.top - carried.top
    const max = last.top + last.height - carried.top - carried.height
    return Math.min(max, Math.max(min, raw))
  }

  const layout = () => {
    const session = sessionRef.current
    if (!session) return
    const offset = currentOffset(session)
    const { rows, from, slot } = session
    const carried = rows[from]
    const center = carried.top + carried.height / 2 + offset
    let to = from
    for (let index = from + 1; index < rows.length; index += 1) {
      if (center > rows[index].top + rows[index].height / 2) to = index
    }
    for (let index = from - 1; index >= 0; index -= 1) {
      if (center < rows[index].top + rows[index].height / 2) to = index
    }
    session.to = to
    rows.forEach((box, index) => {
      const row = rowRefs.current.get(box.id)
      if (!row) return
      if (index === from) {
        row.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0) scale(${LIFT_SCALE})`
        return
      }
      const shift =
        from < index && index <= to ? -slot : to <= index && index < from ? slot : 0
      row.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : ''
    })
  }

  /** Auto-scroll near the edges; also re-lays out after wheel scrolling. */
  const tick = () => {
    const session = sessionRef.current
    const scroller = scrollerRef.current
    if (!session || !scroller) {
      rafRef.current = null
      return
    }
    const rect =
      scroller === document.scrollingElement
        ? { top: 0, bottom: window.innerHeight }
        : scroller.getBoundingClientRect()
    if (session.lastY < rect.top + AUTOSCROLL_EDGE) {
      scroller.scrollTop -= AUTOSCROLL_SPEED
    } else if (session.lastY > rect.bottom - AUTOSCROLL_EDGE) {
      scroller.scrollTop += AUTOSCROLL_SPEED
    }
    layout()
    rafRef.current = requestAnimationFrame(tick)
  }

  const beginDrag = (pending: { id: string; pointerId: number; y: number }, handle: HTMLElement) => {
    const rows: RowBox[] = []
    for (const item of ordered) {
      const id = getId(item)
      const row = rowRefs.current.get(id)
      if (row) rows.push({ id, top: row.offsetTop, height: row.offsetHeight })
    }
    const from = rows.findIndex((box) => box.id === pending.id)
    if (from < 0) return
    const next = rows[from + 1] ?? null
    const previous = rows[from - 1] ?? null
    const gap = next
      ? next.top - rows[from].top - rows[from].height
      : previous
        ? rows[from].top - previous.top - previous.height
        : 0
    const scroller = findScroller(listRef.current?.parentElement ?? null)
    scrollerRef.current = scroller
    sessionRef.current = {
      id: pending.id,
      pointerId: pending.pointerId,
      handle,
      from,
      to: from,
      startY: pending.y,
      lastY: pending.y,
      startScroll: scroller.scrollTop,
      rows,
      slot: rows[from].height + Math.max(0, gap),
    }
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    rowRefs.current.get(pending.id)?.setAttribute('data-lifted', '')
    if (listRef.current) listRef.current.dataset.reordering = ''
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
    setDragId(pending.id)
    rafRef.current = requestAnimationFrame(tick)
  }

  /** Release the carried row: glide it into its slot, then commit. */
  const finishDrag = (drop: boolean) => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    pendingRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (session.handle.hasPointerCapture(session.pointerId)) {
      session.handle.releasePointerCapture(session.pointerId)
    }
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    delete listRef.current?.dataset.reordering
    setDragId(null)

    const { rows, from, id } = session
    const to = drop ? session.to : from
    const carried = rowRefs.current.get(id)
    if (carried) {
      delete carried.dataset.lifted
      carried.dataset.settling = ''
    }
    const settle = prefersReducedMotion() ? 0 : SETTLE_MS

    if (to === from) {
      // Nothing moved (or Esc): everything slides back home.
      resetRows(rowRefs.current.values(), true)
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null
        if (carried) delete carried.dataset.settling
      }, settle)
      return
    }

    // Final top of the carried row once it sits at `to`.
    const finalTop =
      to > from
        ? rows[to].top + rows[to].height - rows[from].height
        : rows[to].top
    if (carried) {
      carried.style.transform = `translate3d(0, ${finalTop - rows[from].top}px, 0)`
    }
    const ids = rows.map((box) => box.id)
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      resetAfterCommitRef.current = true
      commit(ids)
    }, settle)
  }

  /* ------------------------------- handlers ------------------------------- */

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || sessionRef.current || settleTimerRef.current !== null) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    pendingRef.current = { id, pointerId: event.pointerId, y: event.clientY }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pending = pendingRef.current
    if (pending && !sessionRef.current) {
      if (Math.abs(event.clientY - pending.y) < DRAG_THRESHOLD) return
      beginDrag(pending, event.currentTarget)
    }
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    session.lastY = event.clientY
    layout()
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (sessionRef.current) {
      finishDrag(event.type === 'pointerup')
      return
    }
    // A plain click on the handle: no drag happened.
    pendingRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // Esc puts the carried row back where it was.
  useEffect(() => {
    if (!dragId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finishDrag(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId])

  /** ↑ / ↓ on a focused handle move its row one place. */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    if (sessionRef.current || settleTimerRef.current !== null) return
    const ids = ordered.map(getId)
    const from = ids.indexOf(id)
    const to = from + (event.key === 'ArrowUp' ? -1 : 1)
    if (from < 0 || to < 0 || to >= ids.length) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    if (!prefersReducedMotion()) {
      flipRef.current = new Map(
        [...rowRefs.current].map(([rowId, row]) => [rowId, row.offsetTop]),
      )
    }
    refocusRef.current = id
    commit(ids)
    const position = to + 1
    const total = ids.length
    setAnnouncement(i18n._(msg`已移到第 ${position} 位，共 ${total} 项`))
  }

  return (
    <>
      <ul ref={listRef} className={cn('reorder-list space-y-1', className)}>
        {ordered.map((item) => {
          const id = getId(item)
          const dragging = dragId === id
          return (
            <li
              key={id}
              ref={(node) => {
                if (node) rowRefs.current.set(id, node)
                else rowRefs.current.delete(id)
              }}
              data-reorder-id={id}
              className="reorder-row"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-reorder-handle=""
                  aria-label={i18n._(msg`拖动排序，或按 ↑ ↓ 键移动`)}
                  onPointerDown={(event) => handlePointerDown(event, id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerEnd}
                  onPointerCancel={handlePointerEnd}
                  onKeyDown={(event) => handleKeyDown(event, id)}
                  // Long-press text selection / scrolling would fight the drag.
                  className="reorder-handle pressable shrink-0"
                >
                  <GripVertical className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="min-w-0 flex-1">{renderItem(item, dragging)}</div>
              </div>
            </li>
          )
        })}
      </ul>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  )
}
