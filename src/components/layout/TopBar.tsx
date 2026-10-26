import { useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Disc3, Menu, Moon, Settings2, Sun } from 'lucide-react'
import { SearchBox } from './SearchBox'
import { UserMenu } from './UserMenu'
import { usePlayerStore } from '../../store/player'
import { useUiStore } from '../../store/ui'

export function TopBar() {
  const navigate = useNavigate()
  const queue = usePlayerStore((state) => state.queue)
  const showNowPlaying = usePlayerStore((state) => state.showNowPlaying)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const theme = useUiStore((state) => state.theme)
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  return (
    <header className="pushbar-glass relative z-50 flex h-[54px] flex-none items-center gap-3 px-4">
      <button
        type="button"
        aria-label="打开导航"
        onClick={toggleSidebar}
        className="pressable flex h-7 w-7 items-center justify-center rounded-[7px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 md:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-1 max-md:hidden">
        <button
          type="button"
          aria-label="后退"
          onClick={() => window.history.back()}
          className="pressable flex h-7 w-7 items-center justify-center rounded-[7px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="前进"
          onClick={() => window.history.forward()}
          className="pressable flex h-7 w-7 items-center justify-center rounded-[7px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75"
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
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          title={theme === 'dark' ? '浅色模式' : '深色模式'}
          onClick={toggleTheme}
          className="pressable max-md:hidden flex h-7 w-7 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black/75"
        >
          {theme === 'dark' ? <Sun className="h-[15px] w-[15px]" /> : <Moon className="h-[15px] w-[15px]" />}
        </button>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={() => toggleNowPlaying()}
            className={`pressable max-md:hidden flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] transition-colors ${
              showNowPlaying
                ? 'bg-[#0066cc]/10 text-[#0066cc]'
                : 'text-black/40 hover:bg-black/5 hover:text-black/70'
            }`}
          >
            <Disc3 className={`h-3.5 w-3.5 ${showNowPlaying ? 'animate-spin [animation-duration:6s]' : ''}`} />
            正在播放
          </button>
        )}
        <button
          type="button"
          aria-label="设置"
          title="设置"
          onClick={() => navigate({ to: '/settings' })}
          className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black/75"
        >
          <Settings2 className="h-[15px] w-[15px]" />
        </button>
        <UserMenu />
      </div>
    </header>
  )
}
