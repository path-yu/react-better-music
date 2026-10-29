/**
 * Bridge to the Electrobun main process for native download handling.
 * Only available in the packaged desktop app (VITE_DESKTOP=true).
 */
import { msg } from '@lingui/core/macro'
import { i18n } from '../i18n'
import { bridgeFetch, isDesktopApp, requestJson } from './desktopBridge'

export { isDesktopApp }

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
  const response = await bridgeFetch(`/save-file?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: blob,
  })
  if (!response.ok) {
    throw new Error(
      i18n._(msg`保存文件失败 (${response.status})`),
    )
  }
  const data = (await response.json()) as { path?: string }
  return data.path ?? ''
}
