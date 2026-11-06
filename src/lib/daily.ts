import { useEffect, useState } from 'react'

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** NetEase refreshes the daily recommendations at 06:00 Beijing time. */
export function mostRecentDailyReset(now = Date.now()) {
  const beijing = new Date(now + BEIJING_OFFSET_MS)
  const todayReset =
    Date.UTC(
      beijing.getUTCFullYear(),
      beijing.getUTCMonth(),
      beijing.getUTCDate(),
      6,
    ) - BEIJING_OFFSET_MS
  return now >= todayReset ? todayReset : todayReset - DAY_MS
}

export function msUntilNextDailyReset(now = Date.now()) {
  return mostRecentDailyReset(now) + DAY_MS - now
}

/**
 * Re-renders when the daily recommendations roll over at 06:00 Beijing time.
 * Timers are throttled while a desktop window is hidden, so visibility and
 * focus checks recover a missed boundary as soon as the window comes back.
 */
export function useDailyRefreshKey() {
  const [key, setKey] = useState(0)

  useEffect(() => {
    let timer = 0
    let observedReset = mostRecentDailyReset()

    const schedule = () => {
      window.clearTimeout(timer)
      // A few seconds of slack avoids asking the API before its own refresh.
      const delay = Math.max(1_000, msUntilNextDailyReset() + 3_000)
      timer = window.setTimeout(() => {
        observedReset = mostRecentDailyReset()
        setKey((value) => value + 1)
        schedule()
      }, delay)
    }

    const checkBoundary = () => {
      if (document.visibilityState === 'hidden') return
      const reset = mostRecentDailyReset()
      if (reset <= observedReset) return
      observedReset = reset
      setKey((value) => value + 1)
      schedule()
    }

    schedule()
    document.addEventListener('visibilitychange', checkBoundary)
    window.addEventListener('focus', checkBoundary)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', checkBoundary)
      window.removeEventListener('focus', checkBoundary)
    }
  }, [])

  return key
}
