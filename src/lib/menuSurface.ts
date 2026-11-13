import { useEffect, useState, type CSSProperties } from 'react'
import { extractPalette, withAlpha } from './color'
import { resizedImageUrl } from './image'

/** Cover-coloured tint shared by the player's floating menus. */
export function menuSurfaceStyle(tint?: string | string[]): CSSProperties {
  const colors = Array.isArray(tint) ? tint : tint ? [tint] : []
  if (!colors.length) return {}
  return {
    backgroundImage: `linear-gradient(155deg, ${withAlpha(colors[0], 0.36)}, ${withAlpha(colors[1] ?? colors[0], 0.18)} 52%, transparent 100%)`,
  }
}

/**
 * Last sampled tint per cover. Menus (especially QueuePanel) mount and
 * unmount with `showQueue`, so an async-only value would paint the fallback
 * gradient first and then recolor the whole panel on the next microtask.
 */
const tintCache = new Map<string, string>()

export function cachePlayerMenuTint(
  cover: string | null | undefined,
  tint: string | undefined,
) {
  if (!cover || !tint) return
  tintCache.set(cover, tint)
}

export function getCachedPlayerMenuTint(cover?: string | null) {
  return cover ? tintCache.get(cover) : undefined
}

/** Samples the current cover once for all player-bar popovers. */
export function usePlayerMenuTint(enabled: boolean, cover?: string | null) {
  const cached = enabled ? getCachedPlayerMenuTint(cover) : undefined
  const [tint, setTint] = useState<string | undefined>(cached)

  useEffect(() => {
    if (!enabled) {
      setTint(undefined)
      return
    }
    const existing = getCachedPlayerMenuTint(cover)
    if (existing) {
      setTint(existing)
      return
    }
    const source = resizedImageUrl(cover, '320y320')
    if (!source) {
      setTint(undefined)
      return
    }
    let active = true
    void extractPalette(source)
      .then((palette) => {
        cachePlayerMenuTint(cover, palette.colors[0])
        if (active) setTint(palette.colors[0])
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [enabled, cover])

  // Fall back to the cache during the render in which `cover` changes so
  // consumers can already use a known colour.
  return tint ?? (enabled ? getCachedPlayerMenuTint(cover) : undefined)
}
