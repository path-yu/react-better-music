import { msg } from '@lingui/core/macro'
import { i18n } from '../i18n'

/**
 * Shared plumbing for the Electrobun main-process bridge.
 *
 * The Bun main process listens on a loopback-only port and authenticates every
 * request with a per-launch token that is appended to the view URL. Downloads
 * and window controls both go through this module.
 */
const BRIDGE_BASE = 'http://127.0.0.1:13002'
const BRIDGE_TIMEOUT = 15_000

/** Survives the URL cleanup and reloads within the same window. */
const BRIDGE_TOKEN_STORAGE_KEY = 'qimiao:bridge-token'

export function isDesktopApp() {
  return import.meta.env.VITE_DESKTOP === 'true'
}

export function rememberBridgeToken(token: string) {
  try {
    window.sessionStorage.setItem(BRIDGE_TOKEN_STORAGE_KEY, token)
  } catch {
    // Storage can be unavailable; the in-memory fallback still works.
  }
}

/**
 * The main process appends a per-launch token to the view URL. main.tsx stashes
 * it on `window` and then removes it from the address bar, because TanStack's
 * hash history folds `location.search` into the hash and would otherwise leak
 * `bridgeToken` into every route search param.
 */
function readBridgeToken() {
  const injected = (window as typeof window & { __bridgeToken?: string }).__bridgeToken
  if (injected) return injected
  const fromQuery = new URLSearchParams(window.location.search).get('bridgeToken')
  if (fromQuery) return fromQuery
  try {
    return window.sessionStorage.getItem(BRIDGE_TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function bridgeAuthHeaders(): Record<string, string> {
  const token = readBridgeToken()
  return token ? { 'x-bridge-token': token } : {}
}

/** The main process may be busy (or restarting); never leave the UI waiting. */
export async function bridgeFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = BRIDGE_TIMEOUT,
) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${BRIDGE_BASE}${path}`, {
      ...init,
      mode: 'cors',
      headers: {
        ...bridgeAuthHeaders(),
        ...(init?.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(i18n._(msg`桌面服务响应超时`), { cause: error })
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await bridgeFetch(path, init)
  if (!response.ok) {
    throw new Error(
      i18n._(msg`桌面服务请求失败 (${response.status})`),
    )
  }
  return (await response.json()) as T
}

/** Append a renderer diagnostic line to the desktop startup log. */
export function reportDesktopLog(message: string) {
  if (!isDesktopApp()) return
  void bridgeFetch('/log', {
    method: 'POST',
    body: message.slice(0, 500),
    keepalive: true,
  }).catch(() => undefined)
}



export type DesktopUpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'

/** Installer-based update state reported by the main process. */
export interface DesktopUpdateState {
  supported: boolean
  packaged: boolean
  reason?: string
  local: { version: string; channel: string } | null
  phase: DesktopUpdatePhase
  /** Latest published release (installer metadata). */
  remote: {
    version: string
    file: string
    size?: number
    sha256?: string
  } | null
  /** Published version is strictly higher than the installed one. */
  newerVersion: boolean
  downloadedBytes: number
  totalBytes: number
  error: string
  checkedAt: number | null
  /** Last phase/progress change, used for the stall hint. */
  updatedAt: number
}

async function updateRequest<T>(path: string, init?: RequestInit) {
  const response = await bridgeFetch(path, init, 45_000)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error || i18n._(msg`更新服务请求失败`))
  }
  return (await response.json()) as T
}

export function getDesktopUpdateState() {
  return updateRequest<DesktopUpdateState>('/update/status')
}

export function checkDesktopUpdate() {
  return updateRequest<DesktopUpdateState>('/update/check', {
    method: 'POST',
  })
}

export function downloadDesktopUpdate() {
  return updateRequest<DesktopUpdateState>('/update/download', {
    method: 'POST',
  })
}

export function applyDesktopUpdate() {
  return updateRequest<{ ok: true }>('/update/apply', {
    method: 'POST',
  })
}

/** Whether the next launch should create WebView2 with DevTools disabled. */
export async function getDevToolsPolicy() {
  return requestJson<{ disabled: boolean }>('/devtools-policy')
}

export async function setDevToolsPolicy(disabled: boolean) {
  return requestJson<{ disabled: boolean }>(
    `/devtools-policy?disabled=${disabled ? '1' : '0'}`,
    { method: 'POST' },
  )
}

/** Whether the always-on-top desktop lyrics window is currently visible. */
export async function getDesktopLyricsVisible() {
  return requestJson<{ visible: boolean }>('/lyrics-window')
}

/** Show, hide or toggle the always-on-top desktop lyrics window. */
export async function setDesktopLyricsVisible(action: 'show' | 'hide' | 'toggle' = 'toggle') {
  return requestJson<{ visible: boolean }>(`/lyrics-window?action=${action}`, {
    method: 'POST',
  })
}

/** Whether the compact mini player window is currently visible. */
export async function getMiniPlayerVisible() {
  return requestJson<{ visible: boolean }>('/mini-window')
}

export async function getAuxWindowsState() {
  return requestJson<{ lyrics: boolean; mini: boolean }>('/aux-windows')
}

export interface RemoteControlInfo {
  enabled: boolean
  /** False while the API child is still starting. */
  apiReady?: boolean
  /** The LAN listener is bound and reachable. */
  listening?: boolean
  /** `port-in-use` or another listener error. */
  error?: string
  port?: number
  /** Phones currently connected. */
  phones?: number
  /** One pairing link (and QR code) per LAN address of this computer. */
  urls: Array<{ name: string; address: string; url: string; qr: string }>
}

export async function getRemoteControl() {
  return requestJson<RemoteControlInfo>('/remote-control')
}

/** Turn LAN remote control on/off, or issue a new pairing key. */
export async function setRemoteControl(patch: {
  enabled?: boolean
  resetToken?: boolean
}) {
  return requestJson<RemoteControlInfo>('/remote-control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** Show, hide or toggle the compact mini player window. */
export async function setMiniPlayerVisible(action: 'show' | 'hide' | 'toggle' = 'toggle') {
  return requestJson<{ visible: boolean }>(`/mini-window?action=${action}`, {
    method: 'POST',
  })
}
