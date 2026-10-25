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
  setCacheBitrate: (value: number) => void
  setPlayLevel: (value: PlayLevel) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      cacheBitrate: 96,
      playLevel: 'exhigh',
      setCacheBitrate: (cacheBitrate) => set({ cacheBitrate }),
      setPlayLevel: (playLevel) => set({ playLevel }),
    }),
    { name: 'react-music-settings' },
  ),
)
