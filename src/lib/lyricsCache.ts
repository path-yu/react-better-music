import type { Song } from '../types'

export interface CachedLyrics {
  id: number
  lyric: string
  tlyric: string
  yrc: string
  isNotLyric: boolean
  savedAt: number
}

export type LyricsPatch = Pick<
  Song,
  'lyric' | 'tlyric' | 'yrc' | 'isNotLyric'
>

const DB_NAME = 'react-music-lyrics'
const DB_VERSION = 1
const STORE = 'lyrics'
/** Enough for a long queue history without growing WebView storage without bound. */
const MAX_ENTRIES = 400

let dbPromise: Promise<IDBDatabase> | null = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('savedAt', 'savedAt')
        }
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

function toPatch(record: CachedLyrics): LyricsPatch {
  return {
    lyric: record.lyric,
    tlyric: record.tlyric,
    yrc: record.yrc,
    isNotLyric: record.isNotLyric,
  }
}

export async function getCachedLyrics(id: number): Promise<CachedLyrics | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    const record = await requestResult<CachedLyrics | undefined>(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(id),
    )
    return record ?? null
  } catch {
    return null
  }
}

export async function getCachedLyricsPatch(
  id: number,
): Promise<LyricsPatch | null> {
  const record = await getCachedLyrics(id)
  return record ? toPatch(record) : null
}

/** Persist immediately after a lyric response so switching back never waits. */
export async function saveCachedLyrics(
  id: number,
  patch: LyricsPatch,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const db = await openDb()
    const record: CachedLyrics = {
      id,
      lyric: patch.lyric ?? '',
      tlyric: patch.tlyric ?? '',
      yrc: patch.yrc ?? '',
      isNotLyric: Boolean(patch.isNotLyric),
      savedAt: Date.now(),
    }
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(record)
    await transactionDone(transaction)

    const count = await requestResult(
      db.transaction(STORE, 'readonly').objectStore(STORE).count(),
    )
    if (count <= MAX_ENTRIES) return
    const trim = db.transaction(STORE, 'readwrite')
    const store = trim.objectStore(STORE)
    const cursorRequest = store.index('savedAt').openCursor()
    let remove = count - MAX_ENTRIES
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor || remove <= 0) return
      cursor.delete()
      remove -= 1
      cursor.continue()
    }
    await transactionDone(trim)
  } catch {
    // Lyrics still work without persistence; never block playback on cache IO.
  }
}

export async function clearCachedLyrics(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const db = await openDb()
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).clear()
    await transactionDone(transaction)
  } catch {
    // Best effort.
  }
}
