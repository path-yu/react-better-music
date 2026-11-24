import { create } from 'zustand'
import { msg } from '@lingui/core/macro'
import { i18n } from '../i18n'
import { toast } from '../lib/toast'
import { usePlayerStore } from './player'

interface SleepTimerState {
  /** Epoch ms when the timer fires; null while it is off. */
  endsAt: number | null
  /** Milliseconds left, ticked once per second while armed. */
  remainingMs: number
  /** Armed duration, so the menu can highlight the chosen preset. */
  minutes: number | null
  start: (minutes: number) => void
  cancel: () => void
}

let ticker: number | undefined

function stopTicker() {
  if (ticker === undefined) return
  window.clearInterval(ticker)
  ticker = undefined
}

/**
 * Pauses playback once the countdown ends. Kept out of the player store: this
 * is purely a UI convenience, it never survives a reload, and the player store
 * is already the largest module in the app.
 */
export const useSleepTimerStore = create<SleepTimerState>()((set, get) => ({
  endsAt: null,
  remainingMs: 0,
  minutes: null,

  start(minutes) {
    stopTicker()
    const rounded = Math.max(1, Math.round(minutes))
    const span = rounded * 60_000
    set({ endsAt: Date.now() + span, remainingMs: span, minutes: rounded })
    ticker = window.setInterval(() => {
      const left = (get().endsAt ?? 0) - Date.now()
      if (left > 0) {
        set({ remainingMs: left })
        return
      }
      stopTicker()
      set({ endsAt: null, remainingMs: 0, minutes: null })
      const player = usePlayerStore.getState()
      if (player.playing) player.setPlaying(false)
      toast.info(i18n._(msg`睡眠定时器已结束播放`))
    }, 1000)
    toast.success(i18n._(msg`将在 ${minutes} 分钟后停止播放`))
  },

  cancel() {
    if (get().endsAt === null) return
    stopTicker()
    set({ endsAt: null, remainingMs: 0, minutes: null })
    toast.info(i18n._(msg`已关闭睡眠定时器`))
  },
}))
