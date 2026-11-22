const DB_NAME = 'qimiao-smart-stems'
const DB_VERSION = 1
const STORE = 'stems'

export type CachedStemKind = 'accompaniment' | 'vocals'

/** Two full-length tracks per song add up fast; keep the most recently used. */
const MAX_CACHED_SONGS = 30

type CachedStems = {
  songId: number
  accompaniment?: Blob
  vocals?: Blob
  /** Legacy single-stem cache from the first smart-mode implementation. */
  blob?: Blob
  createdAt: number
}

let databasePromise: Promise<IDBDatabase | null> | null = null

function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'songId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return databasePromise
}

export async function getCachedStem(
  songId: number,
  kind: CachedStemKind = 'accompaniment',
): Promise<Blob | null> {
  const database = await openDatabase()
  if (!database) return null
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).get(songId)
      request.onsuccess = () => {
        const value = request.result as CachedStems | undefined
        const blob =
          kind === 'vocals'
            ? value?.vocals
            : (value?.accompaniment ?? value?.blob)
        resolve(blob instanceof Blob ? blob : null)
        // Mark as recently used so eviction keeps songs that are sung often.
        if (value && blob instanceof Blob) void touchStems(database, value)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Rewrite `createdAt` (used as last-used time); Blobs are stored by reference. */
function touchStems(database: IDBDatabase, value: CachedStems) {
  return new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put({ ...value, createdAt: Date.now() })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Drop the least recently used songs beyond the cap. */
function trimStems(database: IDBDatabase) {
  return new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = store.getAll()
      request.onsuccess = () => {
        const rows = (request.result as CachedStems[]).sort(
          (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
        )
        for (const row of rows.slice(MAX_CACHED_SONGS)) store.delete(row.songId)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Remove every cached stem; returns how many songs were cleared. */
export async function clearCachedStems(): Promise<number> {
  const database = await openDatabase()
  if (!database) return 0
  return new Promise((resolve, reject) => {
    try {
      const transaction = database.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      let count = 0
      const counter = store.count()
      counter.onsuccess = () => {
        count = counter.result
        store.clear()
      }
      transaction.oncomplete = () => resolve(count)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    } catch (error) {
      reject(error)
    }
  })
}

export async function putCachedStems(
  songId: number,
  stems: { accompaniment: Blob; vocals: Blob },
) {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put({
        songId,
        accompaniment: stems.accompaniment,
        vocals: stems.vocals,
        createdAt: Date.now(),
      } satisfies CachedStems)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
  await trimStems(database)
}

export async function deleteCachedStem(songId: number) {
  const database = await openDatabase()
  if (!database) return
  try {
    database.transaction(STORE, 'readwrite').objectStore(STORE).delete(songId)
  } catch {
    // Cache cleanup is best effort.
  }
}
