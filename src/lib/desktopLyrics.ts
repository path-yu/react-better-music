import { useEffect } from 'react'
import type { LyricLine } from './lyric'
import { formatArtists } from './format'
import { bridgeFetch, isDesktopApp } from './desktopBridge'
import { usePlayerStore } from '../store/player'
import { useSettingsStore } from '../store/settings'

/**
 * The desktop lyrics HUD is a tiny standalone page served by the Bun bridge
 * (`/lyrics`). The main window pushes the current lyric + position to the
 * bridge, and the HUD polls it back. No cross-window JS context is required.
 */
const TIME_STEP = 250
/** Re-send a full snapshot periodically so a missed post (bridge still booting) heals. */
const FULL_REFRESH = 5000

type LyricsSnapshot = {
  songId: number | null
  title: string
  artists: string
  lines: Array<Pick<LyricLine, 'time' | 'content' | 'translate'>>
  showTranslation: boolean
  time: number
  playing: boolean
}

function post(body: unknown) {
  void bridgeFetch('/lyrics-state', {
    method: 'POST',
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

function snapshot(): LyricsSnapshot {
  const state = usePlayerStore.getState()
  const song = state.queue[state.currentIndex]
  return {
    songId: song?.id ?? null,
    title: song?.name ?? '',
    artists: formatArtists(song?.ar),
    lines: state.lyricLines.map((line) => ({
      time: line.time,
      content: line.content,
      translate: line.translate,
    })),
    showTranslation: useSettingsStore.getState().showLyricTranslation,
    time: state.currentTime,
    playing: state.playing,
  }
}

/**
 * Main window side. Store subscriptions keep this off the React render path:
 * full snapshots are sent only when the track/lyrics change, while progress is
 * throttled to ~4 updates per second.
 */
export function useDesktopLyricsPublisher() {
  useEffect(() => {
    if (!isDesktopApp()) return

    let songId: number | null | undefined
    let lines: LyricLine[] | undefined
    let translation: boolean | undefined
    let playing: boolean | undefined
    let sentAt = 0
    let fullSentAt = 0

    const publishFull = () => {
      const state = usePlayerStore.getState()
      const song = state.queue[state.currentIndex]
      songId = song?.id ?? null
      lines = state.lyricLines
      translation = useSettingsStore.getState().showLyricTranslation
      playing = state.playing
      sentAt = performance.now()
      fullSentAt = sentAt
      post({ type: 'full', ...snapshot() })
    }

    const publishTime = () => {
      const state = usePlayerStore.getState()
      playing = state.playing
      sentAt = performance.now()
      post({ type: 'time', time: state.currentTime, playing: state.playing })
    }

    publishFull()

    const unsubscribePlayer = usePlayerStore.subscribe((state) => {
      const song = state.queue[state.currentIndex]
      const nextId = song?.id ?? null
      const nextTranslation = useSettingsStore.getState().showLyricTranslation
      const structural =
        nextId !== songId || state.lyricLines !== lines || nextTranslation !== translation
      if (structural || performance.now() - fullSentAt >= FULL_REFRESH) {
        publishFull()
        return
      }
      if (state.playing !== playing || performance.now() - sentAt >= TIME_STEP) {
        publishTime()
      }
    })

    // Hiding/showing the translation only touches the settings store.
    const unsubscribeSettings = useSettingsStore.subscribe(() => {
      if (useSettingsStore.getState().showLyricTranslation !== translation) publishFull()
    })

    return () => {
      unsubscribePlayer()
      unsubscribeSettings()
    }
  }, [])
}
