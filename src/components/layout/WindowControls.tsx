import { useEffect, useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { cn } from '../../lib/format'
import {
  closeWindow,
  desktopPlatform,
  getWindowState,
  minimizeWindow,
  toggleMaximizeWindow,
} from '../../lib/desktopWindow'

const NO_DRAG_CLASS = 'electrobun-webkit-app-region-no-drag'

/** Custom caption buttons for the merged title bar. macOS keeps its lights. */
export function WindowControls({ className }: { className?: string }) {
  const { i18n } = useLingui()
  const nativeControls = desktopPlatform() === 'macos'
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
        .catch(() => undefined)
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

  if (nativeControls) return null

  const handleToggleMaximize = () => {
    void toggleMaximizeWindow()
      .then((state) => setMaximized(state.maximized))
      .catch(() => undefined)
  }

  return (
    <div
      className={cn(
        'desktop-titlebar__controls',
        NO_DRAG_CLASS,
        className,
      )}
    >
      <button
        type="button"
        aria-label={i18n._(msg`最小化`)}
        title={i18n._(msg`最小化`)}
        className={`desktop-titlebar__button ${NO_DRAG_CLASS}`}
        onClick={() => void minimizeWindow().catch(() => {})}
      >
        <Minus className="h-4 w-4" strokeWidth={1.7} />
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
          <Square className="h-3 w-3" strokeWidth={1.6} />
        )}
      </button>
      <button
        type="button"
        aria-label={i18n._(msg`关闭`)}
        title={i18n._(msg`关闭到托盘`)}
        className={`desktop-titlebar__button desktop-titlebar__button--close ${NO_DRAG_CLASS}`}
        onClick={() => void closeWindow().catch(() => {})}
      >
        <X className="h-4 w-4" strokeWidth={1.7} />
      </button>
    </div>
  )
}
