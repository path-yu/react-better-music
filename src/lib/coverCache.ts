/**
 * Persistent artwork cache backed by Cache Storage. Audio is stored separately
 * (IndexedDB / desktop files), but covers need their own bucket so cached songs
 * still show artwork when the network is unavailable.
 */
const COVER_CACHE = 'react-music-covers'
const objectUrls = new Map<string, string>()

function canUseCacheStorage() {
  return typeof caches !== 'undefined'
}

async function fetchCover(src: string) {
  try {
    const response = await fetch(src, { mode: 'cors' })
    if (response.ok) return response
  } catch {
    // NetEase CDNs occasionally reject direct CORS requests; retry via the
    // same image proxy used for palette extraction.
  }
  const proxied = `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=640&h=640&output=jpg`
  const response = await fetch(proxied, { mode: 'cors' })
  return response.ok ? response : null
}

/** Cache the raw cover URL whenever a song is played or its audio is cached. */
export async function cacheCoverImage(src?: string | null): Promise<void> {
  if (!src || !/^https?:\/\//i.test(src) || !canUseCacheStorage()) return
  try {
    const cache = await caches.open(COVER_CACHE)
    if (await cache.match(src)) return
    const response = await fetchCover(src)
    if (response) await cache.put(src, response)
  } catch {
    // Artwork is best-effort; offline playback still works without it.
  }
}

/** Return a local object URL for a previously cached cover. */
export async function getCachedCoverUrl(
  src?: string | null,
): Promise<string | null> {
  if (!src || !canUseCacheStorage()) return null
  const existing = objectUrls.get(src)
  if (existing) return existing
  try {
    const cache = await caches.open(COVER_CACHE)
    const response = await cache.match(src)
    if (!response) return null
    const blob = await response.blob()
    if (!blob.size) return null
    const url = URL.createObjectURL(blob)
    objectUrls.set(src, url)
    return url
  } catch {
    return null
  }
}
