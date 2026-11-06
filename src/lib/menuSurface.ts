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

/** Samples the current cover once for all player-bar popovers. */
export function usePlayerMenuTint(enabled: boolean, cover?: string | null) {
  const [tint, setTint] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!enabled) {
      setTint(undefined)
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
        if (active) setTint(palette.colors[0])
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [enabled, cover])

  return tint
}
