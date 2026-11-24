import { bridgeFetch, requestJson } from './desktopBridge'

export interface DesktopAudioCacheItem {
  /** `${id}` or `${id}@${source}`; the on-disk index keys entries by it. */
  key: string
  id: number
  /** Provider module of this copy; empty for the official stream. */
  source?: string
  /** Song id whose lyrics match this copy. */
  lyricSongId?: number
  name: string
  size: number
  createdAt: number
  artists?: string
  duration?: number
  bitrate?: number
  trialEnd?: number
  picUrl?: string
  albumId?: number
}

export interface DesktopAudioCacheList {
  dir: string
  items: DesktopAudioCacheItem[]
}

export async function desktopAudioCacheList(): Promise<DesktopAudioCacheList> {
  return requestJson<DesktopAudioCacheList>('/audio-cache')
}

/** One song can hold several cached copies, one per provider. */
function sourceQuery(source?: string) {
  return source ? `&source=${encodeURIComponent(source)}` : ''
}

export async function desktopAudioCacheMeta(
  id: number,
  source?: string,
): Promise<DesktopAudioCacheItem | null> {
  const response = await bridgeFetch(`/audio-cache/meta?id=${id}${sourceQuery(source)}`)
  if (response.status === 204 || response.status === 404) return null
  if (!response.ok) throw new Error(`audio cache metadata failed: ${response.status}`)
  return (await response.json()) as DesktopAudioCacheItem
}

export async function desktopAudioCacheGet(
  id: number,
  source?: string,
): Promise<Blob | null> {
  const response = await bridgeFetch(`/audio-cache/file?id=${id}${sourceQuery(source)}`)
  if (response.status === 204 || response.status === 404) return null
  if (!response.ok) throw new Error(`audio cache read failed: ${response.status}`)
  return response.blob()
}

export async function desktopAudioCachePut(
  meta: DesktopAudioCacheItem,
  blob: Blob,
): Promise<void> {
  const response = await bridgeFetch(
    `/audio-cache?meta=${encodeURIComponent(JSON.stringify(meta))}`,
    { method: 'POST', body: blob },
  )
  if (!response.ok) {
    throw new Error(`audio cache write failed: ${response.status}`)
  }
}

export type DesktopAudioAssetKind = 'cover' | 'lyrics'

function assetQuery(
  kind: DesktopAudioAssetKind,
  params: { id?: number; url?: string; ext?: string },
) {
  const query = new URLSearchParams({ kind })
  if (params.id) query.set('id', String(params.id))
  if (params.url) query.set('url', params.url)
  if (params.ext) query.set('ext', params.ext)
  return query.toString()
}

export async function desktopAudioCacheAssetGet(
  kind: DesktopAudioAssetKind,
  params: { id?: number; url?: string },
): Promise<Blob | null> {
  const response = await bridgeFetch(`/audio-cache/asset?${assetQuery(kind, params)}`)
  if (response.status === 204 || response.status === 404) return null
  if (!response.ok) throw new Error(`audio cache asset read failed: ${response.status}`)
  return response.blob()
}

export async function desktopAudioCacheAssetPut(
  kind: DesktopAudioAssetKind,
  blob: Blob,
  params: { id: number; url?: string; ext?: string },
): Promise<void> {
  const response = await bridgeFetch(`/audio-cache/asset?${assetQuery(kind, params)}`, {
    method: 'POST',
    body: blob,
  })
  if (!response.ok) {
    throw new Error(`audio cache asset write failed: ${response.status}`)
  }
}

export async function desktopAudioCacheAssetRemove(
  kind: DesktopAudioAssetKind,
  params: { id?: number; url?: string },
): Promise<void> {
  const response = await bridgeFetch(`/audio-cache/asset?${assetQuery(kind, params)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error(`audio cache asset remove failed: ${response.status}`)
}

export async function desktopAudioCacheRemove(
  id: number,
  source?: string,
): Promise<void> {
  const response = await bridgeFetch(`/audio-cache?id=${id}${sourceQuery(source)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error(`audio cache remove failed: ${response.status}`)
}

export async function desktopAudioCacheClear(): Promise<void> {
  const response = await bridgeFetch('/audio-cache', { method: 'DELETE' })
  if (!response.ok) throw new Error(`audio cache clear failed: ${response.status}`)
}

export async function desktopAudioCacheDir(): Promise<{
  dir: string
  canPick: boolean
}> {
  return requestJson<{ dir: string; canPick: boolean }>('/audio-cache/dir')
}

export async function pickDesktopAudioCacheDir(): Promise<string | null> {
  const data = await requestJson<{ dir?: string; cancelled?: boolean }>(
    '/audio-cache/pick-dir',
    { method: 'POST' },
  )
  return data.cancelled ? null : (data.dir ?? null)
}

export async function openDesktopAudioCacheDir(): Promise<void> {
  await requestJson<{ dir?: string }>('/audio-cache/open-dir', {
    method: 'POST',
  })
}
