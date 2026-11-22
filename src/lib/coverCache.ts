/**
 * Persistent artwork cache backed by Cache Storage. Audio is stored separately
 * (IndexedDB / desktop files), but covers need their own bucket so cached songs
 * still show artwork when the network is unavailable.
 */
import { isDesktopApp } from './desktopDownloads'
import {
  desktopAudioCacheAssetGet,
  desktopAudioCacheAssetPut,
} from './desktopAudioCache'

const COVER_CACHE = 'react-music-covers'
/** Object URLs handed out for cached covers; oldest are revoked past the cap. */
const objectUrls = new Map<string, string>()
const MAX_OBJECT_URLS = 120
/** Covers already stored (or being stored) this session: skip the lookup too. */
const storedCovers = new Set<string>()

function rememberObjectUrl(src: string, url: string) {
  objectUrls.set(src, url)
  while (objectUrls.size > MAX_OBJECT_URLS) {
    const oldest = objectUrls.entries().next().value
    if (!oldest) break
    objectUrls.delete(oldest[0])
    URL.revokeObjectURL(oldest[1])
  }
}

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
export async function cacheCoverImage(
  src?: string | null,
  songId?: number,
): Promise<void> {
  if (!src || !/^https?:\/\//i.test(src)) return
  // Called on every track start: a replayed song used to download its cover
  // from the CDN again before noticing it was already cached.
  if (storedCovers.has(src)) return
  storedCovers.add(src)
  const desktop = isDesktopApp() && Boolean(songId)
  try {
    if (desktop) {
      // Desktop covers are indexed by URL (one sidecar file per URL).
      const existing = await desktopAudioCacheAssetGet('cover', { url: src }).catch(
        () => null,
      )
      if (existing?.size) return
    } else {
      if (!canUseCacheStorage()) return
      const cache = await caches.open(COVER_CACHE)
      if (await cache.match(src)) return
    }

    const response = await fetchCover(src)
    if (!response) {
      storedCovers.delete(src)
      return
    }

    // Desktop caches artwork next to the .opus files, inside the user-selected
    // cache directory, instead of only in the WebView profile.
    if (desktop && songId) {
      try {
        const blob = await response.clone().blob()
        const ext =
          blob.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '').slice(0, 5) ||
          'jpg'
        await desktopAudioCacheAssetPut('cover', blob, {
          id: songId,
          url: src,
          ext,
        })
        return
      } catch {
        // Fall back to Cache Storage below.
      }
    }

    if (!canUseCacheStorage()) return
    const cache = await caches.open(COVER_CACHE)
    await cache.put(src, response)
  } catch {
    // Artwork is best-effort; offline playback still works without it.
    storedCovers.delete(src)
  }
}

/** Return a local object URL for a previously cached cover. */
export async function getCachedCoverUrl(
  src?: string | null,
): Promise<string | null> {
  if (!src) return null
  const existing = objectUrls.get(src)
  if (existing) {
    // Refresh its position so frequently shown covers are not revoked.
    objectUrls.delete(src)
    objectUrls.set(src, existing)
    return existing
  }

  if (isDesktopApp()) {
    try {
      const blob = await desktopAudioCacheAssetGet('cover', { url: src })
      if (blob?.size) {
        const url = URL.createObjectURL(blob)
        rememberObjectUrl(src, url)
        return url
      }
    } catch {
      // Older builds or a missing sidecar fall through to Cache Storage.
    }
  }

  if (!canUseCacheStorage()) return null
  try {
    const cache = await caches.open(COVER_CACHE)
    const response = await cache.match(src)
    if (!response) return null
    const blob = await response.blob()
    if (!blob.size) return null
    const url = URL.createObjectURL(blob)
    rememberObjectUrl(src, url)
    return url
  } catch {
    return null
  }
}
