import { API_BASE } from './apiBase'
import { fetchWithBootRetry } from './apiFetch'
import {
  fetchGuestCookie,
  getActiveCookie,
  getGuestCookie,
  getLoginCookie,
  refreshLogin,
} from './session'

type Query = Record<string, string | number | boolean | undefined | null>

/** Endpoints that must not reuse the cached cookie. */
const COOKIE_FREE_PREFIXES = [
  '/login/cellphone',
  '/login/qr',
  '/captcha',
  '/register/anonimous',
]

/** Endpoints whose failures should not trigger a session refresh retry. */
const RETRY_FREE_PREFIXES = [...COOKIE_FREE_PREFIXES, '/logout']

function buildQuery(params?: Query) {
  if (!params) return ''
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.append(key, String(value))
  })
  const query = search.toString()
  return query ? `?${query}` : ''
}

function buildUrl(path: string, params?: Query) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${normalized}${buildQuery(params)}`
}

export function apiUrl(path: string, params?: Query) {
  return buildUrl(path, params)
}

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

const REQUEST_TIMEOUT = 15_000
const UPLOAD_TIMEOUT = 60_000

/**
 * Compose the caller's signal with a timeout. A request that never settles
 * would otherwise leave the UI on a skeleton forever.
 */
function withTimeout(signal: AbortSignal | undefined, timeout: number) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeout)
  const forwardAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', forwardAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    },
  }
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let payload: unknown = text
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // keep raw text
  }
  if (!response.ok) {
    const message =
      (payload as { message?: string; msg?: string })?.message ??
      (payload as { msg?: string })?.msg ??
      (typeof document !== 'undefined' &&
      document.documentElement.lang.startsWith('zh')
        ? `请求失败 (${response.status})`
        : `Request failed (${response.status})`)
    throw new ApiError(message, response.status, payload)
  }
  return payload as T
}

function withSessionCookie(path: string, params?: Query): Query | undefined {
  if (COOKIE_FREE_PREFIXES.some((prefix) => path.startsWith(prefix))) return params
  const cookie = getActiveCookie()
  if (!cookie) return params
  return { ...params, cookie }
}

function isSessionFailure(error: unknown) {
  if (!(error instanceof ApiError)) return false
  const payload = error.payload as {
    code?: number
    message?: string
    msg?: string
  } | null
  if (error.status === 301 || payload?.code === 301) return true
  if (error.status === 400) {
    const message = `${payload?.message ?? ''} ${payload?.msg ?? ''}`
    return message.includes('登录') || message.includes('验证') || message.includes('需要')
  }
  return false
}

function isRetryFree(path: string) {
  return RETRY_FREE_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/**
 * A 301/400 auth failure means the cached cookie expired. Try `/login/refresh`
 * first; when that fails, fall back to a fresh anonymous cookie so public
 * endpoints keep working without a logged-in account.
 */
async function recoverSession() {
  if (getLoginCookie()) {
    if (await refreshLogin()) return true
    // refreshLogin clears the cookie (and notifies the app) only when the
    // server rejected the session; a transient failure keeps it for later.
    clearApiCache()
  }
  if (getGuestCookie()) return true
  return Boolean(await fetchGuestCookie(true))
}

async function runWithSession<T>(path: string, run: () => Promise<Response>) {
  const canRetry = !isRetryFree(path)
  try {
    const payload = await parse<T>(await run())
    const code = (payload as { code?: number } | null)?.code
    // Some endpoints report an expired session as HTTP 200 with body code 301.
    if (canRetry && code === 301 && (await recoverSession())) {
      return parse<T>(await run())
    }
    return payload
  } catch (error) {
    if (!isSessionFailure(error) || !canRetry) throw error
    if (!(await recoverSession())) throw error
    return parse<T>(await run())
  }
}

/* ------------------------------ read caching ------------------------------ */

interface ReadCacheRule {
  prefix: string
  ttl: number
  /** Serve expired browsing data while refreshing it in the background. */
  swr?: boolean
}

/**
 * Only read-only browsing endpoints are cached. Session, comment, search and
 * mutation endpoints intentionally stay out so edits appear immediately.
 */
const READ_CACHE_RULES: ReadCacheRule[] = [
  { prefix: '/banner', ttl: 5 * 60_000 },
  { prefix: '/personalized', ttl: 5 * 60_000 },
  { prefix: '/recommend/songs', ttl: 60_000 },
  { prefix: '/top/song', ttl: 2 * 60_000 },
  { prefix: '/top/playlist', ttl: 2 * 60_000 },
  { prefix: '/playlist/highquality/tags', ttl: 10 * 60_000 },
  { prefix: '/playlist/detail', ttl: 5 * 60_000 },
  { prefix: '/playlist/track/all', ttl: 5 * 60_000 },
  { prefix: '/mv/first', ttl: 2 * 60_000 },
  { prefix: '/mv/all', ttl: 2 * 60_000 },
  { prefix: '/mv/detail', ttl: 5 * 60_000 },
  { prefix: '/mv/url', ttl: 60_000, swr: false },
  { prefix: '/video/url', ttl: 60_000, swr: false },
  { prefix: '/mlog/url', ttl: 60_000, swr: false },
  { prefix: '/mlog/music/rcmd', ttl: 5 * 60_000 },
  { prefix: '/simi/mv', ttl: 5 * 60_000 },
  { prefix: '/artist/detail', ttl: 5 * 60_000 },
  { prefix: '/artist/top/song', ttl: 5 * 60_000 },
  { prefix: '/artist/album', ttl: 5 * 60_000 },
  { prefix: '/artist/mv', ttl: 5 * 60_000 },
  { prefix: '/simi/artist', ttl: 5 * 60_000 },
  { prefix: '/album', ttl: 5 * 60_000 },
  { prefix: '/lyric/new', ttl: 10 * 60_000 },
  { prefix: '/song/url/v1', ttl: 60_000, swr: false },
  // Availability is asked twice for the same track (prefetch + playback); a
  // short-lived cache keeps that from doubling the round trips.
  { prefix: '/check/music', ttl: 60_000, swr: false },
  // Cross-provider matching is slow; short-lived cache avoids repeating it for
  // the prefetch request and the actual playback of the same track.
  { prefix: '/song/url/match', ttl: 60_000, swr: false },
  { prefix: '/search/suggest', ttl: 60_000 },
  { prefix: '/search/default', ttl: 5 * 60_000 },
  { prefix: '/search/hot', ttl: 5 * 60_000 },
]

const READ_CACHE_LIMIT = 150
let readCacheEpoch = 0
const readCache = new Map<string, { data: unknown; expiresAt: number }>()
const readInflight = new Map<string, Promise<unknown>>()

function readCacheRule(path: string) {
  return READ_CACHE_RULES.find(
    (rule) => path === rule.prefix || path.startsWith(`${rule.prefix}/`),
  )
}

function readCacheKey(path: string, params?: Query) {
  const query = Object.entries(params ?? {})
    .filter(
      ([key, value]) =>
        key !== 'timestamp' && value !== undefined && value !== null && value !== '',
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&')
  return `${readCacheEpoch}:${path}?${query}`
}

function cacheablePayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return false
  if ('code' in payload) {
    return (payload as { code?: unknown }).code === 200
  }
  return true
}

function storeReadCache(key: string, data: unknown, ttl: number) {
  readCache.set(key, { data, expiresAt: Date.now() + ttl })
  if (readCache.size <= READ_CACHE_LIMIT) return
  const now = Date.now()
  for (const [cacheKey, entry] of readCache) {
    if (entry.expiresAt <= now) readCache.delete(cacheKey)
  }
  while (readCache.size > READ_CACHE_LIMIT) {
    const oldest = readCache.keys().next().value
    if (oldest === undefined) break
    readCache.delete(oldest)
  }
}

/** Drop every cached read, e.g. after login/logout changes the session. */
export function clearApiCache() {
  readCache.clear()
  readInflight.clear()
  readCacheEpoch += 1
}

/** Drop cached reads for the given path prefixes after a mutation. */
export function invalidateApiCache(pathPrefixes: string[]) {
  for (const key of [...readCache.keys()]) {
    if (pathPrefixes.some((prefix) => key.includes(`:${prefix}`))) {
      readCache.delete(key)
    }
  }
}

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}

/** Let a caller bail out without cancelling the shared, cache-warming request. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function runGet<T>(path: string, params?: Query, signal?: AbortSignal) {
  return runWithSession<T>(path, async () => {
    const timeout = withTimeout(signal, REQUEST_TIMEOUT)
    try {
      return await fetchWithBootRetry(buildUrl(path, withSessionCookie(path, params)), {
        method: 'GET',
        credentials: 'include',
        signal: timeout.signal,
      })
    } finally {
      timeout.cleanup()
    }
  })
}

export function get<T>(path: string, params?: Query, signal?: AbortSignal) {
  const rule = readCacheRule(path)
  if (!rule) return runGet<T>(path, params, signal)
  if (signal?.aborted) return Promise.reject(abortError())

  const key = readCacheKey(path, params)
  const cached = readCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return abortable(Promise.resolve(cached.data as T), signal)
  }

  // Stale-while-revalidate: browsing data is shown immediately even after its
  // TTL, while a background request refreshes it for the next navigation.
  // Signed media URLs opt out (`swr: false`) because a stale URL may be invalid.
  if (cached && rule.swr !== false) {
    if (!readInflight.has(key)) {
      const refreshEpoch = readCacheEpoch
      const refresh = runGet<T>(path, params)
        .then((data) => {
          if (refreshEpoch === readCacheEpoch && cacheablePayload(data)) {
            storeReadCache(key, data, rule.ttl)
          }
          return data
        })
        .finally(() => {
          if (readInflight.get(key) === refresh) readInflight.delete(key)
        })
      readInflight.set(key, refresh)
    }
    return abortable(Promise.resolve(cached.data as T), signal)
  }

  const existing = readInflight.get(key)
  if (existing) return abortable(existing as Promise<T>, signal)

  const epoch = readCacheEpoch
  const request = runGet<T>(path, params)
    .then((data) => {
      if (epoch === readCacheEpoch && cacheablePayload(data)) {
        storeReadCache(key, data, rule.ttl)
      }
      return data
    })
    .finally(() => {
      if (readInflight.get(key) === request) readInflight.delete(key)
    })
  readInflight.set(key, request)
  return abortable(request, signal)
}

export function post<T>(path: string, body?: BodyInit | null, params?: Query, signal?: AbortSignal) {
  return runWithSession<T>(path, async () => {
    const timeout = withTimeout(signal, REQUEST_TIMEOUT)
    try {
      return await fetch(buildUrl(path, withSessionCookie(path, params)), {
        method: 'POST',
        credentials: 'include',
        body,
        signal: timeout.signal,
      })
    } finally {
      timeout.cleanup()
    }
  })
}

export function uploadFile<T>(path: string, file: File, params?: Query) {
  return runWithSession<T>(path, async () => {
    const timeout = withTimeout(undefined, UPLOAD_TIMEOUT)
    try {
      const formData = new FormData()
      formData.append('imgFile', file)
      return await fetch(buildUrl(path, withSessionCookie(path, params)), {
        method: 'POST',
        credentials: 'include',
        body: formData,
        signal: timeout.signal,
      })
    } finally {
      timeout.cleanup()
    }
  })
}
