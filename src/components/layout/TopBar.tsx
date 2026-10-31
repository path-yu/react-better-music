import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sun,
} from 'lucide-react'
import { SearchBox } from './SearchBox'
import { UserMenu } from './UserMenu'
import { usePlayerStore } from '../../store/player'
import { useUiStore } from '../../store/ui'

export function TopBar() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const queue = usePlayerStore((state) => state.queue)
  const showNowPlaying = usePlayerStore((state) => state.showNowPlaying)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const theme = useUiStore((state) => state.theme)
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebarCollapsed = useUiStore(
    (state) => state.toggleSidebarCollapsed,
  )

  return (
    <header className="pushbar-glass relative z-50 flex h-[54px] flex-none items-center gap-3 px-4">
      <button
        type="button"
        aria-label={i18n._(msg`打开导航`)}
        onClick={toggleSidebar}
        className="pressable flex h-7 w-7 items-center justify-center rounded-[6px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10 md:hidden"
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
        className="pressable flex h-7 w-7 items-center justify-center rounded-[6px] text-black/40 transition-colors hover:bg-black/5 hover:text-black/75 max-md:hidden"
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
          className="pressable flex h-7 w-7 items-center justify-center rounded-[6px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={i18n._(msg`前进`)}
          onClick={() => window.history.forward()}
          className="pressable flex h-7 w-7 items-center justify-center rounded-[6px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-2">
        <SearchBox />
      </div>

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
          className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black/75 max-md:hidden"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={() => toggleNowPlaying()}
            className={`pressable max-md:hidden flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] transition-colors ${
              showNowPlaying
                ? 'bg-accent/10 text-accent'
                : 'text-black/40 hover:bg-black/5 hover:text-black/70'
            }`}
          >
            <Disc3 className={`h-4 w-4 ${showNowPlaying ? 'animate-spin [animation-duration:6s]' : ''}`} />
            <Trans>正在播放</Trans>
          </button>
        )}
        <button
          type="button"
          aria-label={i18n._(msg`设置`)}
          title={i18n._(msg`设置`)}
          onClick={() => navigate({ to: '/settings' })}
          className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <UserMenu />
      </div>
    </header>
  )
}
