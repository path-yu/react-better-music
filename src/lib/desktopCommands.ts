import { useEffect } from 'react'
import { msg } from '@lingui/core/macro'
import { i18n } from '../i18n'
import { isDesktopApp } from './desktopBridge'
import { seekAudio } from './audio'
import { usePlayerStore } from '../store/player'
import { useUserStore } from '../store/user'
import { toast } from './toast'

/**
 * Commands from native surfaces (global shortcuts, tray menu, mini player) are
 * injected by the Bun process through `webview.executeJavascript`; the window
 * only exposes this single entry point.
 */
export type DesktopCommand =
  | 'play-pause'
  | 'next'
  | 'previous'
  | 'like-current'
  | 'volume-up'
  | 'volume-down'

type CommandWindow = Window & {
  __qimiaoDesktopCommand?: (command: string, value?: number) => void
}

export function useDesktopCommands() {
  useEffect(() => {
    if (!isDesktopApp()) return
    const target = window as CommandWindow

    const handle = (command: string, value?: number) => {
      const player = usePlayerStore.getState()
      switch (command) {
        case 'seek':
          if (typeof value === 'number' && Number.isFinite(value)) seekAudio(value)
          break
        case 'play-pause':
          void player.togglePlay()
          break
        case 'next':
          void player.next()
          break
        case 'previous':
          void player.prev()
          break
        case 'volume-up':
          player.setVolume(player.volume + 5)
          break
        case 'volume-down':
          player.setVolume(player.volume - 5)
          break
        case 'like-current': {
          const song = player.queue[player.currentIndex]
          if (!song) return
          const user = useUserStore.getState()
          if (!user.isLogin) {
            toast.warning(i18n._(msg`请先登录后再收藏`))
            return
          }
          const liked = user.likedIds.includes(song.id)
          void user.likeSong(song.id, !liked)
          break
        }
        default:
          break
      }
    }

    target.__qimiaoDesktopCommand = handle
    return () => {
      delete target.__qimiaoDesktopCommand
    }
  }, [])
}
