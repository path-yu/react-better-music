import { apiUrl } from './http'

interface PrefetchEntry {
  songId: number
  url: string
  trialEnd: number | null
  createdAt: number
}

/** Neighbours only: next + previous (plus one in-flight transition). */
const MAX_ENTRIES = 3

const entries = new Map<number, PrefetchEntry>()
const controllers = new Map<number, AbortController>()
const inflight = new Map<number, Promise<boolean>>()

function revoke(entry?: PrefetchEntry) {
  if (entry) URL.revokeObjectURL(entry.url)
}

function evictOverflow() {
  while (entries.size > MAX_ENTRIES) {
    let oldest: PrefetchEntry | undefined
    for (const entry of entries.values()) {
      if (!oldest || entry.createdAt < oldest.createdAt) oldest = entry
    }
    if (!oldest) break
    entries.delete(oldest.songId)
    revoke(oldest)
  }
}

/** Returns a ready-to-play blob URL without transferring ownership. */
export function getPrefetchedAudio(songId: number) {
  return entries.get(songId) ?? null
}

/**
 * Takes the prefetched track out of the pool. The caller owns the blob URL and
 * must revoke it when the source changes or the player unmounts.
 */
export function consumePrefetchedAudio(songId: number) {
  const entry = entries.get(songId)
  if (!entry) return null
  entries.delete(songId)
  return entry
}

/** Keep only the given neighbours prefetched; abort and free everything else. */
export function retainPrefetchedAudio(songIds: number[]) {
  const keep = new Set(songIds)
  for (const [id, entry] of [...entries]) {
    if (keep.has(id)) continue
    entries.delete(id)
    revoke(entry)
  }
  for (const [id, controller] of [...controllers]) {
    if (keep.has(id)) continue
    controller.abort()
    controllers.delete(id)
  }
}

export function clearPrefetchedAudio() {
  retainPrefetchedAudio([])
}

/**
 * Download the whole track through the local proxy into a Blob. Playing this
 * blob URL later starts instantly, with no network round-trip on track change.
 */
export function prefetchAudio(
  songId: number,
  mediaUrl: string,
  trialEnd: number | null,
): Promise<boolean> {
  if (entries.has(songId)) return Promise.resolve(true)
  const running = inflight.get(songId)
  if (running) return running

  const controller = new AbortController()
  controllers.set(songId, controller)
  const task = (async () => {
    try {
      const response = await fetch(apiUrl('/audio/proxy', { url: mediaUrl }), {
        signal: controller.signal,
      })
      if (!response.ok) return false
      const blob = await response.blob()
      // The neighbour may have been dropped while the response was streaming.
      if (controller.signal.aborted || !blob.size) return false
      entries.set(songId, {
        songId,
        url: URL.createObjectURL(blob),
        trialEnd,
        createdAt: Date.now(),
      })
      evictOverflow()
      return true
    } catch {
      return false
    } finally {
      controllers.delete(songId)
      inflight.delete(songId)
    }
  })()
  inflight.set(songId, task)
  return task
}
