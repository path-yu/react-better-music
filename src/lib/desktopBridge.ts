/**
 * Shared plumbing for the Electrobun main-process bridge.
 *
 * The Bun main process listens on a loopback-only port and authenticates every
 * request with a per-launch token that is appended to the view URL. Downloads
 * and window controls both go through this module.
 */
const BRIDGE_BASE = 'http://127.0.0.1:13002'
const BRIDGE_TIMEOUT = 15_000

export function isDesktopApp() {
  return import.meta.env.VITE_DESKTOP === 'true'
}

/**
 * The main process appends a per-launch token to the view URL. The router may
 * rewrite the URL before the first request, so main.tsx stashes it on window
 * as soon as the app boots.
 */
function bridgeAuthHeaders(): Record<string, string> {
  const injected = (window as typeof window & { __bridgeToken?: string }).__bridgeToken
  const token =
    injected ?? new URLSearchParams(window.location.search).get('bridgeToken') ?? ''
  return token ? { 'x-bridge-token': token } : {}
}

/** The main process may be busy (or restarting); never leave the UI waiting. */
export async function bridgeFetch(path: string, init?: RequestInit) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), BRIDGE_TIMEOUT)
  try {
    return await fetch(`${BRIDGE_BASE}${path}`, {
      ...init,
      mode: 'cors',
      headers: bridgeAuthHeaders(),
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('桌面服务响应超时', { cause: error })
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await bridgeFetch(path, init)
  if (!response.ok) {
    throw new Error(`桌面服务请求失败 (${response.status})`)
  }
  return (await response.json()) as T
}
