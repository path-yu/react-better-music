import { useEffect, useState, type MouseEvent } from 'react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useRouterState } from '@tanstack/react-router'
import { Copy, Minus, Music2, Square, X } from 'lucide-react'
import { isDesktopShell } from '../../lib/desktop'
import { usePlayerStore } from '../../store/player'
import {
  closeWindow,
  desktopPlatform,
  getWindowState,
  minimizeWindow,
  toggleMaximizeWindow,
} from '../../lib/desktopWindow'

const TITLES: Array<[string, MessageDescriptor]> = [
  ['/songlists/', msg`歌单`],
  ['/songlists', msg`推荐歌单`],
  ['/latest-music', msg`最新音乐`],
  ['/latest-mv', msg`最新MV`],
  ['/mv/', msg`MV`],
  ['/search', msg`搜索`],
  ['/profile', msg`个人信息`],
  ['/settings', msg`设置`],
  ['/', msg`发现音乐`],
]

// Electrobun's preload turns these classes into native window dragging.
const DRAG_CLASS = 'electrobun-webkit-app-region-drag'
const NO_DRAG_CLASS = 'electrobun-webkit-app-region-no-drag'

export function TitleBar() {
  const { i18n } = useLingui()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const showNowPlaying = usePlayerStore((state) => state.showNowPlaying)
  // The immersive song view owns the whole window; the underlying route label
  // would be misleading there, so the chrome switches to the playback context.
  const matched = TITLES.find(
    ([path]) => pathname === path || pathname.startsWith(path),
  )?.[1]
  const subtitle = showNowPlaying
    ? i18n._(msg`正在播放`)
    : pathname !== '/' && matched
      ? i18n._(matched)
      : undefined

  if (isDesktopShell()) return <DesktopTitleBar subtitle={subtitle} />

  return (
    <div className="titlebar">
      <div className="traffic-lights">
        <span className="traffic-dot red" />
        <span className="traffic-dot yellow" />
        <span className="traffic-dot green" />
      </div>
      <div className="titlebar-title flex items-center gap-1.5">
        <Music2 className="h-3.5 w-3.5 text-accent" strokeWidth={2.2} />
        声屿
        {subtitle ? (
          <span className="titlebar-subtitle font-normal">— {subtitle}</span>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-1.5 text-[11px] text-black/30">
        <span className="hidden sm:inline">macOS Edition</span>
      </div>
    </div>
  )
}

/**
 * Custom chrome for the Electrobun window. Dragging is handled by the preload
 * (`-webkit-app-region`), while the buttons drive the real window through the
 * local bridge. macOS keeps its native traffic lights, so only Windows and
 * Linux get the in-app buttons.
 */
function DesktopTitleBar({ subtitle }: { subtitle?: string }) {
  const nativeControls = desktopPlatform() === 'macos'
  const [maximized, setMaximized] = useState(false)

  // Keep the maximize icon in sync with the OS: snapping, double-clicking the
  // title bar or keyboard shortcuts all change the state behind our back.
  useEffect(() => {
    if (nativeControls) return
    let active = true
    let timer: number | undefined

    const sync = () => {
      getWindowState()
        .then((state) => {
          if (active) setMaximized(state.maximized)
        })
        .catch(() => {
          // The bridge may still be booting; keep the current icon.
        })
    }
    const scheduleSync = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(sync, 120)
    }

    sync()
    window.addEventListener('resize', scheduleSync)
    window.addEventListener('focus', sync)
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('resize', scheduleSync)
      window.removeEventListener('focus', sync)
    }
  }, [nativeControls])

  const handleToggleMaximize = () => {
    void toggleMaximizeWindow()
      .then((state) => setMaximized(state.maximized))
      .catch(() => {
        // Ignore: the window is already in an unknown state, keep the UI calm.
      })
  }

  const handleBarDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    handleToggleMaximize()
  }

  return (
    <div
      className={`desktop-titlebar ${DRAG_CLASS}${nativeControls ? ' desktop-titlebar--mac' : ''}`}
      onDoubleClick={nativeControls ? undefined : handleBarDoubleClick}
    >
      <div className="titlebar-title flex items-center gap-1.5">
        <Music2 className="h-3.5 w-3.5 text-accent" strokeWidth={2.2} />
        声屿
        {subtitle ? (
          <span className="titlebar-subtitle font-normal">— {subtitle}</span>
        ) : null}
      </div>

      {nativeControls ? null : (
        <div className="desktop-titlebar__controls">
          <button
            type="button"
            aria-label="最小化"
            title="最小化"
            className={`desktop-titlebar__button ${NO_DRAG_CLASS}`}
            onClick={() => void minimizeWindow().catch(() => {})}
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={1.7} />
          </button>
          <button
            type="button"
            aria-label={maximized ? '向下还原' : '最大化'}
            title={maximized ? '向下还原' : '最大化'}
            className={`desktop-titlebar__button ${NO_DRAG_CLASS}`}
            onClick={handleToggleMaximize}
          >
            {maximized ? (
              <Copy className="h-3 w-3 -scale-x-100" strokeWidth={1.6} />
            ) : (
              <Square className="h-[11px] w-[11px]" strokeWidth={1.6} />
            )}
          </button>
          <button
            type="button"
            aria-label="关闭"
            title="关闭到托盘"
            className={`desktop-titlebar__button desktop-titlebar__button--close ${NO_DRAG_CLASS}`}
            onClick={() => void closeWindow().catch(() => {})}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.7} />
          </button>
        </div>
      )}
    </div>
  )
}
