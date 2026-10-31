import { create } from 'zustand'

interface VideoPlaybackState {
  active: boolean
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  setActive: (active: boolean) => void
  bind: (video: HTMLVideoElement | null) => void
  toggle: () => void
  seek: (time: number) => void
  setVolume: (value: number) => void
}

let videoElement: HTMLVideoElement | null = null
let cleanup: (() => void) | null = null

export const useVideoPlaybackStore = create<VideoPlaybackState>((set) => ({
  active: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 100,

  setActive(active) {
    set({ active })
  },

  bind(video) {
    cleanup?.()
    cleanup = null
    videoElement = video
    if (!video) {
      set({ playing: false, currentTime: 0, duration: 0 })
      return
    }

    const sync = () => {
      set({
        playing: !video.paused,
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        volume: Math.round(video.volume * 100),
      })
    }
    const events = [
      'timeupdate',
      'durationchange',
      'loadedmetadata',
      'play',
      'pause',
      'volumechange',
      'ended',
    ] as const
    for (const event of events) video.addEventListener(event, sync)
    sync()

    cleanup = () => {
      for (const event of events) video.removeEventListener(event, sync)
      videoElement = null
    }
  },

  toggle() {
    const video = videoElement
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  },

  seek(time) {
    const video = videoElement
    if (!video) return
    video.currentTime = Math.max(0, Math.min(time, video.duration || time))
    set({ currentTime: video.currentTime })
  },

  setVolume(value) {
    const video = videoElement
    if (!video) {
      set({ volume: value })
      return
    }
    video.volume = Math.max(0, Math.min(1, value / 100))
    set({ volume: value })
  },
}))
