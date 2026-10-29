import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronUp,
  Heart,
  Languages,
  ListMusic,
  Loader2,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Subtitles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { ProgressSlider } from './ProgressSlider'
import { VolumeSlider } from './VolumeSlider'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import {
  LYRIC_DISPLAY_OPTIONS,
  PLAY_QUALITY_OPTIONS,
  useSettingsStore,
} from '../../store/settings'
import { cn, formatArtists, formatDuration } from '../../lib/format'
import { getAudio, registerAudio, seekAudio } from '../../lib/audio'
import { isDesktopShell } from '../../lib/desktop'
import {
  getDesktopLyricsVisible,
  getMiniPlayerVisible,
  setDesktopLyricsVisible,
  setMiniPlayerVisible,
} from '../../lib/desktopBridge'
import { cacheSong, cacheSongFromBlob } from '../../lib/songCache'
import { toast } from '../../lib/toast'
import type { PlayLevel } from '../../types'

/** Crossfade length for track changes; inside the 200–400ms sweet spot. */
const CROSSFADE_MS = 320
/** Stop holding the previous track if the next source takes too long to load. */
const CROSSFADE_MAX_WAIT = 6000

export function PlayerBar() {
  const { i18n } = useLingui()
  // Two media elements alternate so a new track can start while the previous
  // one is still playing; `audioRef` always points at the element that owns the
  // current source, and `registerAudio` follows it for lyrics/seek helpers.
  const audioARef = useRef<HTMLAudioElement>(null)
  const audioBRef = useRef<HTMLAudioElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const incomingRef = useRef<HTMLAudioElement | null>(null)
  const outgoingRef = useRef<HTMLAudioElement | null>(null)
  const crossfadePendingRef = useRef(false)
  const crossfadeTimerRef = useRef<number | null>(null)
  const fadeEndTimerRef = useRef<number | null>(null)
  const fadeFrameRef = useRef(0)
  const masterVolumeRef = useRef(0.8)
  const retriedRef = useRef<number | null>(null)
  const lastPlayTokenRef = useRef<number | null>(null)
  const lastSongIdRef = useRef<number | null>(null)
  const switchingRef = useRef(false)
  const trialNotifiedRef = useRef(false)
  // A seek that arrives before the media is seekable (restored queue after a
  // refresh, or metadata still loading) is applied once metadata is available.
  const pendingSeekRef = useRef<{ percent: number; songId: number } | null>(null)
  const seekLoadingRef = useRef(false)

  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const playing = usePlayerStore((state) => state.playing)
  const mode = usePlayerStore((state) => state.mode)
  const volume = usePlayerStore((state) => state.volume)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const buffered = usePlayerStore((state) => state.buffered)
  const playToken = usePlayerStore((state) => state.playToken)
  const audioUrl = usePlayerStore((state) => state.audioUrl)
  const sourceReady = usePlayerStore((state) => state.sourceReady)
  const audioReady = usePlayerStore((state) => state.audioReady)
  const audioFromCache = usePlayerStore((state) => state.audioFromCache)
  const audioBlob = usePlayerStore((state) => state.audioBlob)
  const heartMode = usePlayerStore((state) => state.heartMode)
  const heartLoading = usePlayerStore((state) => state.heartLoading)
  const lyricLines = usePlayerStore((state) => state.lyricLines)

  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const cycleMode = usePlayerStore((state) => state.cycleMode)
  const toggleHeartMode = usePlayerStore((state) => state.toggleHeartMode)
  const setVolume = usePlayerStore((state) => state.setVolume)
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime)
  const setBuffered = usePlayerStore((state) => state.setBuffered)
  const setAudioReady = usePlayerStore((state) => state.setAudioReady)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const refreshCurrentUrl = usePlayerStore((state) => state.refreshCurrentUrl)
  const prefetchNext = usePlayerStore((state) => state.prefetchNext)
  const invalidateUrls = usePlayerStore((state) => state.invalidateUrls)
  const showNowPlaying = usePlayerStore((state) => state.showNowPlaying)
  const switchingSource = usePlayerStore((state) => state.switchingSource)
  const switchToOtherSource = usePlayerStore((state) => state.switchToOtherSource)
  const resumeAt = usePlayerStore((state) => state.resumeAt)
  const consumeResumeAt = usePlayerStore((state) => state.consumeResumeAt)

  const playLevel = useSettingsStore((state) => state.playLevel)
  const setPlayLevel = useSettingsStore((state) => state.setPlayLevel)
  const lyricDisplayMode = useSettingsStore((state) => state.lyricDisplayMode)
  const setLyricDisplayMode = useSettingsStore((state) => state.setLyricDisplayMode)
  // The mode menu is only meaningful when the current lyric actually carries a translation.
  const hasTranslation = useMemo(
    () => lyricLines.some((line) => Boolean(line.translate)),
    [lyricLines],
  )
  const desktopShell = isDesktopShell()
  const [lyricsWindowOpen, setLyricsWindowOpen] = useState(false)
  const [miniWindowOpen, setMiniWindowOpen] = useState(false)
  const [lyricsModeOpen, setLyricsModeOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  // Real duration reported by the media element; trial clips are shorter than
  // the catalogue duration in song.dt.
  const [mediaDuration, setMediaDuration] = useState(0)
  // Keeps the thumb at the clicked position while a deferred seek waits for
  // metadata, instead of snapping back to the audio element's current 0.
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)

  const likedIds = useUserStore((state) => state.likedIds)
  const likeSong = useUserStore((state) => state.likeSong)
  const liked = currentSong ? likedIds.includes(currentSong.id) : false

  /** Apply the master volume scaled by a fade gain to one element. */
  const applyGain = (element: HTMLAudioElement | null, gain: number) => {
    if (!element) return
    element.volume = Math.min(1, Math.max(0, masterVolumeRef.current * gain))
  }

  const clearFade = () => {
    if (!fadeFrameRef.current) return
    cancelAnimationFrame(fadeFrameRef.current)
    fadeFrameRef.current = 0
  }

  const clearCrossfadeTimer = () => {
    if (crossfadeTimerRef.current === null) return
    window.clearTimeout(crossfadeTimerRef.current)
    crossfadeTimerRef.current = null
  }

  const clearFadeEndTimer = () => {
    if (fadeEndTimerRef.current === null) return
    window.clearTimeout(fadeEndTimerRef.current)
    fadeEndTimerRef.current = null
  }

  /** Detach a finished element and release the blob URL it owned. */
  const settleElement = (element: HTMLAudioElement | null) => {
    if (!element) return
    element.pause()
    element.currentTime = 0
    const src = element.getAttribute('src')
    element.removeAttribute('src')
    element.load()
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
  }

  /** Let the incoming track take over, fading the previous one out. */
  const startCrossfade = (incoming: HTMLAudioElement) => {
    if (!crossfadePendingRef.current || incoming !== incomingRef.current) return
    const outgoing = outgoingRef.current
    crossfadePendingRef.current = false
    incomingRef.current = null
    clearCrossfadeTimer()
    audioRef.current = incoming
    registerAudio(incoming)
    switchingRef.current = false
    setAudioReady(true)

    if (!outgoing || outgoing === incoming || outgoing.paused) {
      incoming.volume = masterVolumeRef.current
      if (outgoing && outgoing !== incoming) settleElement(outgoing)
      outgoingRef.current = null
      return
    }

    applyGain(incoming, 0)
    applyGain(outgoing, 1)
    const finish = () => {
      // A newer transition took over; this fade no longer owns the gains.
      if (outgoingRef.current !== outgoing) return
      clearFadeEndTimer()
      clearFade()
      settleElement(outgoing)
      outgoingRef.current = null
      incoming.volume = masterVolumeRef.current
    }
    const started = performance.now()
    const step = (now: number) => {
      if (outgoingRef.current !== outgoing) {
        fadeFrameRef.current = 0
        return
      }
      const progress = Math.min(1, (now - started) / CROSSFADE_MS)
      applyGain(incoming, progress)
      applyGain(outgoing, 1 - progress)
      if (progress < 1) {
        fadeFrameRef.current = requestAnimationFrame(step)
        return
      }
      finish()
    }
    fadeFrameRef.current = requestAnimationFrame(step)
    // rAF stops while the window is hidden; make sure the hand-off still
    // completes so two tracks never keep playing at once.
    fadeEndTimerRef.current = window.setTimeout(finish, CROSSFADE_MS + 150)
  }

  const maybeStartCrossfade = (audio: HTMLAudioElement) => {
    if (!crossfadePendingRef.current || audio !== incomingRef.current) return
    if (audio.paused) return
    startCrossfade(audio)
  }

  // The HUD can also be toggled by the global shortcut or its own close button,
  // so the two toolbar buttons need to stay in sync. Poll only while the window
  // is visible (a minimized/tray window sends nothing) and at a low rate; focus
  // and the button handlers cover the interactive cases immediately.
  useEffect(() => {
    if (!desktopShell) return
    let active = true
    let polling = false
    let timer = 0

    const sync = () => {
      if (!active || document.visibilityState !== 'visible' || polling) return
      polling = true
      void Promise.allSettled([
        getDesktopLyricsVisible().then(({ visible }) => {
          if (active) setLyricsWindowOpen(visible)
        }),
        getMiniPlayerVisible().then(({ visible }) => {
          if (active) setMiniWindowOpen(visible)
        }),
      ]).finally(() => {
        polling = false
      })
    }

    const start = () => {
      window.clearInterval(timer)
      if (document.visibilityState !== 'visible') return
      sync()
      timer = window.setInterval(sync, 10_000)
    }

    start()
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', start)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', start)
    }
  }, [desktopShell])

  useEffect(() => {
    masterVolumeRef.current = Math.min(1, Math.max(0, usePlayerStore.getState().volume / 100))
    audioRef.current = audioARef.current
    applyGain(audioARef.current, 1)
    applyGain(audioBRef.current, 1)
    registerAudio(audioARef.current)
    return () => {
      registerAudio(null)
      clearFade()
      clearCrossfadeTimer()
      clearFadeEndTimer()
    }
    // The elements mount and unmount with the bar itself.
  }, [])

  // Blob URLs created for prefetched / cached tracks are owned by the audio
  // elements while they are mounted; release them on unmount.
  useEffect(() => {
    // Copy the nodes now: by cleanup time the refs are already detached.
    const elements = [audioARef.current, audioBRef.current]
    return () => {
      for (const element of elements) {
        const src = element?.getAttribute('src')
        if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
      }
    }
  }, [])

  useEffect(() => {
    const gain = Math.min(1, Math.max(0, volume / 100))
    masterVolumeRef.current = gain
    // A running fade owns both element gains.
    if (fadeFrameRef.current) return
    const current = audioRef.current
    applyGain(current, 1)
    const other = current === audioARef.current ? audioBRef.current : audioARef.current
    // Keep the waiting incoming track silent until its fade starts.
    if (other && other !== incomingRef.current) applyGain(other, 1)
  }, [volume])

  // Every play request (previous / next / pick a song / replay) bumps
  // playToken. Instead of silencing the old track right away, keep it playing
  // while the next source resolves, then crossfade once the new one is ready.
  useEffect(() => {
    if (lastPlayTokenRef.current === playToken) return
    lastPlayTokenRef.current = playToken
    trialNotifiedRef.current = false
    const restartingSameSong = lastSongIdRef.current === currentSong?.id
    lastSongIdRef.current = currentSong?.id ?? null
    const audio = audioRef.current
    if (!audio) return

    setCurrentTime(0)
    setBuffered(0)
    setAudioReady(false)

    // A fade left over from the previous transition no longer applies.
    const staleOutgoing = outgoingRef.current
    if (staleOutgoing && staleOutgoing !== audio) {
      clearFade()
      settleElement(staleOutgoing)
      outgoingRef.current = null
    }

    // Replaying the same track restarts it in place; fading a song into itself
    // would just smear the two copies together.
    if (restartingSameSong || (audioUrl && audio.getAttribute('src') === audioUrl)) {
      crossfadePendingRef.current = false
      clearCrossfadeTimer()
      outgoingRef.current = null
      audio.pause()
      audio.currentTime = 0
      switchingRef.current = false
      if (usePlayerStore.getState().playing) {
        void audio.play().catch(() => undefined)
      }
      return
    }

    const state = usePlayerStore.getState()
    const audible = !audio.paused && audio.readyState >= 2 && audio.currentTime > 0.25
    if (!state.playing || !audible) {
      crossfadePendingRef.current = false
      clearCrossfadeTimer()
      outgoingRef.current = null
      switchingRef.current = true
      audio.pause()
      audio.currentTime = 0
      return
    }

    // The old track keeps playing (silently for the UI) until the new source
    // is playable, so the hand-off has no audible gap.
    switchingRef.current = true
    crossfadePendingRef.current = true
    outgoingRef.current = audio
    clearCrossfadeTimer()
    crossfadeTimerRef.current = window.setTimeout(() => {
      crossfadeTimerRef.current = null
      if (!crossfadePendingRef.current) return
      crossfadePendingRef.current = false
      const incoming = incomingRef.current
      incomingRef.current = null
      outgoingRef.current = null
      audio.pause()
      audio.currentTime = 0
      if (incoming && incoming.getAttribute('src')) {
        // Promote the next element without a fade; it starts as soon as it can.
        audioRef.current = incoming
        incoming.volume = masterVolumeRef.current
        registerAudio(incoming)
      }
      switchingRef.current = false
    }, CROSSFADE_MAX_WAIT)
  }, [playToken, audioUrl, currentSong?.id, setAudioReady, setBuffered, setCurrentTime])

  // A pending seek belongs to the track it was made on. Error retries are also
  // per-track: refreshing the same song's signed URL must not re-arm the retry,
  // otherwise a permanently broken source loops refresh -> error forever.
  useEffect(() => {
    pendingSeekRef.current = null
    retriedRef.current = null
    setPendingSeek(null)
  }, [currentSong?.id])

  useEffect(() => {
    if (!audioUrl) return
    const current = audioRef.current
    if (!current) return
    if (current.getAttribute('src') === audioUrl) {
      if (usePlayerStore.getState().playing && current.paused) {
        void current.play().catch(() => undefined)
      }
      return
    }

    let crossfade = crossfadePendingRef.current
    let target = current
    if (crossfade) {
      const idle = current === audioARef.current ? audioBRef.current : audioARef.current
      if (idle) target = idle
      else crossfade = false
    }

    if (crossfade) {
      incomingRef.current = target
      target.volume = 0
      // Lyrics and seek helpers follow the incoming track as soon as it owns
      // the new url, even while the previous element is still audible.
      registerAudio(target)
    } else {
      // A source swap replaces the active element; any fade in flight is done.
      clearFade()
      const fading = outgoingRef.current
      outgoingRef.current = null
      if (fading && fading !== target) settleElement(fading)
      incomingRef.current = null
      target.volume = masterVolumeRef.current
      registerAudio(target)
      switchingRef.current = true
      setCurrentTime(0)
      setBuffered(0)
      setAudioReady(false)
      setMediaDuration(0)
    }

    target.pause()
    target.currentTime = 0
    const previousSrc = target.getAttribute('src')
    target.src = audioUrl
    target.load()
    if (previousSrc?.startsWith('blob:')) URL.revokeObjectURL(previousSrc)

    if (usePlayerStore.getState().playing) {
      void target.play().catch(() => undefined)
    }
  }, [audioUrl, setAudioReady, setBuffered, setCurrentTime])

  useEffect(() => {
    if (playing) {
      if (!sourceReady || !audioUrl) return
      const incoming = incomingRef.current
      const target =
        incoming && incoming.getAttribute('src') === audioUrl ? incoming : audioRef.current
      if (target && target.getAttribute('src') === audioUrl && target.paused) {
        void target.play().catch(() => undefined)
      }
      return
    }

    // Pausing must stop both elements, including a running crossfade.
    clearFade()
    clearFadeEndTimer()
    const outgoing = outgoingRef.current
    outgoingRef.current = null
    if (outgoing) settleElement(outgoing)
    const current = audioRef.current
    if (current) {
      // A fade interrupted mid-way left the gain below the master volume.
      current.volume = masterVolumeRef.current
      current.pause()
    }
    incomingRef.current?.pause()
  }, [playing, sourceReady, audioUrl])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      // Text fields keep their native shortcuts.
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }
      const interactive = Boolean(
        target?.closest('button, a, [role="button"], [role="slider"]'),
      )
      if (event.code === 'Space') {
        // Space activates a focused button/link; only control playback when
        // the page itself has focus.
        if (interactive) return
        event.preventDefault()
        void usePlayerStore.getState().togglePlay()
        return
      }
      // Volume uses Alt + arrows so plain arrow keys still scroll the page.
      if (event.altKey && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
        event.preventDefault()
        const state = usePlayerStore.getState()
        const step = event.shiftKey ? 1 : 5
        const next =
          event.code === 'ArrowUp' ? state.volume + step : state.volume - step
        state.setVolume(Math.min(100, Math.max(0, next)))
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Start caching only after the track has played steadily for a while.
  // Downloading and encoding the whole file immediately competes with the
  // first audio buffer and makes the initial playback noticeably slow.
  useEffect(() => {
    if (!playing || !audioReady || audioFromCache || !currentSong) return
    if (!audioBlob && !currentSong.url) return
    const songId = currentSong.id
    const timer = window.setTimeout(() => {
      const state = usePlayerStore.getState()
      const active = state.queue[state.currentIndex]
      if (!active || active.id !== songId || !state.playing || state.audioFromCache) return
      // Third-party matches are streamed outside the NetEase-only proxy, so
      // there is nothing to transcode/cache through the local API.
      if (active.unblocked) return
      const meta = {
        id: active.id,
        name: active.name,
        url: active.url ?? '',
        artists: formatArtists(active.ar),
        duration: active.dt,
      }
      if (audioBlob) {
        cacheSongFromBlob(meta, audioBlob)
      } else if (active.url) {
        cacheSong(meta)
      }
    }, 10000)
    return () => window.clearTimeout(timer)
    // The timer only depends on the identity and URL of the current track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, audioReady, currentSong?.id, currentSong?.url, audioFromCache, audioBlob])

  /* ------------------------- Windows SMTC / media keys ------------------------ */

  const mediaSessionDuration =
    (currentSong?.trialEnd && currentSong.trialEnd > 0 ? currentSong.trialEnd * 1000 : 0) ||
    mediaDuration ||
    currentSong?.dt ||
    0

  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentSong) return
    if (!('MediaMetadata' in window)) return
    const artwork = currentSong.al.picUrl
      ? [{ src: currentSong.al.picUrl, sizes: '512x512', type: 'image/jpeg' }]
      : []
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.name,
        artist: formatArtists(currentSong.ar),
        album: currentSong.al.name,
        artwork,
      })
    } catch (error) {
      // Invalid artwork metadata must not break playback or the UI.
      console.warn('[player] failed to update media session metadata', error)
    }
  }, [currentSong])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // The action is not supported by this WebView.
      }
    }

    set('play', () => {
      const state = usePlayerStore.getState()
      if (!state.playing) void state.togglePlay()
    })
    set('pause', () => usePlayerStore.getState().setPlaying(false))
    set('stop', () => usePlayerStore.getState().setPlaying(false))
    set('previoustrack', () => void usePlayerStore.getState().prev())
    set('nexttrack', () => void usePlayerStore.getState().next())
    set('seekto', (details) => {
      if (typeof details.seekTime === 'number') seekAudio(details.seekTime)
    })
    set('seekbackward', (details) => {
      const audio = getAudio()
      if (audio) seekAudio(audio.currentTime - (details.seekOffset ?? 10))
    })
    set('seekforward', (details) => {
      const audio = getAudio()
      if (audio) seekAudio(audio.currentTime + (details.seekOffset ?? 10))
    })

    return () => {
      const actions: MediaSessionAction[] = [
        'play',
        'pause',
        'stop',
        'previoustrack',
        'nexttrack',
        'seekto',
        'seekbackward',
        'seekforward',
      ]
      for (const action of actions) set(action, null)
    }
  }, [])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const next = playing ? 'playing' : 'paused'
    if (navigator.mediaSession.playbackState !== next) {
      navigator.mediaSession.playbackState = next
    }
  }, [playing])

  // WebView2 can echo a position update back as a time update; update at most
  // once per second so that echo can never become a render loop.
  const lastPositionRef = useRef(-1)

  useEffect(() => {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) {
      return
    }
    if (Math.abs(currentTime - lastPositionRef.current) < 1) return
    const durationSeconds = mediaSessionDuration / 1000
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return
    lastPositionRef.current = currentTime
    try {
      navigator.mediaSession.setPositionState({
        duration: durationSeconds,
        playbackRate: 1,
        position: Math.min(durationSeconds, Math.max(0, currentTime)),
      })
    } catch {
      // Ignore transient invalid states while a track is switching.
    }
  }, [currentTime, mediaSessionDuration])

  if (!queue.length || !currentSong) {
    return (
      <div className="player-glass flex h-[76px] items-center justify-center text-[12px] text-black/35">
        <Trans>选择一首歌曲开始播放</Trans>
      </div>
    )
  }

  const sourceMatches =
    Boolean(audioUrl) && audioRef.current?.getAttribute('src') === audioUrl
  // A trial clip is limited to freeTrialInfo.end seconds even when the media
  // file itself is longer; otherwise prefer the loaded media duration.
  const trialDuration =
    currentSong.trialEnd && currentSong.trialEnd > 0 ? currentSong.trialEnd * 1000 : 0
  const duration =
    trialDuration || (sourceMatches ? mediaDuration : 0) || currentSong.dt || 0
  const loadingSource = playing && !sourceReady
  const buffering = playing && sourceReady && !audioReady
  const busy = loadingSource || buffering
  const percent = duration ? Math.min(100, (currentTime * 1000 * 100) / duration) : 0
  const pendingTime = pendingSeek !== null ? (pendingSeek / 100) * (duration / 1000) : null
  // While the audio element still points at the previous track, force the
  // progress UI to zero so stale timeupdate events can never leak through.
  // A deferred seek keeps showing its target instead of snapping back to 0.
  const displayTime = pendingTime ?? (sourceMatches ? currentTime : 0)
  const displayPercent = pendingSeek ?? (sourceMatches ? percent : 0)
  const displayBuffered = sourceMatches ? buffered : 0

  const handleSeek = (value: number) => {
    const incoming = incomingRef.current
    // While a crossfade is pending the new url already belongs to the incoming
    // element, so seeking must target it instead of the audible old one.
    const audio =
      incoming && audioUrl && incoming.getAttribute('src') === audioUrl
        ? incoming
        : audioRef.current
    if (!audio || !duration) return
    const mediaReady =
      audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0
    const matchesSource = Boolean(audioUrl) && audio.getAttribute('src') === audioUrl
    if (!matchesSource || !mediaReady) {
      // A restored queue has no media attached: assigning currentTime before
      // `loadedmetadata` is ignored by the element, so the thumb used to snap
      // back to 0. Remember the target and apply it once metadata arrives.
      pendingSeekRef.current = { percent: value, songId: currentSong.id }
      setPendingSeek(value)
      if (!matchesSource && !audioUrl && !seekLoadingRef.current) {
        seekLoadingRef.current = true
        void refreshCurrentUrl().then((ok) => {
          seekLoadingRef.current = false
          if (!ok) {
            pendingSeekRef.current = null
            setPendingSeek(null)
          }
        })
      }
      return
    }
    pendingSeekRef.current = null
    setPendingSeek(null)
    const seconds = (value / 100) * (duration / 1000)
    audio.currentTime = seconds
    setCurrentTime(seconds)
  }

  const updateBuffered = () => {
    if (switchingRef.current) return
    const audio = audioRef.current
    if (!audio) return
    const ranges = audio.buffered
    if (!ranges.length || !audio.duration) return
    setBuffered((ranges.end(ranges.length - 1) / audio.duration) * 100)
  }

  const qualityOption = PLAY_QUALITY_OPTIONS.find(
    (option) => option.value === playLevel,
  )
  const qualityLabel = qualityOption ? i18n._(qualityOption.label) : playLevel

  const handleToggleDesktopLyrics = () => {
    void setDesktopLyricsVisible('toggle')
      .then(({ visible }) => setLyricsWindowOpen(visible))
      .catch(() => toast.warning(i18n._(msg`桌面歌词窗口暂不可用`)))
  }

  const handleToggleMiniPlayer = () => {
    void setMiniPlayerVisible('toggle')
      .then(({ visible }) => setMiniWindowOpen(visible))
      .catch(() => toast.warning(i18n._(msg`迷你播放器暂不可用`)))
  }

  const handleQualityChange = (level: PlayLevel) => {
    setQualityOpen(false)
    if (level === playLevel) return
    setPlayLevel(level)
    invalidateUrls()
    const option = PLAY_QUALITY_OPTIONS.find((item) => item.value === level)
    const label = option ? i18n._(option.label) : level
    toast.info(i18n._(msg`播放音质已切换为${label}，正在重新加载`))
    void refreshCurrentUrl()
  }

  const modeIcon =
    mode === 'random' ? (
      <Shuffle className="h-[18px] w-[18px]" />
    ) : mode === 'singleLoop' ? (
      <Repeat1 className="h-[18px] w-[18px]" />
    ) : (
      <Repeat className="h-[18px] w-[18px]" />
    )

  // Both media elements share these handlers; events from the element that is
  // neither current nor the incoming crossfade target are ignored.
  const audioProps = {
    preload: 'auto' as const,
    onLoadedMetadata: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current && audio !== incomingRef.current) return
      if (!audioUrl || audio.getAttribute('src') !== audioUrl) return
      const value = audio.duration
      setMediaDuration(Number.isFinite(value) && value > 0 ? value * 1000 : 0)
      // A manual source switch keeps the position the user was at.
      if (resumeAt != null) {
        const target = Math.min(
          resumeAt,
          Number.isFinite(value) && value > 0 ? value : resumeAt,
        )
        audio.currentTime = target
        if (audio === audioRef.current) setCurrentTime(target)
        pendingSeekRef.current = null
        setPendingSeek(null)
        consumeResumeAt()
        return
      }
      // Apply a seek that was requested before the media became seekable
      // (e.g. clicking the bar right after a refresh).
      const pending = pendingSeekRef.current
      if (!pending) return
      pendingSeekRef.current = null
      if (pending.songId !== currentSong.id) {
        setPendingSeek(null)
        return
      }
      const mediaSeconds = Number.isFinite(value) && value > 0 ? value : duration / 1000
      const seconds = (pending.percent / 100) * mediaSeconds
      audio.currentTime = seconds
      if (audio === audioRef.current) setCurrentTime(seconds)
      setPendingSeek(null)
    },
    onLoadedData: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current && audio !== incomingRef.current) return
      if (!audioUrl || audio.getAttribute('src') !== audioUrl) return
      setAudioReady(true)
      if (audio === audioRef.current) {
        switchingRef.current = false
        prefetchNext()
      }
    },
    onCanPlay: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current && audio !== incomingRef.current) return
      if (!audioUrl || audio.getAttribute('src') !== audioUrl) return
      setAudioReady(true)
      if (audio === audioRef.current) {
        switchingRef.current = false
        if (usePlayerStore.getState().playing && audio.paused) {
          void audio.play().catch(() => undefined)
        }
        return
      }
      maybeStartCrossfade(audio)
    },
    onPlaying: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current && audio !== incomingRef.current) return
      if (!audioUrl || audio.getAttribute('src') !== audioUrl) return
      if (audio === incomingRef.current) {
        maybeStartCrossfade(audio)
        return
      }
      switchingRef.current = false
      setAudioReady(true)
    },
    onPause: (event: SyntheticEvent<HTMLAudioElement>) => {
      // A user-initiated pause must keep the source ready. Clearing it here
      // made the next resume look like buffering for a few frames, which
      // flashed the loading state and shifted the now-playing layout.
      if (event.currentTarget !== audioRef.current) return
      if (usePlayerStore.getState().playing) setAudioReady(false)
    },
    onWaiting: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget !== audioRef.current) return
      setAudioReady(false)
    },
    onStalled: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget !== audioRef.current) return
      setAudioReady(false)
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current) return
      if (switchingRef.current) return
      if (audioUrl && audio.getAttribute('src') !== audioUrl) return
      setCurrentTime(audio.currentTime)
      updateBuffered()

      const trialEnd = currentSong.trialEnd
      if (trialEnd && trialEnd > 0 && audio.currentTime >= trialEnd) {
        audio.pause()
        usePlayerStore.getState().setPlaying(false)
        if (!trialNotifiedRef.current) {
          trialNotifiedRef.current = true
          toast.warning(i18n._(msg`试听结束，登录或开通会员可播放完整版`))
        }
      }
    },
    onProgress: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget === audioRef.current) updateBuffered()
    },
    onEnded: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget !== audioRef.current) return
      // The old track ending while the next one is still resolving must not
      // trigger another skip.
      if (switchingRef.current) return
      if (mode === 'singleLoop') {
        const audio = event.currentTarget
        setCurrentTime(0)
        audio.currentTime = 0
        void audio.play().catch(() => undefined)
      } else {
        // Mark the natural end so sequential mode can stop at the last track;
        // the next button itself always advances (wrapping at the end).
        void next({ auto: true })
      }
    },
    onError: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current && audio !== incomingRef.current) return
      setAudioReady(false)
      if (!audioUrl) return
      if (audio === incomingRef.current) {
        // The transition source failed: drop the fade and let the recovery
        // path replace the active element's source instead. The old track is
        // still the active one and never enters the fade.
        crossfadePendingRef.current = false
        incomingRef.current = null
        outgoingRef.current = null
        clearCrossfadeTimer()
        audio.pause()
      }
      if (retriedRef.current === currentSong.id) {
        // Recovery skip: stop at the end in sequential mode instead of looping
        // through a queue whose sources are all broken.
        void next({ auto: true })
        return
      }
      retriedRef.current = currentSong.id
      void refreshCurrentUrl()
    },
  }

  return (
    <div
      className={cn(
        'player-glass relative grid h-[76px] grid-cols-[minmax(170px,1fr)_minmax(300px,1.5fr)_minmax(150px,1fr)] items-center gap-4 px-4 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-2 max-md:px-3',
        // While the immersive view is open, the bar floats above that artwork
        // backdrop as frosted glass instead of sitting in its own strip.
        showNowPlaying ? 'dark player-glass--immersive z-[70]' : 'z-30',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => toggleNowPlaying()}
          className="group pressable relative shrink-0"
          title={
            showNowPlaying
              ? i18n._(msg`收起播放页`)
              : i18n._(msg`打开播放页`)
          }
        >
          <ImageWithFallback
            src={currentSong.al.picUrl}
            alt={currentSong.name}
            rounded="rounded-[10px]"
            className="h-[46px] w-[46px] transform-gpu"
            resize="128y128"
            instant
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100">
            {showNowPlaying ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronUp className="h-5 w-5" />
            )}
          </span>
        </button>

        <div
          role="button"
          tabIndex={0}
          className="min-w-0 flex-1 cursor-pointer"
          onClick={() => toggleNowPlaying()}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleNowPlaying()
            }
          }}
          title={
            showNowPlaying
              ? i18n._(msg`收起播放页`)
              : i18n._(msg`打开播放页`)
          }
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[12.5px] font-medium text-black/80 hover:text-accent">
              {currentSong.name}
            </span>
            {currentSong.trialEnd ? (
              <span className="shrink-0 rounded-[6px] bg-[#ff9500]/12 px-1 text-[11px] text-[#b36b00]">
                <Trans>试听</Trans>
              </span>
            ) : null}
            {currentSong.unblocked ? (
              <span
                className="shrink-0 rounded-[6px] bg-accent/10 px-1 text-[11px] text-accent"
                title={i18n._(msg`该歌曲没有官方音源，当前使用匹配到的其他音源`)}
              >
                <Trans>其他音源</Trans>
              </span>
            ) : null}
            <button
              type="button"
              aria-label={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
              onClick={(event) => {
                event.stopPropagation()
                void likeSong(currentSong.id, !liked)
              }}
              className="pressable shrink-0 max-md:hidden"
            >
              <Heart
                className={cn(
                  'h-4 w-4 transition-colors',
                  liked ? 'fill-[#ff2d55] text-[#ff2d55]' : 'text-black/30 hover:text-black/60',
                )}
              />
            </button>
          </div>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-black/40">
            {loadingSource ? (
              <>
                <Loader2 className="h-3 w-3 flex-none animate-spin text-accent" />
                <Trans>正在加载音源…</Trans>
              </>
            ) : (
              <ArtistLinks artists={currentSong.ar} />
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center max-md:items-end">
        <div className="flex items-center gap-5 max-md:gap-3">
          <button
            type="button"
            title={
              heartMode
                ? i18n._(msg`关闭心动模式`)
                : i18n._(msg`心动模式`)
            }
            aria-label={i18n._(msg`心动模式`)}
            aria-pressed={heartMode}
            disabled={heartLoading}
            onClick={() => void toggleHeartMode()}
            className={cn(
              'pressable flex h-8 w-8 items-center justify-center transition-colors disabled:opacity-50 max-md:hidden',
              heartMode ? 'text-[#ff2d55]' : 'text-black/35 hover:text-black/70',
            )}
          >
            {heartLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            title={
              mode === 'order'
                ? i18n._(msg`顺序播放`)
                : mode === 'random'
                  ? i18n._(msg`随机播放`)
                  : i18n._(msg`单曲循环`)
            }
            onClick={cycleMode}
            className={cn(
              'pressable flex h-8 w-8 items-center justify-center transition-colors max-md:h-10 max-md:w-10',
              mode === 'order' ? 'text-black/35 hover:text-black/70' : 'text-accent',
            )}
          >
            {modeIcon}
          </button>
          <button
            type="button"
            aria-label={i18n._(msg`上一首`)}
            onClick={() => void prev()}
            className="pressable flex h-8 w-8 items-center justify-center text-black/65 hover:text-black max-md:h-10 max-md:w-10"
          >
            <SkipBack className="h-5 w-5 fill-current" />
          </button>
          <button
            type="button"
            aria-label={
              loadingSource
                ? i18n._(msg`正在加载音源`)
                : buffering
                  ? i18n._(msg`正在缓冲`)
                  : playing
                    ? i18n._(msg`暂停`)
                    : i18n._(msg`播放`)
            }
            onClick={() => void togglePlay()}
            title={
              playing
                ? i18n._(msg`暂停（空格）`)
                : i18n._(msg`播放（空格）`)
            }
            className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-[0_2px_8px_rgba(0,102,204,0.35)] hover:bg-accent-hover max-md:h-10 max-md:w-10"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : playing ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="ml-[1px] h-5 w-5 fill-current" />
            )}
          </button>
          <button
            type="button"
            aria-label={i18n._(msg`下一首`)}
            onClick={() => void next()}
            className="pressable flex h-8 w-8 items-center justify-center text-black/65 hover:text-black max-md:h-10 max-md:w-10"
          >
            <SkipForward className="h-5 w-5 fill-current" />
          </button>
          <button
            type="button"
            onClick={() => toggleQueue()}
            className="pressable flex h-8 w-8 items-center justify-center text-black/35 transition-colors hover:text-black/70 max-md:hidden"
            title={i18n._(msg`播放列表`)}
          >
            <ListMusic className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-1.5 flex w-full items-center gap-2.5 max-md:absolute max-md:inset-x-0 max-md:top-0 max-md:mt-0 max-md:px-3">
          <span
            data-testid="elapsed-time"
            className="w-9 shrink-0 text-right text-[11px] tabular-nums text-black/35 max-md:hidden"
          >
            {formatDuration(displayTime * 1000)}
          </span>
          <ProgressSlider
            key={`${currentSong.id}-${playToken}`}
            value={displayPercent}
            buffered={displayBuffered}
            onChange={handleSeek}
            valueText={`${formatDuration(displayTime * 1000)} / ${formatDuration(duration)}`}
          />
          <span className="w-9 shrink-0 text-[11px] tabular-nums text-black/35 max-md:hidden">
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 max-md:hidden">
        {hasTranslation ? (
          <Popover open={lyricsModeOpen} onOpenChange={setLyricsModeOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={i18n._(msg`歌词显示方式`)}
                title={i18n._(msg`歌词显示方式`)}
                className={cn(
                  'pressable flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5',
                  lyricDisplayMode !== 'original'
                    ? 'text-accent'
                    : 'text-black/45 hover:text-black/75',
                )}
              >
                <Languages className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              sideOffset={10}
              glass
              className="w-[min(180px,calc(100vw-24px))] p-1.5"
            >
              <p className="px-2 py-1 text-[11px] text-black/35">
                <Trans>歌词显示</Trans>
              </p>
              {LYRIC_DISPLAY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setLyricDisplayMode(option.value)
                    setLyricsModeOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors',
                    lyricDisplayMode === option.value
                      ? 'bg-accent/10 text-accent'
                      : 'text-black/65 hover:bg-black/5',
                  )}
                >
                  <span>{i18n._(option.label)}</span>
                  {lyricDisplayMode === option.value ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}

        {currentSong.fee !== 0 && !currentSong.unblocked ? (
          <button
            type="button"
            aria-label={i18n._(msg`切换其他音源`)}
            title={i18n._(msg`切换其他音源`)}
            onClick={() => void switchToOtherSource()}
            disabled={switchingSource}
            className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 disabled:opacity-50 max-md:h-10 max-md:w-10"
          >
            {switchingSource ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        ) : null}

        {desktopShell ? (
          <button
            type="button"
            aria-label={
              lyricsWindowOpen
                ? i18n._(msg`关闭桌面歌词`)
                : i18n._(msg`开启桌面歌词`)
            }
            aria-pressed={lyricsWindowOpen}
            title={
              lyricsWindowOpen
                ? '关闭桌面歌词（Ctrl+Shift+L）'
                : '开启桌面歌词（Ctrl+Shift+L）'
            }
            onClick={handleToggleDesktopLyrics}
            className={cn(
              'pressable flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5',
              lyricsWindowOpen ? 'text-accent' : 'text-black/45 hover:text-black/75',
            )}
          >
            <Subtitles className="h-4 w-4" />
          </button>
        ) : null}

        {desktopShell ? (
          <button
            type="button"
            aria-label={
              miniWindowOpen
                ? i18n._(msg`关闭迷你播放器`)
                : i18n._(msg`开启迷你播放器`)
            }
            aria-pressed={miniWindowOpen}
            title={
              miniWindowOpen
                ? i18n._(msg`关闭迷你播放器`)
                : i18n._(msg`开启迷你播放器`)
            }
            onClick={handleToggleMiniPlayer}
            className={cn(
              'pressable flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5',
              miniWindowOpen ? 'text-accent' : 'text-black/45 hover:text-black/75',
            )}
          >
            <PictureInPicture2 className="h-4 w-4" />
          </button>
        ) : null}

        <Popover open={qualityOpen} onOpenChange={setQualityOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={i18n._(msg`播放音质`)}
              title={i18n._(msg`播放音质`)}
              className="pressable flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-black/45 transition-colors hover:bg-black/5 hover:text-black/75"
            >
              <AudioLines className="h-3.5 w-3.5" />
              {qualityLabel}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={10}
            glass
            className="w-[min(190px,calc(100vw-24px))] max-w-[calc(100vw-24px)] p-1.5"
          >
            <p className="px-2 py-1 text-[11px] text-black/35">
              <Trans>播放音质</Trans>
            </p>
            {PLAY_QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleQualityChange(option.value)}
                className={cn(
                  'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors',
                  playLevel === option.value
                    ? 'bg-accent/10 text-accent'
                    : 'text-black/65 hover:bg-black/5',
                )}
              >
                <span>{i18n._(option.label)}</span>
                {playLevel === option.value ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
            <p className="px-2 pb-1 pt-1 text-[11px] leading-relaxed text-black/30">
              <Trans>无损 / Hi-Res 需要对应会员权益；已缓存歌曲按设置中的缓存品质播放。</Trans>
            </p>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10"
              aria-label={i18n._(msg`音量`)}
              title={i18n._(msg`音量（Alt + ↑ / ↓）`)}
            >
              {volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : volume < 45 ? (
                <Volume1 className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            sideOffset={10}
            glass
            className="w-[52px] px-0 py-3"
          >
            <div className="flex flex-col items-center gap-2">
              <VolumeSlider value={volume} onChange={setVolume} />
              <span className="text-[11px] tabular-nums text-black/35">{volume}</span>
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => toggleNowPlaying()}
          className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/45 transition-colors hover:bg-black/5 hover:text-black/75 max-md:h-10 max-md:w-10"
          aria-label={
            showNowPlaying
              ? i18n._(msg`收起播放页`)
              : i18n._(msg`展开播放页`)
          }
        >
          {showNowPlaying ? (
            <ChevronDown className="h-[16px] w-[16px]" />
          ) : (
            <ChevronUp className="h-[16px] w-[16px]" />
          )}
        </button>
      </div>

      <audio ref={audioARef} className="hidden" {...audioProps} />
      <audio ref={audioBRef} className="hidden" {...audioProps} />
    </div>
  )
}
