import { fetchWithBootRetry } from './apiFetch'
import { API_BASE } from './apiBase'

const LOGIN_COOKIE_KEY = 'react-music-login-cookie'
const GUEST_COOKIE_KEY = 'react-music-guest-cookie'

interface CookieResponse {
  code?: number
  cookie?: string
  message?: string
  msg?: string
}

function readCookie(key: string) {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeCookie(key: string, value: string) {
  if (!value) return
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage may be unavailable
  }
}

function removeCookie(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function getLoginCookie() {
  return readCookie(LOGIN_COOKIE_KEY)
}

export function saveLoginCookie(cookie: string) {
  writeCookie(LOGIN_COOKIE_KEY, cookie)
}

export function clearLoginCookie() {
  removeCookie(LOGIN_COOKIE_KEY)
}

export function getGuestCookie() {
  return readCookie(GUEST_COOKIE_KEY)
}

export function getActiveCookie() {
  return getLoginCookie() || getGuestCookie()
}

type LoginExpiredListener = () => void
const loginExpiredListeners = new Set<LoginExpiredListener>()
let lastExpiredNotice = 0

/** Subscribe to "the stored login cookie is dead" events (used to reset the UI). */
export function onLoginExpired(listener: LoginExpiredListener) {
  loginExpiredListeners.add(listener)
  return () => {
    loginExpiredListeners.delete(listener)
  }
}

export function notifyLoginExpired() {
  // Several requests often fail at once; only surface the expiry once.
  const now = Date.now()
  if (now - lastExpiredNotice < 5000) return
  lastExpiredNotice = now
  loginExpiredListeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // ignore listener errors
    }
  })
}

async function requestCookie(path: string, params?: Record<string, string>) {
  const search = new URLSearchParams(params).toString()
  // Cookie bootstrap/refresh happens before the app is usable; a hung socket
  // must not keep `initSession` waiting forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetchWithBootRetry(
      `${API_BASE}${path}${search ? `?${search}` : ''}`,
      {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      },
    )
    const text = await response.text()
    try {
      return (text ? JSON.parse(text) : {}) as CookieResponse
    } catch {
      return {} as CookieResponse
    }
  } finally {
    clearTimeout(timer)
  }
}

let refreshPromise: Promise<boolean> | null = null
let lastRefreshAt = 0

/** When the login cookie was last successfully rotated (0 = this app session). */
export function getLastLoginRefreshAt() {
  return lastRefreshAt
}

/**
 * Rotate the logged-in cookie. NetEase extends the session every time this
 * succeeds, so calling it periodically keeps the user signed in indefinitely.
 * The cookie is only cleared when the server explicitly rejects it; a network
 * failure keeps it so the next attempt can recover the session.
 */
export async function refreshLogin(): Promise<boolean> {
  const cookie = getLoginCookie()
  if (!cookie) return false
  // Parallel requests must not each rotate the cookie and race each other.
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const res = await requestCookie('/login/refresh', {
        cookie,
        timestamp: String(Date.now()),
      })
      // A login may have replaced the cookie while this request was in flight.
      if (getLoginCookie() !== cookie) return false
      if (res.code === 200 && typeof res.cookie === 'string' && res.cookie) {
        saveLoginCookie(res.cookie)
        lastRefreshAt = Date.now()
        return true
      }
      if (res.code === 301 || res.code === 302 || res.code === 400) {
        clearLoginCookie()
        notifyLoginExpired()
      }
      return false
    } catch {
      // Keep the cookie: transient failures should not log the user out.
      return false
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

/** Get (and cache) the anonymous cookie used for requests that do not require login. */
export async function fetchGuestCookie(force = false): Promise<string> {
  const cached = getGuestCookie()
  if (cached && !force) return cached
  try {
    const res = await requestCookie('/register/anonimous', {
      timestamp: String(Date.now()),
    })
    if (res.code === 200 && typeof res.cookie === 'string' && res.cookie) {
      writeCookie(GUEST_COOKIE_KEY, res.cookie)
      return res.cookie
    }
  } catch {
    // ignore
  }
  return force ? '' : cached
}
