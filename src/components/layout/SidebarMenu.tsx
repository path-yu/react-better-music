import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/format'

export interface SidebarMenuItem {
  key: string
  label: ReactNode
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * Small anchored menu for the sidebar: the playlist context menu and the
 * "＋" (new / import) menu. Same surface, keyboard and dismiss behaviour as
 * the song context menu.
 */
export function SidebarMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number
  y: number
  label: string
  items: SidebarMenuItem[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Hand focus back to whatever opened the menu once it closes.
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Captured on window and stopped here, so the song page (which closes
        // on Escape from a document listener) stays open under the menu.
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const buttons = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      )
      if (!buttons.length) return
      event.preventDefault()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowDown'
              ? (index + 1) % buttons.length
              : index <= 0
                ? buttons.length - 1
                : index - 1
      buttons[next]?.focus()
    }
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const width = 184
  const height = items.length * 32 + 8
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8))

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="song-context-menu fixed z-[1000] min-w-[190px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-[10px] border border-black/10 bg-white/90 p-1 text-[12px] shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur-2xl [scrollbar-width:none]"
      style={{ left, top, width }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left transition-colors hover:bg-black/6 disabled:opacity-50',
            item.danger ? 'text-danger' : 'text-ink-2',
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
