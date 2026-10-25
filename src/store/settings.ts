import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const CACHE_QUALITY_OPTIONS = [
  { value: '64', label: '标准 · 64kbps' },
  { value: '96', label: '较高 · 96kbps' },
  { value: '128', label: '高 · 128kbps' },
]

interface SettingsState {
  cacheBitrate: number
  setCacheBitrate: (value: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      cacheBitrate: 96,
      setCacheBitrate: (cacheBitrate) => set({ cacheBitrate }),
    }),
    { name: 'react-music-settings' },
  ),
)
