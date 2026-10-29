import { msg } from '@lingui/core/macro'
import { apiUrl } from './http'
import { i18n } from '../i18n'
import { reportDesktopLog } from './desktopBridge'
import { isDesktopApp, saveDownloadFile } from './desktopDownloads'
import { toast } from './toast'
import { useSettingsStore } from '../store/settings'

interface CacheMeta {
  id: number
  name: string
  size: number
  createdAt: number
  artists?: string
  duration?: number
  bitrate?: number
}

interface AudioRecord {
  id: number
  blob: Blob
}

export interface CacheableSong {
  id: number
  name: string
  url: string
  artists?: string
  duration?: number
}

const DB_NAME = 'react-music-audio'
const DB_VERSION = 2
const AUDIO_STORE = 'audio'
const META_STORE = 'meta'
// Cached audio is Opus (96kbps by default), roughly 2.9MB per four-minute song.
const MAX_ENTRIES = 60
const MAX_BYTES = 80 * 1024 * 1024

let dbPromise: Promise<IDBDatabase> | null = null
let writeQueue: Promise<void> = Promise.resolve()
const pending = new Map<number, Promise<void>>()
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
        // v2 raises the cached Opus bitrate to 96kbps: drop old 48kbps entries.
        if (db.objectStoreNames.contains(AUDIO_STORE)) {
          db.deleteObjectStore(AUDIO_STORE)
        }
        if (db.objectStoreNames.contains(META_STORE)) {
          db.deleteObjectStore(META_STORE)
        }
        db.createObjectStore(AUDIO_STORE, { keyPath: 'id' })
        const meta = db.createObjectStore(META_STORE, { keyPath: 'id' })
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

export async function getCachedAudio(id: number): Promise<Blob | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    const record = await requestResult<AudioRecord | undefined>(
      db.transaction(AUDIO_STORE, 'readonly').objectStore(AUDIO_STORE).get(id),
    )
    return record?.blob ?? null
  } catch {
    return null
  }
}

/** True when the track already has a cached copy (cheap metadata read). */
export async function hasCachedAudio(id: number): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false
  try {
    const db = await openDb()
    const meta = await requestResult<CacheMeta | undefined>(
      db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(id),
    )
    return Boolean(meta)
  } catch {
    return false
  }
}

async function putCachedAudio(
  id: number,
  name: string,
  blob: Blob,
  extra?: { artists?: string; duration?: number; bitrate?: number },
) {
  if (blob.size > MAX_BYTES) return
  const db = await openDb()
  const transaction = db.transaction([AUDIO_STORE, META_STORE], 'readwrite')
  const record: AudioRecord = { id, blob }
  const meta: CacheMeta = {
    id,
    name,
    size: blob.size,
    createdAt: Date.now(),
    ...extra,
  }
  transaction.objectStore(AUDIO_STORE).put(record)
  transaction.objectStore(META_STORE).put(meta)
  await transactionDone(transaction)
  await trimCache(db)
}

async function trimCache(db: IDBDatabase) {
  const metas = await requestResult<CacheMeta[]>(
    db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll(),
  )
  metas.sort((a, b) => a.createdAt - b.createdAt)
  let count = metas.length
  let bytes = metas.reduce((total, meta) => total + meta.size, 0)
  const removals: number[] = []
  for (const meta of metas) {
    if (count <= MAX_ENTRIES && bytes <= MAX_BYTES) break
    removals.push(meta.id)
    count -= 1
    bytes -= meta.size
  }
  if (!removals.length) return
  const transaction = db.transaction([AUDIO_STORE, META_STORE], 'readwrite')
  const audioStore = transaction.objectStore(AUDIO_STORE)
  const metaStore = transaction.objectStore(META_STORE)
  removals.forEach((id) => {
    audioStore.delete(id)
    metaStore.delete(id)
  })
  await transactionDone(transaction)
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
  const existing = await getCachedAudio(song.id)
  if (existing) return

  const bitrate = useSettingsStore.getState().cacheBitrate
  try {
    // A neighbour prefetch already holds the bytes: reuse them instead of
    // downloading the whole track a second time.
    const input = source ?? (await fetchAudioBlob(song.url))
    const encoded = await encodeOpusOgg(input, bitrate)
    if (epoch !== cacheEpoch) return
    await putCachedAudio(song.id, song.name, encoded, {
      artists: song.artists,
      duration: song.duration,
      bitrate,
    })
  } catch (error) {
    console.warn('[song cache] encode failed:', error)
    throw error
  }
}

function enqueueCache(song: CacheableSong, source?: Blob) {
  if (typeof indexedDB === 'undefined' || pending.has(song.id)) return
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
      pending.delete(song.id)
    })
  writeQueue = task
  pending.set(song.id, task)
}

export function cacheSong(song: CacheableSong) {
  enqueueCache(song)
}

/** Cache from a Blob already downloaded by the neighbour prefetch. */
export function cacheSongFromBlob(song: CacheableSong, blob: Blob) {
  enqueueCache(song, blob)
}

export interface CachedAudioItem {
  id: number
  name: string
  size: number
  createdAt: number
  artists?: string
  duration?: number
  bitrate?: number
}

export async function listCachedAudio(): Promise<CachedAudioItem[]> {
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

export async function clearAudioCache() {
  if (typeof indexedDB === 'undefined') return
  cacheEpoch += 1
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
export async function downloadCachedAudio(ids: number[]): Promise<number> {
  if (typeof indexedDB === 'undefined' || !ids.length) return 0
  const db = await openDb()
  const desktop = isDesktopApp()
  const entries: Array<{ meta: CacheMeta; blob: Blob }> = []

  for (const id of ids) {
    const meta = await requestResult<CacheMeta | undefined>(
      db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(id),
    )
    if (!meta) continue
    const record = await requestResult<AudioRecord | undefined>(
      db.transaction(AUDIO_STORE, 'readonly').objectStore(AUDIO_STORE).get(id),
    )
    if (!record) continue
    entries.push({ meta, blob: record.blob })
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
