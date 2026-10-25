import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { apiUrl } from './http'
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
let ffmpegPromise: Promise<FfmpegBundle> | null = null
let writeQueue: Promise<void> = Promise.resolve()
const pending = new Map<number, Promise<void>>()

interface FfmpegBundle {
  ffmpeg: FFmpeg
  fetchFile: (file?: string | File | Blob) => Promise<Uint8Array>
  logs: string[]
}

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

async function loadFfmpeg(): Promise<FfmpegBundle> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { fetchFile }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ])
      const ffmpeg = new FFmpeg()
      const logs: string[] = []
      ffmpeg.on('log', ({ message }) => {
        logs.push(message)
        if (logs.length > 60) logs.shift()
      })
      await ffmpeg.load()
      return { ffmpeg, fetchFile, logs }
    })().catch((error) => {
      ffmpegPromise = null
      throw error
    })
  }
  return ffmpegPromise
}

async function transcodeAndStore(song: CacheableSong) {
  const existing = await getCachedAudio(song.id)
  if (existing) return

  const { ffmpeg, fetchFile, logs } = await loadFfmpeg()
  const input = `cache-${song.id}.mp3`
  const output = `cache-${song.id}.opus`
  const bitrate = useSettingsStore.getState().cacheBitrate
  // The NetEase CDN does not send CORS headers, so download through the
  // local same-origin audio proxy before handing the bytes to ffmpeg.
  const proxied = apiUrl('/audio/proxy', { url: song.url })

  try {
    const bytes = await fetchFile(proxied)
    await ffmpeg.writeFile(input, bytes)
    const code = await ffmpeg.exec([
      '-i',
      input,
      '-vn',
      '-strict',
      '-2',
      '-c:a',
      'opus',
      '-b:a',
      `${bitrate}k`,
      output,
    ])
    if (code !== 0) {
      throw new Error(`ffmpeg exited with ${code}: ${logs.slice(-6).join(' | ')}`)
    }
    const data = await ffmpeg.readFile(output)
    if (!(data instanceof Uint8Array) || data.length === 0) {
      throw new Error('ffmpeg produced an empty file')
    }
    await putCachedAudio(
      song.id,
      song.name,
      new Blob([new Uint8Array(data)], { type: 'audio/ogg' }),
      { artists: song.artists, duration: song.duration, bitrate },
    )
  } catch (error) {
    console.warn('[song cache] ffmpeg logs:', logs.slice(-12).join('\n'))
    throw error
  } finally {
    await ffmpeg.deleteFile(input).catch(() => undefined)
    await ffmpeg.deleteFile(output).catch(() => undefined)
  }
}

export function cacheSong(song: CacheableSong) {
  if (typeof indexedDB === 'undefined' || pending.has(song.id)) return
  // ffmpeg shares one virtual filesystem, so cache jobs must run in sequence.
  const task = writeQueue
    .then(() => transcodeAndStore(song))
    .catch((error) => {
      console.warn('[song cache] failed:', error)
    })
    .finally(() => {
      pending.delete(song.id)
    })
  writeQueue = task
  pending.set(song.id, task)
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
  const db = await openDb()
  const transaction = db.transaction([AUDIO_STORE, META_STORE], 'readwrite')
  transaction.objectStore(AUDIO_STORE).clear()
  transaction.objectStore(META_STORE).clear()
  await transactionDone(transaction)
}

function cacheFileName(meta: CacheMeta) {
  const base = meta.artists ? `${meta.artists} - ${meta.name}` : meta.name
  const safe = base.replace(/[\\/:*?"<>|]/g, '_').trim()
  return `${safe || 'cached-song'}.opus`
}

/** Export the given cached tracks to the browser/WebView download folder. */
export async function downloadCachedAudio(ids: number[]): Promise<number> {
  if (typeof indexedDB === 'undefined' || !ids.length) return 0
  const db = await openDb()
  let exported = 0
  for (const id of ids) {
    const meta = await requestResult<CacheMeta | undefined>(
      db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(id),
    )
    if (!meta) continue
    const record = await requestResult<AudioRecord | undefined>(
      db.transaction(AUDIO_STORE, 'readonly').objectStore(AUDIO_STORE).get(id),
    )
    if (!record) continue
    const url = URL.createObjectURL(record.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = cacheFileName(meta)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    exported += 1
    await new Promise((resolve) => window.setTimeout(resolve, 250))
  }
  return exported
}
