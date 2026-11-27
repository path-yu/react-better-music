import { useCallback, useSyncExternalStore } from 'react'

/**
 * Manual list order for locally reorderable collections (library page,
 * mirrored by the sidebar). Only ids are stored, so a renamed or re-covered
 * item keeps its position and nothing needs to touch the API.
 *
 * Writes notify subscribers, so every view of the same list (the library's
 * drag list and the sidebar groups) re-sorts at once. Other windows of the
 * app follow through the `storage` event.
 */

/** Keys shared by the library page and the sidebar. */
export const LOCAL_ORDER_KEYS = {
  /** Ids are `online-<id>` / `local-<id>`. */
  created: 'library:order:created',
  /** Ids are playlist ids. */
  saved: 'library:order:saved',
  /** Ids are album ids. */
  albums: 'library:order:albums',
} as const

const EMPTY: string[] = []
const cache = new Map<string, string[]>()
const listeners = new Map<string, Set<() => void>>()

function parse(raw: string | null): string[] {
  if (!raw) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return EMPTY
  }
}

function notify(key: string) {
  for (const listener of listeners.get(key) ?? []) listener()
}

let storageListening = false

function listenToOtherWindows() {
  if (storageListening || typeof window === 'undefined') return
  storageListening = true
  window.addEventListener('storage', (event) => {
    if (!event.key || !listeners.has(event.key)) return
    cache.set(event.key, parse(event.newValue))
    notify(event.key)
  })
}

export function readLocalOrder(key: string): string[] {
  const cached = cache.get(key)
  if (cached) return cached
  let value = EMPTY
  try {
    value = parse(localStorage.getItem(key))
  } catch {
    // Storage disabled: no saved order.
  }
  cache.set(key, value)
  return value
}

export function writeLocalOrder(key: string, ids: string[]): void {
  const next = [...ids]
  cache.set(key, next)
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // A full quota must not break dragging; the order still applies in memory.
  }
  notify(key)
}

function subscribe(key: string, listener: () => void) {
  listenToOtherWindows()
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

/** The saved order for `key`, re-rendering whenever any view changes it. */
export function useLocalOrder(key: string): string[] {
  const subscribeKey = useCallback(
    (listener: () => void) => subscribe(key, listener),
    [key],
  )
  return useSyncExternalStore(
    subscribeKey,
    () => readLocalOrder(key),
    () => EMPTY,
  )
}

/**
 * Apply a saved id order to a fresh list. Items that are not in the saved
 * order (newly collected, for example) keep their original position at the end,
 * so the list never drops rows.
 */
export function applyLocalOrder<T>(
  items: T[],
  order: string[],
  getId: (item: T) => string,
): T[] {
  if (!order.length) return items
  const rank = new Map(order.map((id, index) => [id, index]))
  return [...items].sort((a, b) => {
    const rankA = rank.get(getId(a))
    const rankB = rank.get(getId(b))
    if (rankA === undefined && rankB === undefined) return 0
    if (rankA === undefined) return 1
    if (rankB === undefined) return -1
    return rankA - rankB
  })
}
