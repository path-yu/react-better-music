import type { PersistStorage, StorageValue } from 'zustand/middleware'

const WRITE_DELAY = 800

function shallowEqualState(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => Object.is(left[key], right[key]))
}

/**
 * JSON storage for Zustand persist that only touches localStorage when the
 * persisted slice actually changed, and coalesces bursts into a single write.
 * The player updates currentTime several times per second; serialising and
 * writing the whole queue on every update stalled the main thread.
 */
export function createCoalescedStorage<S>(delay = WRITE_DELAY): PersistStorage<S> {
  let last: StorageValue<S> | null = null
  let pending: { name: string; value: StorageValue<S> } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let warned = false

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const { name, value } = pending
    pending = null
    try {
      localStorage.setItem(name, JSON.stringify(value))
      last = value
    } catch (error) {
      if (!warned) {
        warned = true
        console.warn('[persist] failed to write state', error)
      }
    }
  }

  const storage: PersistStorage<S> = {
    getItem: (name) => {
      try {
        const raw = localStorage.getItem(name)
        if (!raw) return null
        const value = JSON.parse(raw) as StorageValue<S>
        last = value
        return value
      } catch {
        return null
      }
    },
    setItem: (name, value) => {
      if (last && shallowEqualState(last.state, value.state)) {
        // The persisted slice did not change; drop any superseded write.
        pending = null
        return
      }
      pending = { name, value }
      if (timer === null) timer = setTimeout(flush, delay)
    },
    removeItem: (name) => {
      pending = null
      last = null
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      try {
        localStorage.removeItem(name)
      } catch {
        // storage may be unavailable
      }
    },
  }

  // A pending write must not be lost when the window is closed or hidden.
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })

  return storage
}
