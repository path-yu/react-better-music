import { useEffect } from 'react'
import type { LyricLine } from './lyric'
import { formatArtists } from './format'
import { bridgeFetch, isDesktopApp } from './desktopBridge'
import { usePlayerStore } from '../store/player'
import { useSettingsStore, type LyricDisplayMode } from '../store/settings'

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
  album: string
  cover: string
  /** Track length in ms, used by the mini player progress bar. */
  duration: number
  lines: Array<Pick<LyricLine, 'time' | 'content' | 'translate'>>
  displayMode: LyricDisplayMode
  time: number
  playing: boolean
}

/**
 * One request in flight at a time. Without this, a bridge that stops answering
 * accumulates one 15s fetch every 250ms and can make the renderer sluggish.
 */
let posting = false
let queued: { body: unknown; full: boolean } | null = null

function send(body: unknown) {
  posting = true
  void bridgeFetch('/lyrics-state', {
    method: 'POST',
    body: JSON.stringify(body),
  })
    .catch(() => undefined)
    .finally(() => {
      posting = false
      if (!queued) return
      const next = queued
      queued = null
      send(next.body)
    })
}

function post(body: unknown, full = false) {
  if (!posting) {
    send(body)
    return
  }
  // Progress ticks must never overwrite a pending full snapshot.
  if (full || !queued) queued = { body, full }
}

function snapshot(): LyricsSnapshot {
  const state = usePlayerStore.getState()
  const song = state.queue[state.currentIndex]
  return {
    songId: song?.id ?? null,
    title: song?.name ?? '',
    artists: formatArtists(song?.ar),
    album: song?.al.name ?? '',
    cover: song?.al.picUrl ?? '',
    duration: song?.dt ?? 0,
    lines: state.lyricLines.map((line) => ({
      time: line.time,
      content: line.content,
      translate: line.translate,
    })),
    displayMode: useSettingsStore.getState().lyricDisplayMode,
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
    let displayMode: LyricDisplayMode | undefined
    let playing: boolean | undefined
    let sentAt = 0
    let fullSentAt = 0

    const publishFull = () => {
      const state = usePlayerStore.getState()
      const song = state.queue[state.currentIndex]
      songId = song?.id ?? null
      lines = state.lyricLines
      displayMode = useSettingsStore.getState().lyricDisplayMode
      playing = state.playing
      sentAt = performance.now()
      fullSentAt = sentAt
      post({ type: 'full', ...snapshot() }, true)
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
      const nextMode = useSettingsStore.getState().lyricDisplayMode
      const structural =
        nextId !== songId || state.lyricLines !== lines || nextMode !== displayMode
      if (structural || performance.now() - fullSentAt >= FULL_REFRESH) {
        publishFull()
        return
      }
      if (state.playing !== playing || performance.now() - sentAt >= TIME_STEP) {
        publishTime()
      }
    })

    // Switching the lyric mode only touches the settings store.
    const unsubscribeSettings = useSettingsStore.subscribe(() => {
      if (useSettingsStore.getState().lyricDisplayMode !== displayMode) publishFull()
    })

    return () => {
      unsubscribePlayer()
      unsubscribeSettings()
    }
  }, [])
}
