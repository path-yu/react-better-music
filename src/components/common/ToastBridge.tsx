import { useEffect } from 'react'
import { useToast } from '@pikoloo/darwin-ui'
import { subscribeToast } from '../../lib/toast'

export function ToastBridge() {
  const { showToast } = useToast()

  useEffect(() => {
    const unsubscribe = subscribeToast((message, kind, title) => {
      showToast(message, { type: kind, title, duration: 2600 })
    })
    return () => {
      unsubscribe()
    }
  }, [showToast])

  return null
}
