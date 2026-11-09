import { useEffect } from 'react'
import { scrobbleSong } from '../api'
import { getAudio } from './audio'
import { usePlayerStore } from '../store/player'
import { useSettingsStore } from '../store/settings'
import { useUserStore } from '../store/user'

const TICK_MS = 1_000
/** Never count more than two seconds for one timer tick after a resume. */
const MAX_TICK_MS = 2_000
/** Ignore very short listens even when a track is shorter than a minute. */
const MIN_LISTEN_MS = 30_000
/** Long tracks do not need the full four-minute rule to look natural. */
const MAX_THRESHOLD_MS = 240_000
/** Suppress loop/replay reports for the same track. */
const REPORT_COOLDOWN_MS = 30 * 60_000

function bitrateForLevel(level: string) {
  if (level === 'hires') return 1_999_000
  if (level === 'lossless') return 999_000
  return 320_000
}

/**
 * Opt-in listening report. This is deliberately conservative:
 *
 * - disabled by default;
 * - one report per playToken/song session;
 * - counts decoded media progress, so buffering and seek jumps are not counted;
 * - never retries and never reports trials;
 * - requires a logged-in account because the API needs MUSIC_U.
 */
export function useScrobble() {
  useEffect(() => {
    let lastTick = performance.now()
    let sessionToken = -1
    let sessionSongId = -1
    let listenedMs = 0
    let reported = false
    let lastMediaTime = -1
    const lastReports = new Map<number, number>()

    const resetSession = (token: number, songId: number) => {
      sessionToken = token
      sessionSongId = songId
      listenedMs = 0
      reported = false
      lastMediaTime = -1
    }

    const timer = window.setInterval(() => {
      const now = performance.now()
      const delta = Math.max(
        0,
        Math.min(MAX_TICK_MS, now - lastTick),
      )
      lastTick = now

      if (
        !useSettingsStore.getState().autoScrobble ||
        !useUserStore.getState().isLogin
      ) {
        // Do not accumulate while opt-in is off or the user is anonymous.
        sessionToken = -1
        listenedMs = 0
        reported = false
        return
      }

      const state = usePlayerStore.getState()
      const song = state.queue[state.currentIndex]
      if (!song) return

      if (state.playToken !== sessionToken || song.id !== sessionSongId) {
        resetSession(state.playToken, song.id)
        return
      }
      if (
        reported ||
        !state.playing ||
        (song.trialEnd ?? 0) > 0
      ) {
        return
      }

      const media = getAudio()
      const mediaDuration =
        media && Number.isFinite(media.duration) && media.duration > 0
          ? media.duration * 1000
          : song.dt
      if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return

      // Count decoded media progress rather than wall time. A buffering/stalled
      // element must not look like listening, and a seek jump must not count
      // as hours of playback.
      const mediaTime = media?.currentTime ?? Number.NaN
      if (!media || !Number.isFinite(mediaTime) || media.paused) {
        lastMediaTime = Number.isFinite(mediaTime) ? mediaTime : -1
        return
      }
      if (media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        lastMediaTime = mediaTime
        return
      }
      if (
        lastMediaTime < 0 ||
        mediaTime < lastMediaTime ||
        mediaTime - lastMediaTime > 5
      ) {
        lastMediaTime = mediaTime
        return
      }
      const mediaDelta = (mediaTime - lastMediaTime) * 1000
      lastMediaTime = mediaTime
      // Keep the clock cap for throttled background timers.
      listenedMs += Math.min(delta, mediaDelta)

      const threshold = Math.max(
        MIN_LISTEN_MS,
        Math.min(mediaDuration * 0.5, MAX_THRESHOLD_MS),
      )
      if (listenedMs < threshold) return

      reported = true
      const nowMs = Date.now()
      const previousReport = lastReports.get(song.id) ?? 0
      if (nowMs - previousReport < REPORT_COOLDOWN_MS) return
      lastReports.set(song.id, nowMs)
      const played = Math.min(mediaDuration, Math.round(listenedMs))
      const level = useSettingsStore.getState().playLevel
      void scrobbleSong({
        id: song.id,
        time: played,
        total: Math.round(mediaDuration),
        name: song.name,
        artist: (song.ar ?? []).map((artist) => artist.name).join(' / '),
        bitrate: bitrateForLevel(level),
        level,
        vip: song.fee === 1,
        sourceid: state.playlistId || undefined,
        source: 'list',
      }).catch(() => {
        // A failed report is intentionally not retried: retry storms are more
        // likely to be treated as abnormal traffic.
      })
    }, TICK_MS)

    return () => window.clearInterval(timer)
  }, [])
}
