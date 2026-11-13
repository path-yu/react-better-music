import { useEffect, useState, type MouseEvent } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Copy, Minus, Square, X } from 'lucide-react'
import {
  closeWindow,
  desktopPlatform,
  getWindowState,
  minimizeWindow,
  toggleMaximizeWindow,
} from '../../lib/desktopWindow'
import { isTauriApp } from '../../lib/platform'

const DRAG_CLASS = 'electrobun-webkit-app-region-drag'
const NO_DRAG_CLASS = 'electrobun-webkit-app-region-no-drag'

/**
 * The song-detail page owns this title bar outright. It does not share any
 * state or DOM with the external TitleBar, so opening/closing NowPlaying can
 * never re-render or restyle the external chrome.
 */
export function NowPlayingTitleBar() {
  const { i18n } = useLingui()
  const nativeControls = desktopPlatform() === 'macos'
  const tauri = isTauriApp()
  const [maximized, setMaximized] = useState(false)

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
          // The bridge may not be available in a browser preview.
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
      .catch(() => undefined)
  }

  const handleBarDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    handleToggleMaximize()
  }

  return (
    <div
      className={`desktop-titlebar--immersive ${DRAG_CLASS} pointer-events-auto absolute inset-x-0 top-0 z-[200] flex items-stretch ${
        nativeControls ? 'h-[30px]' : 'h-[38px]'
      }`}
      onDoubleClick={nativeControls || tauri ? undefined : handleBarDoubleClick}
    >
      <div className="min-w-0 flex-1" />

      {nativeControls ? null : (
        <div className="desktop-titlebar__controls electrobun-webkit-app-region-no-drag ml-auto">
          <button
            type="button"
            aria-label={i18n._(msg`最小化`)}
            title={i18n._(msg`最小化`)}
            className={`desktop-titlebar__button ${NO_DRAG_CLASS}`}
            onClick={() => void minimizeWindow().catch(() => {})}
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label={maximized ? i18n._(msg`向下还原`) : i18n._(msg`最大化`)}
            title={maximized ? i18n._(msg`向下还原`) : i18n._(msg`最大化`)}
            className={`desktop-titlebar__button ${NO_DRAG_CLASS}`}
            onClick={handleToggleMaximize}
          >
            {maximized ? (
              <Copy className="h-3 w-3 -scale-x-100" strokeWidth={1.7} />
            ) : (
              <Square className="h-[11px] w-[11px]" strokeWidth={1.7} />
            )}
          </button>
          <button
            type="button"
            aria-label={i18n._(msg`关闭`)}
            title={i18n._(msg`关闭到托盘`)}
            className={`desktop-titlebar__button desktop-titlebar__button--close ${NO_DRAG_CLASS}`}
            onClick={() => void closeWindow().catch(() => {})}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  )
}
