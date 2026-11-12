import type { ReactNode } from 'react'
import { PopoverContent } from '@pikoloo/darwin-ui'
import { MenuSurface } from '../common/MenuSurface'
import { cn } from '../../lib/format'

interface PlayerMenuContentProps {
  children: ReactNode
  immersive: boolean
  tint?: string
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

/**
 * Popover shell used by the player bar. On the song-detail overlay it drops
 * Darwin's light glass and paints the same cover-tinted dark surface as the
 * queue context menu; everywhere else it keeps the original glass look.
 */
export function PlayerMenuContent({
  children,
  immersive,
  tint,
  className,
  side = 'top',
  align = 'end',
  sideOffset = 10,
}: PlayerMenuContentProps) {
  if (!immersive) {
    // Keep Darwin's original glass popover outside the song detail overlay.
    return (
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        glass
        className={cn(className, 'p-1.5')}
      >
        {children}
      </PopoverContent>
    )
  }

  return (
    <PopoverContent
      side={side}
      align={align}
      sideOffset={sideOffset}
      // Darwin may keep a wrapper border/shadow even with utility classes;
      // `player-menu-popover` removes it with !important and MenuSurface owns
      // the only visible edge.
      className={cn(
        className,
        'player-menu-popover border-0 bg-transparent p-0 shadow-none',
      )}
    >
      <MenuSurface active tint={tint} className="p-1.5">
        <div className="dark">{children}</div>
      </MenuSurface>
    </PopoverContent>
  )
}
