import { useEffect, useState } from 'react'
import { useToast } from '@pikoloo/darwin-ui'
import { subscribeToast } from '../../lib/toast'

/**
 * Bridges the app's toast bus to darwin-ui and mirrors every message into an
 * `aria-live` region: the third-party toast is visual only, so screen readers
 * would otherwise miss all `toast.error(...)` feedback.
 */
export function ToastBridge() {
  const { showToast } = useToast()
  const [live, setLive] = useState('')

  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = subscribeToast((message, kind, title) => {
      showToast(message, { type: kind, title, duration: 2600 })
      // Clear first, then announce on the next tick: a live region only speaks
      // when its text actually changes, so repeated identical messages need
      // an empty frame in between.
      setLive('')
      timer = window.setTimeout(() => setLive(title ? `${title}：${message}` : message), 80)
    })
    return () => {
      unsubscribe()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [showToast])

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {live}
    </div>
  )
}
