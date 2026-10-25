import { useRouterState } from '@tanstack/react-router'
import { Music2 } from 'lucide-react'
import { isDesktopShell } from '../../lib/desktop'

const TITLES: Array<[string, string]> = [
  ['/songlists/', '歌单'],
  ['/songlists', '推荐歌单'],
  ['/latest-music', '最新音乐'],
  ['/latest-mv', '最新MV'],
  ['/mv/', 'MV'],
  ['/search', '搜索'],
  ['/profile', '个人信息'],
  ['/', '发现音乐'],
]

export function TitleBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const subtitle = TITLES.find(([path]) => pathname === path || pathname.startsWith(path))?.[1]

  // Desktop builds use the native window frame; the in-app title bar is only
  // part of the web demo's macOS window illusion.
  if (isDesktopShell()) return null

  return (
    <div className="titlebar">
      <div className="traffic-lights">
        <span className="traffic-dot red" />
        <span className="traffic-dot yellow" />
        <span className="traffic-dot green" />
      </div>
      <div className="titlebar-title flex items-center gap-1.5">
        <Music2 className="h-3.5 w-3.5 text-[#0066cc]" strokeWidth={2.2} />
        声屿
        {subtitle && subtitle !== '发现音乐' ? (
          <span className="font-normal text-black/35">— {subtitle}</span>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-1.5 text-[10.5px] text-black/30">
        <span className="hidden sm:inline">macOS Edition</span>
      </div>
    </div>
  )
}
