import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import type { PlayLevel } from '../types'
import { activateLocale, defaultLocale, type Locale } from '../i18n'

export const CACHE_QUALITY_OPTIONS: Array<{
  value: string
  label: MessageDescriptor
}> = [
  { value: '64', label: msg`标准 · 64kbps` },
  { value: '96', label: msg`较高 · 96kbps` },
  { value: '128', label: msg`高 · 128kbps` },
]

export const PLAY_QUALITY_OPTIONS: Array<{
  value: PlayLevel
  label: MessageDescriptor
}> = [
  { value: 'standard', label: msg`标准` },
  { value: 'higher', label: msg`较高` },
  { value: 'exhigh', label: msg`极高` },
  { value: 'lossless', label: msg`无损` },
  { value: 'hires', label: msg`Hi-Res` },
]

export type LyricDisplayMode = 'both' | 'original' | 'translation'
export type NowPlayingBackdrop = 'gradient' | 'blur'

export const NOWPLAYING_BACKDROP_OPTIONS: Array<{
  value: NowPlayingBackdrop
  label: MessageDescriptor
}> = [
  { value: 'gradient', label: msg`动态渐变` },
  { value: 'blur', label: msg`封面模糊` },
]

export const LYRIC_DISPLAY_OPTIONS: Array<{
  value: LyricDisplayMode
  label: MessageDescriptor
}> = [
  { value: 'both', label: msg`双语对照` },
  { value: 'original', label: msg`仅原文` },
  { value: 'translation', label: msg`仅译文` },
]

interface SettingsState {
  cacheBitrate: number
  playLevel: PlayLevel
  /** How lyric lines and their translations are shown. */
  lyricDisplayMode: LyricDisplayMode
  /** Visual treatment behind the immersive player. */
  nowPlayingBackdrop: NowPlayingBackdrop
  /** Desktop only: block right-click / F12 / DevTools shortcuts. */
  disableDevTools: boolean
  /** Prefer a matched provider for VIP tracks (manual switch is always available). */
  autoReplaceVipSource: boolean
  /** UI language; the source catalog is Simplified Chinese. */
  locale: Locale
  setCacheBitrate: (value: number) => void
  setPlayLevel: (value: PlayLevel) => void
  setLyricDisplayMode: (value: LyricDisplayMode) => void
  setNowPlayingBackdrop: (value: NowPlayingBackdrop) => void
  setDisableDevTools: (value: boolean) => void
  setAutoReplaceVipSource: (value: boolean) => void
  setLocale: (value: Locale) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      cacheBitrate: 96,
      playLevel: 'exhigh',
      lyricDisplayMode: 'both',
      nowPlayingBackdrop: 'gradient',
      disableDevTools: false,
      autoReplaceVipSource: false,
      locale: defaultLocale,
      setCacheBitrate: (cacheBitrate) => set({ cacheBitrate }),
      setPlayLevel: (playLevel) => set({ playLevel }),
      setLyricDisplayMode: (lyricDisplayMode) => set({ lyricDisplayMode }),
      setNowPlayingBackdrop: (nowPlayingBackdrop) => set({ nowPlayingBackdrop }),
      setDisableDevTools: (disableDevTools) => set({ disableDevTools }),
      setAutoReplaceVipSource: (autoReplaceVipSource) => set({ autoReplaceVipSource }),
      setLocale: (locale) => {
        activateLocale(locale)
        set({ locale })
      },
    }),
    {
      name: 'react-music-settings',
      version: 3,
      // v1 stored a boolean translation switch; keep "off" users in original mode.
      migrate: (persisted, version) => {
        const previous = persisted as Partial<SettingsState> & {
          showLyricTranslation?: boolean
        }
        if (version < 2) {
          return {
            ...previous,
            lyricDisplayMode:
              previous.showLyricTranslation === false ? 'original' : 'both',
          }
        }
        return previous
      },
    },
  ),
)
