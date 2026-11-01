import { toast } from './toast'

const NOTICE_COOLDOWN = 15_000
let lastNoticeAt = 0

function isChinese() {
  return (
    typeof document === 'undefined' ||
    document.documentElement.lang.startsWith('zh')
  )
}

function message(zh: string, en: string) {
  return isChinese() ? zh : en
}

/**
 * Network failures are often swallowed by individual page error boundaries.
 * Surface one calm, throttled notice instead of letting every failed request
 * create its own toast.
 */
export function isNetworkFailure(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  if (error instanceof TypeError) return true
  const status = (error as { status?: number } | null)?.status
  return status === 0 || status === 502 || status === 503 || status === 504
}

export function reportNetworkError(force = false) {
  const now = Date.now()
  if (!force && now - lastNoticeAt < NOTICE_COOLDOWN) return
  lastNoticeAt = now

  const offline =
    typeof navigator !== 'undefined' && navigator.onLine === false
  toast.error(
    offline
      ? message(
          '当前设备未联网，请检查本地网络连接后重试。',
          'This device is offline. Check your network connection and try again.',
        )
      : message(
          '网络异常，无法连接音乐服务，请检查网络或稍后重试。',
          'Network error: could not reach the music service. Check your connection or try again later.',
        ),
    message('网络异常', 'Connection problem'),
  )
}

/** The browser regained connectivity; allow the next failure to notify again. */
export function reportNetworkRestored() {
  lastNoticeAt = 0
  toast.success(
    message('网络已恢复', 'Network restored'),
    message('已重新连接', 'Reconnected'),
  )
}

/** Register browser-level online/offline notifications for the app lifetime. */
export function installNetworkStatus() {
  if (typeof window === 'undefined') return () => undefined

  // Do not force a second toast when an in-flight request already reported the
  // same disconnect a moment earlier.
  const onOffline = () => reportNetworkError()
  const onOnline = () => reportNetworkRestored()

  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)

  // The app may boot while already offline; in that case no `offline` event
  // fires. Give the toast provider one frame to subscribe, then notify.
  const bootTimer =
    navigator.onLine === false
      ? window.setTimeout(() => reportNetworkError(), 150)
      : undefined

  return () => {
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
    if (bootTimer !== undefined) window.clearTimeout(bootTimer)
  }
}
