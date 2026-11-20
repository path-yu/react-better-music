const DB_NAME = 'qimiao-smart-stems'
const DB_VERSION = 1
const STORE = 'stems'

export type CachedStemKind = 'accompaniment' | 'vocals'

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
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
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
