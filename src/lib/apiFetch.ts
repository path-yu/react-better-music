import { isDesktopShell } from './desktop'

/**
 * The desktop window is created before the bundled API finishes booting, so a
 * connection failure during the first seconds is expected. Retry those briefly
 * instead of surfacing a network error on the very first screen.
 */
const BOOT_RETRY_WINDOW = 10_000
let bootRetryDeadline = 0

export async function fetchWithBootRetry(input: string, init: RequestInit) {
  if (!isDesktopShell()) return fetch(input, init)
  if (!bootRetryDeadline) bootRetryDeadline = Date.now() + BOOT_RETRY_WINDOW
  let delay = 80
  for (;;) {
    try {
      return await fetch(input, init)
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError'
      if (aborted || Date.now() >= bootRetryDeadline) throw error
      await new Promise((resolve) => window.setTimeout(resolve, delay))
      delay = Math.min(delay * 2, 600)
    }
  }
}
