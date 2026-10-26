/**
 * Bridge to the Electrobun main process for native download handling.
 * Only available in the packaged desktop app (VITE_DESKTOP=true).
 */
const BRIDGE_BASE = 'http://127.0.0.1:13002'

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

export function isDesktopApp() {
  return import.meta.env.VITE_DESKTOP === 'true'
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BRIDGE_BASE}${path}`, {
    ...init,
    mode: 'cors',
    headers: bridgeAuthHeaders(),
  })
  if (!response.ok) {
    throw new Error(`下载服务请求失败 (${response.status})`)
  }
  return (await response.json()) as T
}

export async function getDownloadDir(): Promise<string> {
  const data = await requestJson<{ dir?: string }>('/download-dir')
  return data.dir ?? ''
}

export async function pickDownloadDir(): Promise<string | null> {
  const data = await requestJson<{ dir?: string; cancelled?: boolean }>('/pick-dir', {
    method: 'POST',
  })
  return data.cancelled ? null : (data.dir ?? null)
}

export async function openDownloadDir(): Promise<void> {
  await requestJson<{ dir?: string }>('/open-dir', { method: 'POST' })
}

export async function saveDownloadFile(name: string, blob: Blob): Promise<string> {
  const response = await fetch(
    `${BRIDGE_BASE}/save-file?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      body: blob,
      mode: 'cors',
      headers: bridgeAuthHeaders(),
    },
  )
  if (!response.ok) {
    throw new Error(`保存文件失败 (${response.status})`)
  }
  const data = (await response.json()) as { path?: string }
  return data.path ?? ''
}
