import { API_BASE } from './apiBase'
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
      `请求失败 (${response.status})`
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

export function get<T>(path: string, params?: Query, signal?: AbortSignal) {
  return runWithSession<T>(path, async () => {
    const timeout = withTimeout(signal, REQUEST_TIMEOUT)
    try {
      return await fetch(buildUrl(path, withSessionCookie(path, params)), {
        method: 'GET',
        credentials: 'include',
        signal: timeout.signal,
      })
    } finally {
      timeout.cleanup()
    }
  })
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

export function postForm<T>(path: string, params: Query, signal?: AbortSignal) {
  const run = async () => {
    const timeout = withTimeout(signal, REQUEST_TIMEOUT)
    try {
      const body = new URLSearchParams()
      Object.entries(withSessionCookie(path, params) ?? {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return
        body.append(key, String(value))
      })
      return await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: timeout.signal,
      })
    } finally {
      timeout.cleanup()
    }
  }
  return runWithSession<T>(path, run)
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
