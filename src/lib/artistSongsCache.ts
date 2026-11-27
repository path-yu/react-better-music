import type { Song } from '../types'

/**
 * "Expand every album's songs" is expensive: one `/artist/album` page per
 * request and one `/album` call per album, deliberately spaced a second apart.
 * Keep the assembled list for a day so collapsing and expanding again (or
 * reopening the artist) does not replay the whole sequence.
 */
const CACHE_PREFIX = 'artist-all-songs'
const CACHE_VERSION = 1
const CACHE_TTL = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 6
/** localStorage is shared with the library; skip entries too large for it. */
const MAX_BYTES = 1_500_000

interface CachedArtistSongs {
  version: number
  savedAt: number
  albumCount: number
  songs: Song[]
}

export interface ArtistSongsSnapshot {
  songs: Song[]
  albumCount: number
}

function storageKey(artistId: string) {
  return `${CACHE_PREFIX}:${CACHE_VERSION}:${artistId}`
}

function parse(raw: string | null): CachedArtistSongs | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as CachedArtistSongs
    if (
      value?.version !== CACHE_VERSION ||
      !Array.isArray(value.songs) ||
      typeof value.savedAt !== 'number'
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // storage may be unavailable
  }
}

export function readArtistSongsCache(
  artistId: string,
): ArtistSongsSnapshot | null {
  try {
    const key = storageKey(artistId)
    const entry = parse(localStorage.getItem(key))
    if (!entry) return null
    if (Date.now() - entry.savedAt > CACHE_TTL) {
      remove(key)
      return null
    }
    return {
      songs: entry.songs,
      albumCount: Number(entry.albumCount) || 0,
    }
  } catch {
    return null
  }
}

export function writeArtistSongsCache(
  artistId: string,
  songs: Song[],
  albumCount: number,
) {
  try {
    // Drop expired entries and keep a few recent artists so one big
    // discography cannot fill the quota by itself.
    const currentKey = storageKey(artistId)
    const others: { key: string; savedAt: number }[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(`${CACHE_PREFIX}:`) || key === currentKey) continue
      const entry = parse(localStorage.getItem(key))
      if (!entry || Date.now() - entry.savedAt > CACHE_TTL) {
        remove(key)
        index -= 1
        continue
      }
      others.push({ key, savedAt: entry.savedAt })
    }
    others.sort((a, b) => a.savedAt - b.savedAt)
    const overflow = Math.max(0, others.length - (MAX_ENTRIES - 1))
    for (const entry of others.slice(0, overflow)) {
      remove(entry.key)
    }

    const payload = JSON.stringify({
      version: CACHE_VERSION,
      savedAt: Date.now(),
      albumCount,
      songs,
    } satisfies CachedArtistSongs)
    if (payload.length > MAX_BYTES) return
    localStorage.setItem(currentKey, payload)
  } catch {
    // Quota or disabled storage: caching must never break browsing.
  }
}
