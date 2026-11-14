import type { MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sun,
} from 'lucide-react'
import { UserMenu } from './UserMenu'
import { WindowControls } from './WindowControls'
import { useUiStore } from '../../store/ui'
import { cn } from '../../lib/format'
import { isDesktopShell } from '../../lib/desktop'
import { isTauriApp } from '../../lib/platform'
import { desktopPlatform, toggleMaximizeWindow } from '../../lib/desktopWindow'

const DRAG_CLASS = 'electrobun-webkit-app-region-drag'
const NO_DRAG_CLASS = 'electrobun-webkit-app-region-no-drag'

/** The single full-width title bar: navigation, search and window controls. */
export function TopBar() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const theme = useUiStore((state) => state.theme)
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebarCollapsed = useUiStore(
    (state) => state.toggleSidebarCollapsed,
  )
  const desktopChrome = isDesktopShell() || isTauriApp()
  const nativeMacControls =
    desktopChrome && desktopPlatform() === 'macos'

  const handleBarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (!desktopChrome || nativeMacControls) return
    if (
      (event.target as HTMLElement).closest(
        'button, input, textarea, a, [role="button"]',
      )
    ) {
      return
    }
    void toggleMaximizeWindow().catch(() => undefined)
  }

  return (
    <header
      className={cn(
        'pushbar-glass relative z-50 flex h-11 flex-none items-center gap-3 pr-0',
        nativeMacControls ? 'pl-[78px]' : 'pl-4',
        desktopChrome && DRAG_CLASS,
      )}
      onDoubleClick={handleBarDoubleClick}
    >
      <div className="topbar-interactive relative z-10 flex h-full min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          aria-label={i18n._(msg`打开导航`)}
          onClick={toggleSidebar}
          className={cn(
            'pressable pointer-events-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10 md:hidden',
            desktopChrome && NO_DRAG_CLASS,
          )}
        >
          <Menu className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={
            sidebarCollapsed ? i18n._(msg`展开侧栏`) : i18n._(msg`收起侧栏`)
          }
          title={
            sidebarCollapsed ? i18n._(msg`展开侧栏`) : i18n._(msg`收起侧栏`)
          }
          onClick={toggleSidebarCollapsed}
          className={cn(
            'pressable pointer-events-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-black/40 transition-colors hover:bg-black/5 hover:text-black/75 max-md:hidden',
            desktopChrome && NO_DRAG_CLASS,
          )}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
        <div className="flex items-center gap-1 max-md:hidden">
          <button
            type="button"
            aria-label={i18n._(msg`后退`)}
            onClick={() => window.history.back()}
            className={cn(
              'pressable flex h-7 w-7 items-center justify-center rounded-[6px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10',
              desktopChrome && NO_DRAG_CLASS,
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={i18n._(msg`前进`)}
            onClick={() => window.history.forward()}
            className={cn(
              'pressable flex h-7 w-7 items-center justify-center rounded-[6px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10',
              desktopChrome && NO_DRAG_CLASS,
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="min-w-0 flex-1" />

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label={
              theme === 'dark'
                ? i18n._(msg`切换到浅色模式`)
                : i18n._(msg`切换到深色模式`)
            }
            title={
              theme === 'dark' ? i18n._(msg`浅色模式`) : i18n._(msg`深色模式`)
            }
            onClick={toggleTheme}
            className={cn(
              'pressable flex h-7 w-7 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black/75 max-md:hidden',
              desktopChrome && NO_DRAG_CLASS,
            )}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <div
            className={cn(
              'flex items-center',
              desktopChrome && NO_DRAG_CLASS,
            )}
          >
            <UserMenu />
          </div>
          <button
            type="button"
            aria-label={i18n._(msg`设置`)}
            title={i18n._(msg`设置`)}
            onClick={() => navigate({ to: '/settings' })}
            className={cn(
              'pressable flex h-7 w-7 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10',
              desktopChrome && NO_DRAG_CLASS,
            )}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>

        {desktopChrome ? (
          <WindowControls
            className={cn(
              'pointer-events-auto h-full self-stretch',
              NO_DRAG_CLASS,
            )}
          />
        ) : null}
      </div>
    </header>
  )
}
