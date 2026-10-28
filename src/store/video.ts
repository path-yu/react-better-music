import { create } from 'zustand'
import type { VideoItem } from '../types'

interface VideoState {
  open: boolean
  source: VideoItem | null
  playlist: VideoItem[]
  /** Open the standalone video screen; `playlist` powers the related rail. */
  openVideo: (source: VideoItem, playlist?: VideoItem[]) => void
  playVideo: (source: VideoItem) => void
  closeVideo: () => void
}

export const useVideoStore = create<VideoState>((set) => ({
  open: false,
  source: null,
  playlist: [],
  openVideo: (source, playlist = []) =>
    set({
      open: true,
      source,
      playlist: playlist.length ? playlist : [source],
    }),
  playVideo: (source) => set({ source }),
  closeVideo: () => set({ open: false, source: null, playlist: [] }),
}))
