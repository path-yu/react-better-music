import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlayLevel } from '../types'

export const CACHE_QUALITY_OPTIONS = [
  { value: '64', label: '标准 · 64kbps' },
  { value: '96', label: '较高 · 96kbps' },
  { value: '128', label: '高 · 128kbps' },
]

export const PLAY_QUALITY_OPTIONS: Array<{ value: PlayLevel; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'higher', label: '较高' },
  { value: 'exhigh', label: '极高' },
  { value: 'lossless', label: '无损' },
  { value: 'hires', label: 'Hi-Res' },
]

export type LyricDisplayMode = 'both' | 'original' | 'translation'

export const LYRIC_DISPLAY_OPTIONS: Array<{ value: LyricDisplayMode; label: string }> = [
  { value: 'both', label: '双语对照' },
  { value: 'original', label: '仅原文' },
  { value: 'translation', label: '仅译文' },
]

interface SettingsState {
  cacheBitrate: number
  playLevel: PlayLevel
  /** How lyric lines and their translations are shown. */
  lyricDisplayMode: LyricDisplayMode
  /** Desktop only: block right-click / F12 / DevTools shortcuts. */
  disableDevTools: boolean
  /** Prefer a matched provider for VIP tracks (manual switch is always available). */
  autoReplaceVipSource: boolean
  setCacheBitrate: (value: number) => void
  setPlayLevel: (value: PlayLevel) => void
  setLyricDisplayMode: (value: LyricDisplayMode) => void
  setDisableDevTools: (value: boolean) => void
  setAutoReplaceVipSource: (value: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      cacheBitrate: 96,
      playLevel: 'exhigh',
      lyricDisplayMode: 'both',
      disableDevTools: false,
      autoReplaceVipSource: false,
      setCacheBitrate: (cacheBitrate) => set({ cacheBitrate }),
      setPlayLevel: (playLevel) => set({ playLevel }),
      setLyricDisplayMode: (lyricDisplayMode) => set({ lyricDisplayMode }),
      setDisableDevTools: (disableDevTools) => set({ disableDevTools }),
      setAutoReplaceVipSource: (autoReplaceVipSource) => set({ autoReplaceVipSource }),
    }),
    {
      name: 'react-music-settings',
      version: 2,
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
