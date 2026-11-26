import { msg } from '@lingui/core/macro'
import { apiUrl } from './http'
import { i18n } from '../i18n'
import { reportDesktopLog } from './desktopBridge'
import { isDesktopApp, saveDownloadFile } from './desktopDownloads'
import {
  desktopAudioCacheClear,
  desktopAudioCacheGet,
  desktopAudioCacheList,
  desktopAudioCacheMeta,
  desktopAudioCachePut,
  desktopAudioCacheRemove,
} from './desktopAudioCache'
import { toast } from './toast'
import { cacheCoverImage } from './coverCache'
import { useSettingsStore } from '../store/settings'

interface CacheMeta {
  /** `${id}` for the official source, `${id}@${source}` for a matched one. */
  key: string
  /** NetEase song id; several sources of one song share it. */
  id: number
  /** Provider module that produced this copy; '' for the official stream. */
  source?: string
  /** Song id whose lyrics match this audio (different for other editions). */
  lyricSongId?: number
  name: string
  size: number
  createdAt: number
  artists?: string
  duration?: number
  bitrate?: number
  /** 0 = full track; >0 = cached audio is only a 30s preview. */
  trialEnd?: number
  picUrl?: string
  albumId?: number
  /** Public video page for bilibili / YouTube matches (menu link). */
  webUrl?: string
}

interface AudioRecord {
  key: string
  blob: Blob
}

export interface CacheableSong {
  id: number
  name: string
  url: string
  /** Provider module for matched audio; empty for the official stream. */
  source?: string
  /** Song id whose lyrics match this audio (other editions differ). */
  lyricSongId?: number
  artists?: string
  duration?: number
  trialEnd?: number | null
  /** Artwork URL persisted alongside the audio for offline playback. */
  picUrl?: string
  /** Album id so cached tracks can open their album without a detail request. */
  albumId?: number
  /** Video page of the matched stream, kept so the source menu can link to it. */
  webUrl?: string
}

/**
 * One cached copy per (song, source) pair. Switching provider keeps the old
 * file, so a track can hold several playable versions at once.
 */
export function cacheKeyFor(id: number, source?: string) {
  return source ? `${id}@${source}` : String(id)
}

/**
 * Which provider produced the currently playing URL. `copyright-rcmd` is a
 * NetEase-recommended *other edition*, so it is its own variant instead of
 * sharing the official copy's slot.
 */
export function cacheSourceOf(song: {
  unblocked?: boolean
  matchedSource?: string
}) {
  return song.matchedSource ?? ''
}

const DB_NAME = 'react-music-audio'
// v3 keys records by (song, source) so multiple providers can coexist.
const DB_VERSION = 3
const AUDIO_STORE = 'audio'
const META_STORE = 'meta'
// Cached audio is Opus (96kbps by default), roughly 2.9MB per four-minute song.
// The user-configurable MB limit is the only eviction policy.
const cacheMaxBytes = () =>
  Math.max(50, useSettingsStore.getState().cacheMaxMb) * 1024 * 1024

let dbPromise: Promise<IDBDatabase> | null = null
let writeQueue: Promise<void> = Promise.resolve()
const pending = new Map<string, Promise<void>>()
let cacheWarningShown = false
// Bumped by clearAudioCache so jobs queued before a clear cannot write back.
let cacheEpoch = 0

/** Opus is defined at 48 kHz; the browser resamples during decode. */
const OPUS_SAMPLE_RATE = 48_000

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        // v2 raised the cached Opus bitrate, v3 keys entries by (song, source):
        // both change what the old records mean, so rebuild the stores.
        if (db.objectStoreNames.contains(AUDIO_STORE)) {
          db.deleteObjectStore(AUDIO_STORE)
        }
        if (db.objectStoreNames.contains(META_STORE)) {
          db.deleteObjectStore(META_STORE)
        }
        db.createObjectStore(AUDIO_STORE, { keyPath: 'key' })
        const meta = db.createObjectStore(META_STORE, { keyPath: 'key' })
        meta.createIndex('createdAt', 'createdAt')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function getCachedAudio(
  id: number,
  source?: string,
): Promise<Blob | null> {
  if (isDesktopApp()) {
    try {
      return await desktopAudioCacheGet(id, source)
    } catch {
      return null
    }
  }
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    const record = await requestResult<AudioRecord | undefined>(
      db
        .transaction(AUDIO_STORE, 'readonly')
        .objectStore(AUDIO_STORE)
        .get(cacheKeyFor(id, source)),
    )
    return record?.blob ?? null
  } catch {
    return null
  }
}

/**
 * Drop one cached copy. Without `source` every version of that song is removed,
 * which is what "clear this entry" from the settings list expects.
 */
export async function removeCachedAudio(
  id: number,
  source?: string,
): Promise<void> {
  if (isDesktopApp()) {
    try {
      await desktopAudioCacheRemove(id, source)
    } catch {
      // Cache maintenance is best-effort.
    }
    return
  }
  if (typeof indexedDB === 'undefined') return
  try {
    const db = await openDb()
    const keys = source
      ? [cacheKeyFor(id, source)]
      : await cachedKeysForSong(db, id)
    const transaction = db.transaction([AUDIO_STORE, META_STORE], 'readwrite')
    const audioStore = transaction.objectStore(AUDIO_STORE)
    const metaStore = transaction.objectStore(META_STORE)
    keys.forEach((key) => {
      audioStore.delete(key)
      metaStore.delete(key)
    })
    await transactionDone(transaction)
  } catch {
    // Cache maintenance is best-effort.
  }
}

/** Every cache key belonging to one song (official + matched copies). */
async function cachedKeysForSong(db: IDBDatabase, id: number) {
  const metas = await requestResult<CacheMeta[]>(
    db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll(),
  )
  return metas.filter((meta) => meta.id === id).map((meta) => meta.key)
}

export async function getCachedAudioMeta(
  id: number,
  source?: string,
): Promise<CacheMeta | null> {
  if (isDesktopApp()) {
    try {
      return await desktopAudioCacheMeta(id, source)
    } catch {
      return null
    }
  }
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    return (
      (await requestResult<CacheMeta | undefined>(
        db
          .transaction(META_STORE, 'readonly')
          .objectStore(META_STORE)
          .get(cacheKeyFor(id, source)),
      )) ?? null
    )
  } catch {
    return null
  }
}

/** True when the track already has a cached copy (cheap metadata read). */
export async function hasCachedAudio(id: number, source?: string): Promise<boolean> {
  return Boolean(await getCachedAudioMeta(id, source))
}

async function putCachedAudio(
  id: number,
  name: string,
  blob: Blob,
  extra?: {
    source?: string
    lyricSongId?: number
    artists?: string
    duration?: number
    bitrate?: number
    trialEnd?: number
    picUrl?: string
    albumId?: number
    webUrl?: string
  },
) {
  const maxBytes = cacheMaxBytes()
  if (blob.size > maxBytes) return
  const meta: CacheMeta = {
    key: cacheKeyFor(id, extra?.source),
    id,
    name,
    size: blob.size,
    createdAt: Date.now(),
    ...extra,
  }
  // Desktop keeps audio on disk (configurable cache directory); IndexedDB is
  // only the browser fallback.
  if (isDesktopApp()) {
    await desktopAudioCachePut(meta, blob)
    // The filesystem bridge keeps a generous hard ceiling; apply the actual
    // user setting here so changing it above/below the old 80MB works.
    try {
      await trimAudioCacheToLimit()
    } catch {
      // Cache cleanup is best-effort; the track itself was written.
    }
    return
  }
  const db = await openDb()
  const transaction = db.transaction([AUDIO_STORE, META_STORE], 'readwrite')
  const record: AudioRecord = { key: meta.key, blob }
  transaction.objectStore(AUDIO_STORE).put(record)
  transaction.objectStore(META_STORE).put(meta)
  await transactionDone(transaction)
  await trimCache(db)
}

async function trimCache(db: IDBDatabase, maxBytes = cacheMaxBytes()) {
  const metas = await requestResult<CacheMeta[]>(
    db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll(),
  )
  metas.sort((a, b) => a.createdAt - b.createdAt)
  let bytes = metas.reduce((total, meta) => total + meta.size, 0)
  const removals: string[] = []
  for (const meta of metas) {
    if (bytes <= maxBytes) break
    removals.push(meta.key)
    bytes -= meta.size
  }
  if (!removals.length) return
  const transaction = db.transaction([AUDIO_STORE, META_STORE], 'readwrite')
  const audioStore = transaction.objectStore(AUDIO_STORE)
  const metaStore = transaction.objectStore(META_STORE)
  removals.forEach((key) => {
    audioStore.delete(key)
    metaStore.delete(key)
  })
  await transactionDone(transaction)
}

/** Apply the configured MB limit immediately (also after changing the setting). */
export async function trimAudioCacheToLimit(maxMb?: number): Promise<void> {
  const limit =
    Math.max(50, maxMb ?? useSettingsStore.getState().cacheMaxMb) *
    1024 *
    1024
  if (isDesktopApp()) {
    const { items } = await desktopAudioCacheList()
    const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt)
    let bytes = sorted.reduce((total, item) => total + item.size, 0)
    for (const item of sorted) {
      if (bytes <= limit) break
      await desktopAudioCacheRemove(item.id, item.source)
      bytes -= item.size
    }
    return
  }
  const db = await openDb()
  await trimCache(db, limit)
}

/** Decode compressed audio; mediabunny normalizes rate/channels for Opus. */
async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const bytes = await blob.arrayBuffer()
  // OfflineAudioContext has no hardware resources to release; GC owns it.
  const context = new OfflineAudioContext(1, 1, OPUS_SAMPLE_RATE)
  return context.decodeAudioData(bytes)
}

/**
 * Encode a decoded track to Opus inside Ogg via mediabunny, which drives the
 * platform WebCodecs encoder. Replaces the 30 MB ffmpeg.wasm core.
 */
async function encodeOpusOgg(blob: Blob, bitrateKbps: number): Promise<Blob> {
  // Keep mediabunny (~95 KB) out of the startup bundle: it is only needed once
  // a track has played long enough to be cached.
  const {
    AudioBufferSource,
    BufferTarget,
    canEncodeAudio,
    OggOutputFormat,
    Output,
    Quality,
  } = await import('mediabunny')
  const buffer = await decodeAudio(blob)
  if (!buffer.length) throw new Error(i18n._(msg`音频解码失败`))
  const channels = Math.min(2, buffer.numberOfChannels)
  const quality = new Quality({
    bitrate: Math.max(6_000, Math.min(510_000, bitrateKbps * 1000)),
  })
  const supported = await canEncodeAudio('opus', {
    numberOfChannels: channels,
    sampleRate: OPUS_SAMPLE_RATE,
    quality,
  })
  if (!supported) throw new Error(i18n._(msg`当前环境不支持 Opus 编码`))

  const output = new Output({
    format: new OggOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new AudioBufferSource({
    codec: 'opus',
    quality,
    // Opus is defined at 48 kHz; let the source resample/downmix so the
    // encoder always receives a supported layout.
    transform: { numberOfChannels: channels, sampleRate: OPUS_SAMPLE_RATE },
  })
  output.addAudioTrack(source)
  try {
    await output.start()
    await source.add(buffer)
    source.close()
    await output.finalize()
    const data = output.target.buffer
    if (!data) throw new Error(i18n._(msg`音频编码结果为空`))
    // mediabunny reports Ogg as `application/ogg`; the media element needs the
    // audio MIME type to accept the blob URL.
    return new Blob([data], { type: 'audio/ogg' })
  } catch (error) {
    await output.cancel().catch(() => undefined)
    throw error
  }
}

async function fetchAudioBlob(url: string): Promise<Blob> {
  const response = await fetch(apiUrl('/audio/proxy', { url }))
  if (!response.ok)
    throw new Error(i18n._(msg`音频下载失败 (${response.status})`))
  return response.blob()
}

async function transcodeAndStore(song: CacheableSong, epoch: number, source?: Blob) {
  if (epoch !== cacheEpoch) return
  // Metadata lookup avoids loading the whole cached file just to skip encoding.
  if (await hasCachedAudio(song.id, song.source)) return

  const bitrate = useSettingsStore.getState().cacheBitrate
  try {
    // A neighbour prefetch already holds the bytes: reuse them instead of
    // downloading the whole track a second time.
    const input = source ?? (await fetchAudioBlob(song.url))
    const encoded = await encodeOpusOgg(input, bitrate)
    if (epoch !== cacheEpoch) return
    await putCachedAudio(song.id, song.name, encoded, {
      source: song.source,
      lyricSongId: song.lyricSongId,
      artists: song.artists,
      duration: song.duration,
      bitrate,
      trialEnd: song.trialEnd && song.trialEnd > 0 ? song.trialEnd : 0,
      picUrl: song.picUrl,
      albumId: song.albumId,
      webUrl: song.webUrl,
    })
  } catch (error) {
    console.warn('[song cache] encode failed:', error)
    throw error
  }
}

function enqueueCache(song: CacheableSong, source?: Blob) {
  // Cache artwork in parallel with audio; it is tiny and makes the cached row
  // usable offline without fetching the CDN again.
  void cacheCoverImage(song.picUrl, song.id)
  const key = cacheKeyFor(song.id, song.source)
  if (typeof indexedDB === 'undefined' || pending.has(key)) return
  const epoch = cacheEpoch
  // Encoding is memory-heavy, so cache jobs run in sequence.
  const task = writeQueue
    .then(() => transcodeAndStore(song, epoch, source))
    .catch((error) => {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn('[song cache] failed:', error)
      reportDesktopLog(`song cache failed: ${reason}`)
      if (!cacheWarningShown) {
        cacheWarningShown = true
        // Keep the reason visible: WebCodecs/decode/quota failures used to be
        // indistinguishable behind the generic message.
        toast.warning(
          i18n._(msg`音频缓存暂不可用：${reason.slice(0, 60)}`),
        )
      }
    })
    .finally(() => {
      pending.delete(key)
    })
  writeQueue = task
  pending.set(key, task)
}

export function cacheSong(song: CacheableSong) {
  enqueueCache(song)
}

/** Cache from a Blob already downloaded by the neighbour prefetch. */
export function cacheSongFromBlob(song: CacheableSong, blob: Blob) {
  enqueueCache(song, blob)
}

export interface CachedAudioItem {
  /** Cache identity: `${id}` or `${id}@${source}`. */
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
  /** Original artwork URL, also present as a sidecar cover in the cache dir. */
  picUrl?: string
  albumId?: number
}

export async function listCachedAudio(): Promise<CachedAudioItem[]> {
  if (isDesktopApp()) {
    try {
      const { items } = await desktopAudioCacheList()
      return items.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }
  if (typeof indexedDB === 'undefined') return []
  try {
    const db = await openDb()
    const metas = await requestResult<CacheMeta[]>(
      db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll(),
    )
    return metas.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

/** Every provider that holds a cached copy of this song ('' = official). */
export async function listCachedSources(id: number): Promise<string[]> {
  const items = await listCachedAudio()
  return items.filter((item) => item.id === id).map((item) => item.source ?? '')
}

export async function clearAudioCache() {
  cacheEpoch += 1
  if (isDesktopApp()) {
    await desktopAudioCacheClear()
    return
  }
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  const transaction = db.transaction([AUDIO_STORE, META_STORE], 'readwrite')
  transaction.objectStore(AUDIO_STORE).clear()
  transaction.objectStore(META_STORE).clear()
  await transactionDone(transaction)
}

function cacheFileName(meta: CacheMeta, blob?: Blob) {
  const base = meta.artists ? `${meta.artists} - ${meta.name}` : meta.name
  const safe = base.replace(/[\\/:*?"<>|]/g, '_').trim()
  // Older cache entries are Ogg/Opus; new ones are WebM/Opus.
  const extension = blob?.type.includes('ogg') ? '.opus' : '.webm'
  return `${safe || 'cached-song'}${extension}`
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * Export the given cached tracks. Desktop writes each .opus into the configured
 * folder; browsers get a single ZIP because repeated automatic downloads are
 * blocked by many browsers.
 */
export async function downloadCachedAudio(
  refs: Array<{ id: number; source?: string }>,
): Promise<number> {
  if (!refs.length) return 0
  const desktop = isDesktopApp()
  const entries: Array<{ meta: CacheMeta; blob: Blob }> = []

  for (const ref of refs) {
    const meta = await getCachedAudioMeta(ref.id, ref.source)
    if (!meta) continue
    const blob = await getCachedAudio(ref.id, ref.source)
    if (!blob) continue
    entries.push({ meta, blob })
  }

  if (!entries.length) return 0

  if (desktop) {
    for (const { meta, blob } of entries) {
      // Write straight into the user-configured folder via the Bun process.
      await saveDownloadFile(cacheFileName(meta, blob), blob)
      await new Promise((resolve) => window.setTimeout(resolve, 250))
    }
    return entries.length
  }

  if (entries.length === 1) {
    downloadBlob(entries[0].blob, cacheFileName(entries[0].meta, entries[0].blob))
    return 1
  }

  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  for (const { meta, blob } of entries) {
    const base = cacheFileName(meta, blob)
    const extension = base.slice(base.lastIndexOf('.'))
    const stem = base.slice(0, -extension.length)
    let name = base
    let index = 1
    while (used.has(name)) {
      name = `${stem} (${index})${extension}`
      index += 1
    }
    used.add(name)
    files[name] = new Uint8Array(await blob.arrayBuffer())
  }

  const archive = zipSync(files, { level: 0 })
  const date = new Date()
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  downloadBlob(
    new Blob([archive as unknown as BlobPart], { type: 'application/zip' }),
    `声屿缓存-${stamp}.zip`,
  )
  return entries.length
}
