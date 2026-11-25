import { useEffect, useMemo, useState, type ReactNode } from 'react'
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

/**
 * Vertical list whose order can be changed by dragging a row. The order is
 * saved locally by id, so it survives restarts and never touches the API.
 * HTML5 drag events: desktop / trackpad; the rows stay clickable.
 */
export function ReorderableList<T>({
  items,
  getId,
  storageKey,
  renderItem,
  className,
}: ReorderableListProps<T>) {
  const [order, setOrder] = useState<string[]>(() => readLocalOrder(storageKey))
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  // Switching tabs swaps the storage key and therefore the order.
  useEffect(() => {
    setOrder(readLocalOrder(storageKey))
    setDragId(null)
    setOverId(null)
  }, [storageKey])

  const ordered = useMemo(
    () => applyLocalOrder(items, order, getId),
    [items, order, getId],
  )

  const move = (fromId: string, toId: string) => {
    const from = ordered.findIndex((item) => getId(item) === fromId)
    const to = ordered.findIndex((item) => getId(item) === toId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const ids = next.map(getId)
    setOrder(ids)
    writeLocalOrder(storageKey, ids)
  }

  return (
    <ul className={cn('space-y-1', className)}>
      {ordered.map((item) => {
        const id = getId(item)
        const dragging = dragId === id
        return (
          <li
            key={id}
            draggable
            onDragStart={(event) => {
              setDragId(id)
              event.dataTransfer.effectAllowed = 'move'
              // Firefox requires data to be set for a drag to start.
              event.dataTransfer.setData('text/plain', id)
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            onDragOver={(event) => {
              if (!dragId) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (overId !== id) setOverId(id)
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (dragId && dragId !== id) move(dragId, id)
              setDragId(null)
              setOverId(null)
            }}
            className={cn(
              'rounded-[10px] transition-colors',
              dragId && overId === id && dragId !== id
                ? 'bg-accent/10 ring-1 ring-accent/40'
                : undefined,
              dragging ? 'opacity-50' : undefined,
            )}
          >
            <div className="flex items-center gap-2">
              <GripVertical
                className="h-4 w-4 shrink-0 cursor-grab text-ink-4"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">{renderItem(item, dragging)}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
