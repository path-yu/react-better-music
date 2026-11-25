import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { GripVertical } from 'lucide-react'
import { cn } from '../../lib/format'
import {
  applyLocalOrder,
  readLocalOrder,
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

/**
 * Vertical list whose order can be changed by dragging a row's handle. The
 * order is saved locally by id, so it survives restarts and never touches the
 * API.
 *
 * Pointer events, not HTML5 drag-and-drop: during a native drag the browser
 * swallows wheel events, so the list could not be scrolled with the wheel while
 * a row was held. A pointer session keeps the wheel working and lets the list
 * auto-scroll near its edges.
 */
export function ReorderableList<T>({
  items,
  getId,
  storageKey,
  renderItem,
  className,
}: ReorderableListProps<T>) {
  const { i18n } = useLingui()
  const [order, setOrder] = useState<string[]>(() => readLocalOrder(storageKey))
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const listRef = useRef<HTMLUListElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const startRef = useRef<{ id: string; x: number; y: number } | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const overIdRef = useRef<string | null>(null)
  const draggingRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  // Switching tabs swaps the storage key and therefore the order.
  useEffect(() => {
    setOrder(readLocalOrder(storageKey))
    setDragId(null)
    setOverId(null)
    overIdRef.current = null
  }, [storageKey])

  const ordered = useMemo(
    () => applyLocalOrder(items, order, getId),
    [items, order, getId],
  )

  const move = useCallback(
    (fromId: string, toId: string) => {
      const from = ordered.findIndex((item) => getId(item) === fromId)
      const to = ordered.findIndex((item) => getId(item) === toId)
      if (from < 0 || to < 0 || from === to) return
      const next = [...ordered]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      const ids = next.map(getId)
      setOrder(ids)
      writeLocalOrder(storageKey, ids)
    },
    [ordered, getId, storageKey],
  )

  /** Row under the pointer, used as the drop target. */
  const targetAt = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y)
    const row = element?.closest<HTMLElement>('[data-reorder-id]')
    return row?.dataset.reorderId ?? null
  }

  const stopAutoScroll = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  const autoScroll = () => {
    const container = scrollerRef.current
    const pointer = pointerRef.current
    if (container && pointer) {
      const rect = container.getBoundingClientRect()
      if (pointer.y < rect.top + AUTOSCROLL_EDGE) {
        container.scrollTop -= AUTOSCROLL_SPEED
      } else if (pointer.y > rect.bottom - AUTOSCROLL_EDGE) {
        container.scrollTop += AUTOSCROLL_SPEED
      }
    }
    rafRef.current = requestAnimationFrame(autoScroll)
  }

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    startRef.current = { id, x: event.clientX, y: event.clientY }
    pointerRef.current = { x: event.clientX, y: event.clientY }
    draggingRef.current = false
  }

  const handleMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = startRef.current
    if (!start) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    if (!draggingRef.current) {
      if (Math.abs(event.clientY - start.y) < DRAG_THRESHOLD) return
      draggingRef.current = true
      // Nearest scrollable ancestor drives both auto-scroll and wheel sync.
      let parent = listRef.current?.parentElement ?? null
      while (parent && parent !== document.body) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) break
        parent = parent.parentElement
      }
      scrollerRef.current = parent
      setDragId(start.id)
      setOverId(start.id)
      overIdRef.current = start.id
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'grabbing'
      rafRef.current = requestAnimationFrame(autoScroll)
    }
    const target = targetAt(event.clientX, event.clientY)
    if (target && target !== overIdRef.current) {
      overIdRef.current = target
      setOverId(target)
    }
  }

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = startRef.current
    if (!start) return
    const wasDragging = draggingRef.current
    const target = overIdRef.current
    startRef.current = null
    draggingRef.current = false
    pointerRef.current = null
    overIdRef.current = null
    stopAutoScroll()
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    setDragId(null)
    setOverId(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (wasDragging && target && target !== start.id) move(start.id, target)
  }

  // While dragging, keep the drop target in sync with the wheel: the page
  // scrolls under a stationary pointer, so no pointermove fires.
  useEffect(() => {
    if (!dragId) return
    const container = scrollerRef.current
    if (!container) return
    const sync = () => {
      const pointer = pointerRef.current
      if (!pointer) return
      const target = targetAt(pointer.x, pointer.y)
      if (target && target !== overIdRef.current) {
        overIdRef.current = target
        setOverId(target)
      }
    }
    container.addEventListener('scroll', sync, { passive: true })
    return () => container.removeEventListener('scroll', sync)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId])

  useEffect(() => stopAutoScroll, [])

  return (
    <ul ref={listRef} className={cn('space-y-1', className)}>
      {ordered.map((item) => {
        const id = getId(item)
        const dragging = dragId === id
        return (
          <li
            key={id}
            data-reorder-id={id}
            className={cn(
              'rounded-[10px] transition-colors',
              dragId && overId === id && dragId !== id
                ? 'bg-accent/10 ring-1 ring-accent/40'
                : undefined,
              dragging ? 'opacity-50' : undefined,
            )}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={i18n._(msg`拖动排序`)}
                onPointerDown={(event) => startDrag(event, id)}
                onPointerMove={handleMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                // Long-press text selection / scrolling would fight the drag.
                className="pressable shrink-0 touch-none cursor-grab text-ink-4 active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1">{renderItem(item, dragging)}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
