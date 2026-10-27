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

interface SettingsState {
  cacheBitrate: number
  playLevel: PlayLevel
  /** Show the translated line under each lyric line. */
  showLyricTranslation: boolean
  /** Desktop only: block right-click / F12 / DevTools shortcuts. */
  disableDevTools: boolean
  setCacheBitrate: (value: number) => void
  setPlayLevel: (value: PlayLevel) => void
  setShowLyricTranslation: (value: boolean) => void
  setDisableDevTools: (value: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      cacheBitrate: 96,
      playLevel: 'exhigh',
      showLyricTranslation: true,
      disableDevTools: true,
      setCacheBitrate: (cacheBitrate) => set({ cacheBitrate }),
      setPlayLevel: (playLevel) => set({ playLevel }),
      setShowLyricTranslation: (showLyricTranslation) => set({ showLyricTranslation }),
      setDisableDevTools: (disableDevTools) => set({ disableDevTools }),
    }),
    { name: 'react-music-settings' },
  ),
)
