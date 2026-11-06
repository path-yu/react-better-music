import type { CSSProperties, ReactNode } from 'react'
import { menuSurfaceStyle } from '../../lib/menuSurface'
import { cn } from '../../lib/format'

interface MenuSurfaceProps {
  children: ReactNode
  /** Paint the immersive dark surface instead of leaving the parent's style. */
  active?: boolean
  /** Cover colour(s) used for the soft top-right tint. */
  tint?: string | string[]
  className?: string
  style?: CSSProperties
}

/**
 * Shared floating-menu surface for the song-detail player. Both the queue's
 * context menu and the player-bar popovers use the same dark glass and cover
 * tint so menus do not switch back to a light sheet over the fog.
 */
export function MenuSurface({
  children,
  active = false,
  tint,
  className,
  style,
}: MenuSurfaceProps) {
  return (
    <div
      className={cn(active && 'menu-surface', className)}
      style={{ ...(active ? menuSurfaceStyle(tint) : {}), ...style }}
    >
      {children}
    </div>
  )
}
