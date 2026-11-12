import { useEffect, useState } from 'react'

/**
 * Avoid flashing "loading source"/"buffering" when a cached Blob becomes
 * ready within a few frames. Only show the busy UI after the delay.
 */
export function useDelayedBusy(busy: boolean, delayMs = 300) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!busy) {
      setVisible(false)
      return
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [busy, delayMs])

  return visible
}
