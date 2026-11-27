import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  ChevronDown,
  ChevronUp,
  Ellipsis,
  Heart,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { MorePlaybackOptions } from './MorePlaybackOptions'
import { PlaylistPicker } from './PlaylistPicker'
import { useDelayedBusy } from '../../lib/useDelayedBusy'
import { useSmartStemStore } from '../../store/smartStem'
import { ImmersiveProgressBar } from './ImmersiveProgressBar'
import { ProgressSlider } from './ProgressSlider'
import {
  TRANSPORT_BUSY_ICON,
  TRANSPORT_PAUSE_ICON,
  TRANSPORT_PLAY_ICON,
} from './transportIcons'
import { TimeToggle } from './TimeToggle'
import { VolumeSlider } from './VolumeSlider'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useVideoPlaybackStore } from '../../store/videoPlayback'
import {
  cn,
  formatArtists,
  formatDuration,
  formatRemaining,
} from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import { PLAY_MODE_LABELS } from '../../lib/playMode'
import { usePlayerMenuTint } from '../../lib/menuSurface'
import { useSettingsStore } from '../../store/settings'
import {
  getAudio,
  playheadTime,
  registerAudio,
  seekAudio,
  seekElement,
  setSeekInterceptor,
} from '../../lib/audio'
import { DeckGainMixer } from '../../lib/deckGain'
import {
  attachAudioAnalyser,
  getAudioRmsLevel,
  resumeAudioAnalyser,
} from '../../lib/audioAnalyser'
import {
  cacheSong,
  cacheSongFromBlob,
  cacheSourceOf,
} from '../../lib/songCache'
import { useScrobble } from '../../lib/scrobble'
import { toast } from '../../lib/toast'

/** Never leave the previous track playing indefinitely while a source loads. */
const CROSSFADE_HANDOFF_MS = 600
/*
 * Transition envelopes (Apple Music behaviour: only natural track ends
 * crossfade; skip, pause and resume use short fades that never click).
 * Curves live in lib/deckGain.ts; the durations are tuned by ear.
 */
/** Manual next / previous / pick: the playing track fades out at once. */
const SWITCH_FADE_OUT_MS = 160
/** A track that does not enter under a crossfade comes up from silence. */
const TRACK_FADE_IN_MS = 80
/** Replacing the source of an audible element (stem / quality switch). */
const SOURCE_SWAP_FADE_MS = 60
/** Pause fades out, then stops; resume swells back slightly slower. */
const PAUSE_FADE_MS = 200
const RESUME_FADE_MS = 300
/** A natural crossfade whose next source is late lets the old track go. */
const LATE_HANDOFF_FADE_MS = 400
/**
 * Seeking an audible track: dip out, jump while silent, fade back in once
 * the new position plays. Short enough that a seek still feels instant.
 */
const SEEK_FADE_OUT_MS = 40
const SEEK_FADE_IN_MS = 90
/** Restore the volume even if `seeked` / `playing` never arrives. */
const SEEK_RESTORE_TIMEOUT_MS = 4000
/** Stop after this many consecutive tracks fail even after a URL refresh. */
const MAX_ERROR_SKIPS = 5

/**
 * A 12s overlap on a 5s track would otherwise trigger the next song at once.
 * Cap the window at half the outgoing track and never fade past its end.
 */
function crossfadeWindowMs(configuredMs: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return configuredMs
  return Math.min(configuredMs, duration * 500)
}

/** NetEase's audio CDN sends CORS headers, so captureStream can read it. */
function canAnalyseAudio(url: string) {
  if (url.startsWith('blob:')) return true
  try {
    const host = new URL(url, window.location.href).hostname
    return (
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '::1' ||
      host.endsWith('.music.126.net') ||
      host === 'music.126.net' ||
      host.endsWith('.music.163.com') ||
      host === 'music.163.com'
    )
  } catch {
    return false
  }
}

/** Seconds moved by ← / →. */
const SEEK_STEP = 5
/** Volume to restore when M unmutes. */
let volumeBeforeMute = 0

function seekBy(seconds: number) {
  const video = useVideoPlaybackStore.getState()
  if (video.active) {
    video.seek(video.currentTime + seconds)
    return
  }
  const audio = getAudio()
  if (!audio || !audio.getAttribute('src') || !Number.isFinite(audio.duration)) return
  const target = Math.max(
    0,
    Math.min(audio.duration - 0.25, playheadTime(audio) + seconds),
  )
  seekElement(audio, target)
  usePlayerStore.getState().setCurrentTime(target)
}

function toggleMute() {
  const video = useVideoPlaybackStore.getState()
  const player = usePlayerStore.getState()
  const current = video.active ? video.volume : player.volume
  if (current > 0) volumeBeforeMute = current
  const next = current > 0 ? 0 : volumeBeforeMute || 80
  if (video.active) video.setVolume(next)
  else player.setVolume(next)
}

function toggleLikeCurrent() {
  const player = usePlayerStore.getState()
  const song = player.queue[player.currentIndex]
  if (!song) return
  const user = useUserStore.getState()
  if (user.isLogin) void user.likeSong(song.id, !user.likedIds.includes(song.id))
  else void useLocalLibraryStore.getState().toggleFavorite(song)
}

export function PlayerBar() {
  const { i18n } = useLingui()
  useScrobble()
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
  // Kept in a ref so the audio event handlers always see the latest setting
  // without re-subscribing every media callback.
  const crossfadeRef = useRef({ enabled: true, ms: 4000 })
  // How the pending hand-off was started: a natural end crossfades with the
  // configured window, a manual switch fades the old track out at once.
  const handoffModeRef = useRef<'natural' | 'manual' | null>(null)
  // All gains (master × leveling × transport × deck) go through one ramping
  // mixer so no change ever reaches element.volume as a hard step.
  const mixerRef = useRef<DeckGainMixer | null>(null)
  // Elements whose new source should fade in once it actually starts.
  const pendingFadeInRef = useRef(new WeakSet<HTMLAudioElement>())
  // Bumped per source load; a deferred (fade-first) load checks it.
  const sourceLoadTokenRef = useRef(0)
  // A seek in progress on an audible deck (see SeekInterceptor).
  const seekDipRef = useRef<{
    element: HTMLAudioElement
    src: string | null
    target: number
    /** out: fading out, playhead not moved yet; wait: jumped, fading back once it plays. */
    phase: 'out' | 'wait'
    timer: number
  } | null>(null)
  const lastPlayingRef = useRef(false)
  // Target of the loudness leveling; the mixer glides towards it.
  const normalizationGainRef = useRef(1)
  const normalizationEnabledRef = useRef(false)
  const retriedRef = useRef<number | null>(null)
  // Consecutive error-recovery skips; reset once any track actually plays.
  const errorSkipsRef = useRef(0)
  const lastPlayTokenRef = useRef<number | null>(null)
  const lastSongIdRef = useRef<number | null>(null)
  const lastSourceReloadTokenRef = useRef(0)
  const autoNextTriggeredRef = useRef(false)
  const naturalEndAtRef = useRef(0)
  const switchingRef = useRef(false)
  const stemSwitchRef = useRef(false)
  const stemSwitchTimerRef = useRef<number | null>(null)
  const trialNotifiedRef = useRef(false)
  // A seek that arrives before the media is seekable (restored queue after a
  // refresh, or metadata still loading) is applied once metadata is available.
  const pendingSeekRef = useRef<{ percent: number; songId: number } | null>(null)
  const seekLoadingRef = useRef(false)
  // A seek can briefly emit `waiting` even when the data is already in the
  // buffer. Delay the buffering UI instead of flashing a spinner on every
  // click/drag on the progress bar.
  const bufferingTimerRef = useRef<number | null>(null)
  // Seeking an already-buffered stream still emits `waiting` in Chromium.
  // Ignore those events until `seeked` so the progress click never flashes the
  // buffering state.
  const seekingRef = useRef(false)
  // A stalled media request can stay in `waiting` forever (no `error` event).
  // Track recovery attempts per song so a single stalled switch self-heals
  // instead of requiring a full page refresh.
  const bufferRecoveryRef = useRef<{
    songId: number
    attempts: number
  } | null>(null)

  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const playing = usePlayerStore((state) => state.playing)
  const mode = usePlayerStore((state) => state.mode)
  const volume = usePlayerStore((state) => state.volume)
  // currentTime/buffered are deliberately not subscribed here: they change ~4
  // times per second, and only AudioProgressRow / the media-session effect
  // need them. Subscribing re-rendered this whole bar on every timeupdate.
  const playToken = usePlayerStore((state) => state.playToken)
  const sourceReloadToken = usePlayerStore(
    (state) => state.sourceReloadToken ?? 0,
  )
  const audioUrl = usePlayerStore((state) => state.audioUrl)
  const sourceReady = usePlayerStore((state) => state.sourceReady)
  const audioReady = usePlayerStore((state) => state.audioReady)
  const busyVisible = useDelayedBusy(
    playing && (!sourceReady || !audioReady),
  )
  const audioFromCache = usePlayerStore((state) => state.audioFromCache)
  const audioBlob = usePlayerStore((state) => state.audioBlob)
  const heartMode = usePlayerStore((state) => state.heartMode)
  const heartLoading = usePlayerStore((state) => state.heartLoading)

  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const cycleMode = usePlayerStore((state) => state.cycleMode)
  const toggleHeartMode = usePlayerStore((state) => state.toggleHeartMode)
  const volumeNormalization = useSettingsStore(
    (state) => state.volumeNormalization,
  )
  const crossfadeEnabled = useSettingsStore(
    (state) => state.crossfadeEnabled,
  )
  const crossfadeSeconds = useSettingsStore((state) => state.crossfadeSeconds)
  const songStemEnabled = useSettingsStore((state) =>
    currentSong
      ? Boolean(state.stemSongs?.[String(currentSong.id)]?.enabled)
      : false,
  )
  const smartStemActiveSong = useSmartStemStore(
    (state) => state.activeSongId,
  )
  const prepareSmartStem = useSmartStemStore(
    (state) => state.prepareForSong,
  )
  const releaseInactiveSmartSong = useSmartStemStore(
    (state) => state.releaseInactiveSong,
  )
  const setVolume = usePlayerStore((state) => state.setVolume)
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime)
  const setMediaDuration = usePlayerStore((state) => state.setMediaDuration)
  const setBuffered = usePlayerStore((state) => state.setBuffered)
  const setAudioReady = usePlayerStore((state) => state.setAudioReady)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const refreshCurrentUrl = usePlayerStore((state) => state.refreshCurrentUrl)
  const prefetchNext = usePlayerStore((state) => state.prefetchNext)

  // This is exclusively the external bar. It deliberately does not subscribe
  // to showNowPlaying: the detail overlay (z-85) simply covers it, so opening
  // or closing NowPlaying can never reflow/repaint these controls.
  const showNowPlaying = false
  const playerMenuTint = usePlayerMenuTint(false, currentSong?.al.picUrl)
  const showQueue = usePlayerStore((state) => state.showQueue)
  const resumeAt = usePlayerStore((state) => state.resumeAt)
  const consumeResumeAt = usePlayerStore((state) => state.consumeResumeAt)

  const videoActive = useVideoPlaybackStore((state) => state.active)
  const videoPlaying = useVideoPlaybackStore((state) => state.playing)
  const videoVolume = useVideoPlaybackStore((state) => state.volume)
  const toggleVideo = useVideoPlaybackStore((state) => state.toggle)
  const setVideoVolume = useVideoPlaybackStore((state) => state.setVolume)


  const [moreOpen, setMoreOpen] = useState(false)
  const nowPlayingOpen = usePlayerStore((state) => state.showNowPlaying)
  const pointerRef = useRef({ x: 0, y: 0 })
  const wasNowPlayingOpenRef = useRef(nowPlayingOpen)
  const [resumeHint, setResumeHint] = useState<{
    x: number
    y: number
  } | null>(null)

  // Pointer position is needed when the detail overlay disappears without the
  // user moving: hover/title tooltips are not re-evaluated under a stationary
  // cursor after the element above it is removed.
  useEffect(() => {
    const track = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointermove', track, { passive: true })
    return () => window.removeEventListener('pointermove', track)
  }, [])

  useEffect(() => {
    const wasOpen = wasNowPlayingOpenRef.current
    wasNowPlayingOpenRef.current = nowPlayingOpen
    if (nowPlayingOpen) {
      setResumeHint(null)
      return
    }
    if (!wasOpen) return
    const frame = window.requestAnimationFrame(() => {
      const { x, y } = pointerRef.current
      const target = document
        .elementFromPoint(x, y)
        ?.closest('[data-player-open-target]')
      if (target) setResumeHint({ x, y })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [nowPlayingOpen])

  useEffect(() => {
    if (!resumeHint) return
    const hide = () => setResumeHint(null)
    window.addEventListener('pointermove', hide, { once: true })
    window.addEventListener('pointerdown', hide, { once: true })
    return () => {
      window.removeEventListener('pointermove', hide)
      window.removeEventListener('pointerdown', hide)
    }
  }, [resumeHint])

  // Real duration reported by the media element; trial clips are shorter than
  // the catalogue duration in song.dt.
  const [mediaDuration, setLocalMediaDuration] = useState(0)
  // Keeps the thumb at the clicked position while a deferred seek waits for
  // metadata, instead of snapping back to the audio element's current 0.
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)

  const likedIds = useUserStore((state) => state.likedIds)
  const isLogin = useUserStore((state) => state.isLogin)
  const likeSong = useUserStore((state) => state.likeSong)
  const localFavorites = useLocalLibraryStore((state) => state.favorites)
  const toggleLocalFavorite = useLocalLibraryStore((state) => state.toggleFavorite)
  const liked = currentSong
    ? isLogin
      ? likedIds.includes(currentSong.id)
      : localFavorites.some((song) => song.id === currentSong.id)
    : false

  const mixer = () => {
    if (!mixerRef.current) {
      mixerRef.current = new DeckGainMixer(() => [
        audioARef.current,
        audioBRef.current,
      ])
    }
    return mixerRef.current
  }

  /** Set one deck's gain immediately (cancels its fade). */
  const applyGain = (element: HTMLAudioElement | null, gain: number) => {
    mixer().setDeck(element, gain)
  }

  /** Freeze any running deck fade where it is. */
  const clearFade = () => mixer().holdDecks()

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

  /** Freeze the pause/resume fade where it is; its callback is dropped. */
  const clearTransportFade = () => mixer().holdTransport()

  /** Animate the transport gain without touching either deck's fade gain. */
  const fadeTransport = (
    target: number,
    duration: number,
    onDone?: () => void,
  ) => {
    mixer().rampTransport(target, duration, 'smooth', onDone)
  }

  /** Silence a deck now and fade it in once its new source starts playing. */
  const armFadeIn = (element: HTMLAudioElement) => {
    mixer().setDeck(element, 0)
    pendingFadeInRef.current.add(element)
  }

  const runPendingFadeIn = (element: HTMLAudioElement) => {
    if (!pendingFadeInRef.current.delete(element)) return
    mixer().rampDeck(element, 1, TRACK_FADE_IN_MS)
  }

  /** Detach a finished element and release the blob URL it owned. */
  const settleElement = (element: HTMLAudioElement | null) => {
    if (!element) return
    pendingFadeInRef.current.delete(element)
    element.pause()
    element.currentTime = 0
    const src = element.getAttribute('src')
    element.removeAttribute('src')
    element.load()
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
  }

  /**
   * Fade a deck that is leaving, then release it. While it is still the
   * registered deck (the next source is not ready yet) it is only paused, so
   * the hand-off can settle it and release its blob URL later.
   */
  const fadeOutAndSettle = (element: HTMLAudioElement, ms: number) => {
    pendingFadeInRef.current.delete(element)
    mixer().rampDeck(element, 0, ms, 'smooth', () => {
      if (element === incomingRef.current) return
      if (element === audioRef.current) {
        element.pause()
        return
      }
      if (outgoingRef.current === element) outgoingRef.current = null
      settleElement(element)
    })
  }

  /** The deck a seek dip was started on still plays the same source. */
  const seekDipValid = (dip: NonNullable<typeof seekDipRef.current>) =>
    dip.element === audioRef.current &&
    dip.element.getAttribute('src') === dip.src &&
    !switchingRef.current

  const endSeekDip = (dip: NonNullable<typeof seekDipRef.current>) => {
    if (seekDipRef.current !== dip) return
    seekDipRef.current = null
    window.clearTimeout(dip.timer)
  }

  /** The new position is playing (or paused there): bring the deck back. */
  const finishSeekDip = (element: HTMLAudioElement) => {
    const dip = seekDipRef.current
    if (!dip || dip.element !== element || dip.phase !== 'wait') return
    endSeekDip(dip)
    // A track switch took the deck over; its own fades own the gain now.
    if (!seekDipValid(dip)) return
    if (element.paused) mixer().setDeck(element, 1)
    else mixer().rampDeck(element, 1, SEEK_FADE_IN_MS)
  }

  /** Move the playhead of a dipped deck (silent now) and wait for it to play. */
  const jumpSeekDip = (dip: NonNullable<typeof seekDipRef.current>) => {
    if (seekDipRef.current !== dip || dip.phase !== 'out') return
    if (!seekDipValid(dip)) {
      endSeekDip(dip)
      return
    }
    dip.phase = 'wait'
    window.clearTimeout(dip.timer)
    dip.timer = window.setTimeout(() => {
      // `seeked` never came (stalled network): don't leave the track muted.
      if (seekDipRef.current !== dip) return
      dip.phase = 'wait'
      finishSeekDip(dip.element)
    }, SEEK_RESTORE_TIMEOUT_MS)
    dip.element.currentTime = dip.target
    // Paused meanwhile: nothing will play, restore right away.
    if (dip.element.paused) finishSeekDip(dip.element)
  }

  const smoothSeek = (element: HTMLAudioElement, seconds: number) => {
    const dip = seekDipRef.current
    if (dip && dip.element === element) {
      // Rapid seeks (key repeat, several clicks) reuse the running dip: the
      // latest target wins and the deck stays silent until it plays.
      dip.target = seconds
      if (dip.phase === 'wait') element.currentTime = seconds
      return true
    }
    const gains = mixer()
    const audible =
      element === audioRef.current &&
      !element.paused &&
      !crossfadePendingRef.current &&
      !outgoingRef.current &&
      // A deck fading out is leaving (track switch); it masks the jump.
      gains.deckTarget(element) > 0 &&
      gains.deckGain(element) * gains.transportGain > 0.001
    if (!audible) return false
    if (dip) endSeekDip(dip)
    const next: NonNullable<typeof seekDipRef.current> = {
      element,
      src: element.getAttribute('src'),
      target: seconds,
      phase: 'out',
      timer: 0,
    }
    seekDipRef.current = next
    // Safety net: another gain change can replace the fade-out (and drop its
    // callback); still apply the seek shortly after.
    next.timer = window.setTimeout(() => jumpSeekDip(next), SEEK_FADE_OUT_MS + 150)
    gains.rampDeck(element, 0, SEEK_FADE_OUT_MS, 'smooth', () => jumpSeekDip(next))
    return true
  }

  /** Let the incoming track take over, fading the previous one out. */
  const startCrossfade = (incoming: HTMLAudioElement) => {
    if (!crossfadePendingRef.current || incoming !== incomingRef.current) return
    const outgoing = outgoingRef.current
    const mode = handoffModeRef.current
    handoffModeRef.current = null
    crossfadePendingRef.current = false
    incomingRef.current = null
    clearCrossfadeTimer()
    audioRef.current = incoming
    registerAudio(incoming)
    switchingRef.current = false
    setAudioReady(true)
    // The incoming element's loadeddata event fired before it became the active
    // element, so kick off the *next* track's prefetch now.
    prefetchNext()

    const overlapping = Boolean(
      outgoing &&
        outgoing !== incoming &&
        !outgoing.paused &&
        mixer().deckTarget(outgoing) > 0,
    )
    if (mode === 'natural' && overlapping && outgoing && crossfadeRef.current.enabled) {
      const configuredMs = crossfadeRef.current.ms
      const remainingMs = (outgoing.duration - outgoing.currentTime) * 1000
      // Never fade past the end of the outgoing file.
      const crossfadeMs = Math.min(
        crossfadeWindowMs(configuredMs, outgoing.duration),
        Number.isFinite(remainingMs) ? Math.max(1, remainingMs) : configuredMs,
      )
      if (crossfadeMs > 0) {
        clearFadeEndTimer()
        const finish = () => {
          clearFadeEndTimer()
          // A newer transition took over; this fade no longer owns the decks.
          if (outgoingRef.current !== outgoing) return
          outgoingRef.current = null
          settleElement(outgoing)
        }
        // Equal-power curves keep the perceived loudness constant while the
        // two songs overlap (a linear crossfade dips ~3 dB in the middle).
        mixer().setDeck(incoming, 0)
        mixer().rampDeck(incoming, 1, crossfadeMs, 'equal-power')
        mixer().rampDeck(outgoing, 0, crossfadeMs, 'equal-power', finish)
        // Safety net only; the mixer's timer keeps running while hidden.
        fadeEndTimerRef.current = window.setTimeout(finish, crossfadeMs + 1500)
        return
      }
    }

    // Manual switch, a late source, or nothing audible to overlap: the new
    // track comes up from silence and the old one (already fading) goes.
    mixer().setDeck(incoming, 0)
    mixer().rampDeck(incoming, 1, TRACK_FADE_IN_MS)
    if (outgoing && outgoing !== incoming) {
      if (outgoing.paused) {
        outgoingRef.current = null
        settleElement(outgoing)
      } else {
        fadeOutAndSettle(outgoing, SWITCH_FADE_OUT_MS)
      }
    } else {
      outgoingRef.current = null
    }
  }

  const maybeStartCrossfade = (audio: HTMLAudioElement) => {
    if (!crossfadePendingRef.current || audio !== incomingRef.current) return
    if (audio.paused) return
    startCrossfade(audio)
  }

  const pausePlayback = () => {
    clearTransportFade()
    clearCrossfadeTimer()
    crossfadePendingRef.current = false
    handoffModeRef.current = null
    clearFade()
    clearFadeEndTimer()

    const outgoing = outgoingRef.current
    outgoingRef.current = null
    if (outgoing) settleElement(outgoing)

    const incoming = incomingRef.current
    if (incoming && incoming !== audioRef.current) {
      incomingRef.current = null
      audioRef.current = incoming
      registerAudio(incoming)
      applyGain(incoming, 1)
      incoming.pause()
    } else {
      incomingRef.current = null
      const current = audioRef.current
      if (current) {
        applyGain(current, 1)
        current.pause()
      }
    }

    // Keep the transport at zero while paused; resume fades it back in.
    mixer().setTransport(0)
  }

  useEffect(
    () => () => {
      if (bufferingTimerRef.current !== null) {
        window.clearTimeout(bufferingTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    mixer().setMaster(usePlayerStore.getState().volume / 100, 0)
    audioRef.current = audioARef.current
    applyGain(audioARef.current, 1)
    applyGain(audioBRef.current, 1)
    registerAudio(audioARef.current)
    setSeekInterceptor({
      // Only refs are read inside, so the first render's closure stays valid.
      seek: (element, seconds) => smoothSeek(element, seconds),
      pendingTarget: (element) => {
        const dip = seekDipRef.current
        return dip && dip.element === element && dip.phase === 'out'
          ? dip.target
          : null
      },
    })
    return () => {
      setSeekInterceptor(null)
      const dip = seekDipRef.current
      if (dip) window.clearTimeout(dip.timer)
      seekDipRef.current = null
      registerAudio(null)
      clearFade()
      clearCrossfadeTimer()
      clearFadeEndTimer()
      clearTransportFade()
      mixerRef.current?.destroy()
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

  // Master volume glides over a few ms (slider steps, M to mute) and is
  // multiplied on top of any running fade instead of resetting it.
  useEffect(() => {
    mixer().setMaster(volume / 100)
  }, [volume])

  // Loudness leveling uses the existing captureStream analyser and only changes
  // the element's volume; it never reroutes audio through Web Audio.
  useEffect(() => {
    normalizationEnabledRef.current = volumeNormalization
    if (!volumeNormalization) {
      normalizationGainRef.current = 1
      mixer().setLeveling(1, 300)
      return
    }

    const targetRms = 0.16
    const timer = window.setInterval(() => {
      const audio = audioRef.current
      if (!audio || audio.paused) return
      // The analyser would measure the fade itself; level after it.
      if (mixer().busy) return
      attachAudioAnalyser(audio)
      const rms = getAudioRmsLevel()
      if (rms == null || !Number.isFinite(rms) || rms < 0.008) return
      const desired = Math.min(1.25, Math.max(0.55, targetRms / rms))
      normalizationGainRef.current +=
        (desired - normalizationGainRef.current) * 0.18
      mixer().setLeveling(normalizationGainRef.current, 700)
    }, 750)

    return () => window.clearInterval(timer)
  }, [volumeNormalization])

  const usingSmartStem = smartStemActiveSong === currentSong?.id

  useEffect(() => {
    releaseInactiveSmartSong(currentSong?.id ?? null)
  }, [currentSong?.id, releaseInactiveSmartSong])

  useEffect(() => {
    if (
      !songStemEnabled ||
      !playing ||
      videoActive ||
      !currentSong ||
      !sourceReady ||
      !audioUrl
    ) {
      return
    }
    if (usingSmartStem) return
    void prepareSmartStem(currentSong.id)
  }, [
    audioUrl,
    currentSong,
    playing,
    prepareSmartStem,
    songStemEnabled,
    sourceReady,
    usingSmartStem,
    videoActive,
  ])



  useEffect(() => {
    crossfadeRef.current = {
      enabled: crossfadeEnabled && crossfadeSeconds > 0,
      ms: Math.max(0, crossfadeSeconds * 1000),
    }
  }, [crossfadeEnabled, crossfadeSeconds])

  // Every play request (previous / next / pick a song / replay) bumps
  // playToken. Stop the old track synchronously on that commit; the source
  // effect starts the new track once its URL/blob is ready.
  useEffect(() => {
    if (lastPlayTokenRef.current === playToken) return
    lastPlayTokenRef.current = playToken
    // Only an automatic hand-off at the end of the previous track may
    // crossfade. Manual next/previous/pick-a-song switches immediately.
    const naturalTransition =
      autoNextTriggeredRef.current &&
      performance.now() - naturalEndAtRef.current < 2_000
    autoNextTriggeredRef.current = false
    naturalEndAtRef.current = 0
    handoffModeRef.current = null
    trialNotifiedRef.current = false
    const restartingSameSong = lastSongIdRef.current === currentSong?.id
    lastSongIdRef.current = currentSong?.id ?? null
    const audio = audioRef.current
    if (!audio) return

    // A pending resume (source switch keeps the position) must not reset the
    // shared clock to 0: lyrics, media session and the remote read it too.
    setCurrentTime(usePlayerStore.getState().resumeAt ?? 0)
    setBuffered(0)
    setAudioReady(false)

    // A crossfade still running from the previous transition: let its old
    // track go with a quick fade instead of cutting it mid-waveform.
    const staleOutgoing = outgoingRef.current
    if (staleOutgoing && staleOutgoing !== audio) {
      clearFadeEndTimer()
      outgoingRef.current = null
      if (staleOutgoing.paused) settleElement(staleOutgoing)
      else fadeOutAndSettle(staleOutgoing, SWITCH_FADE_OUT_MS)
    }

    // Replaying the same track restarts it in place; fading a song into itself
    // would just smear the two copies together.
    if (restartingSameSong || (audioUrl && audio.getAttribute('src') === audioUrl)) {
      crossfadePendingRef.current = false
      clearCrossfadeTimer()
      outgoingRef.current = null
      switchingRef.current = false
      const restart = () => {
        audio.pause()
        audio.currentTime = 0
        if (usePlayerStore.getState().playing) {
          armFadeIn(audio)
          void audio.play().catch(() => undefined)
        } else {
          applyGain(audio, 1)
        }
      }
      // Jumping back to 0:00 mid-waveform clicks: dip out first.
      if (!audio.paused && mixer().deckGain(audio) > 0.001) {
        mixer().rampDeck(audio, 0, SWITCH_FADE_OUT_MS, 'smooth', restart)
      } else {
        restart()
      }
      return
    }

    // Keep the outgoing element running until the incoming source is actually
    // ready. This is the hand-off that removes the silence at track changes.
    const hasActiveAudio =
      !restartingSameSong &&
      !audio.paused &&
      !audio.ended &&
      usePlayerStore.getState().playing
    // Natural ends use the configured crossfade. A manual switch fades the
    // playing track out right away (Apple Music does not crossfade skips)
    // while the next source loads on the other deck.
    const canCrossfade =
      hasActiveAudio &&
      (naturalTransition
        ? crossfadeRef.current.enabled && crossfadeRef.current.ms > 0
        : true)
    if (canCrossfade) {
      handoffModeRef.current = naturalTransition ? 'natural' : 'manual'
      const previousIncoming = incomingRef.current
      if (previousIncoming && previousIncoming !== audio) {
        settleElement(previousIncoming)
      }
      incomingRef.current = null
      const previousOutgoing = outgoingRef.current
      if (previousOutgoing && previousOutgoing !== audio) {
        settleElement(previousOutgoing)
      }
      clearCrossfadeTimer()
      clearFadeEndTimer()
      crossfadePendingRef.current = true
      outgoingRef.current = audio
      switchingRef.current = true
      if (!naturalTransition) {
        fadeOutAndSettle(audio, SWITCH_FADE_OUT_MS)
        return
      }
      // If the next source is slow, let the old track go instead of
      // overlapping indefinitely while the UI says "loading source". The
      // incoming deck keeps loading and starts with a short fade-in.
      const handoffMs = Math.min(
        3000,
        Math.max(CROSSFADE_HANDOFF_MS, crossfadeRef.current.ms),
      )
      crossfadeTimerRef.current = window.setTimeout(() => {
        crossfadeTimerRef.current = null
        if (!crossfadePendingRef.current) return
        handoffModeRef.current = 'manual'
        if (outgoingRef.current === audio && !audio.paused) {
          fadeOutAndSettle(audio, LATE_HANDOFF_FADE_MS)
        }
      }, handoffMs)
      return
    }

    // No active audio to overlap (first play, paused transition, or replay):
    // stop immediately and let the source effect start the next track.
    crossfadePendingRef.current = false
    clearCrossfadeTimer()
    clearFadeEndTimer()
    const incoming = incomingRef.current
    incomingRef.current = null
    if (incoming && incoming !== audio) settleElement(incoming)
    outgoingRef.current = null
    switchingRef.current = true
    if (audio.paused) {
      audio.currentTime = 0
    } else {
      // Still audible (e.g. inside the pause fade): dip out, the source
      // effect then loads the next track into this deck.
      mixer().rampDeck(audio, 0, SWITCH_FADE_OUT_MS, 'smooth', () => {
        if (audio === audioRef.current && switchingRef.current) audio.pause()
      })
    }

    if (!usePlayerStore.getState().playing) return
  }, [playToken, audioUrl, currentSong?.id, setAudioReady, setBuffered, setCurrentTime])

  // A pending seek belongs to the track it was made on. Error retries are also
  // per-track: refreshing the same song's signed URL must not re-arm the retry,
  // otherwise a permanently broken source loops refresh -> error forever.
  useEffect(() => {
    pendingSeekRef.current = null
    retriedRef.current = null
    normalizationGainRef.current = 1
    mixer().setLeveling(1, 300)
    setPendingSeek(null)
  }, [currentSong?.id])

  useEffect(() => {
    if (!audioUrl) return
    const current = audioRef.current
    if (!current) return
    const preservePlaybackUi =
      usePlayerStore.getState().sourceTransition === 'stem'
    const forcedReload =
      lastSourceReloadTokenRef.current !== sourceReloadToken
    lastSourceReloadTokenRef.current = sourceReloadToken
    if (current.getAttribute('src') === audioUrl && !forcedReload) {
      attachAudioAnalyser(current)
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
      // Lyrics and seek helpers follow the incoming track as soon as it owns
      // the new url, even while the previous element is still audible.
      registerAudio(target)
    } else {
      // A source swap replaces the active element; a fade in flight ends
      // with a quick fade-out instead of a cut.
      clearFadeEndTimer()
      const fading = outgoingRef.current
      outgoingRef.current = null
      if (fading && fading !== target) {
        if (fading.paused) settleElement(fading)
        else fadeOutAndSettle(fading, SWITCH_FADE_OUT_MS)
      }
      incomingRef.current = null
      registerAudio(target)
      switchingRef.current = true
      clearBufferingTimer()
      seekingRef.current = false
      if (preservePlaybackUi) {
        // Original/vocals/accompaniment are the same playback session. Keep
        // the progress and pause button stable while the new WAV is loading.
        stemSwitchRef.current = true
        if (stemSwitchTimerRef.current) {
          window.clearTimeout(stemSwitchTimerRef.current)
        }
        stemSwitchTimerRef.current = window.setTimeout(() => {
          stemSwitchRef.current = false
          stemSwitchTimerRef.current = null
        }, 2500)
      } else {
        // The new element starts at 0 until loadedmetadata applies resumeAt.
        setCurrentTime(usePlayerStore.getState().resumeAt ?? 0)
        setBuffered(0)
        setAudioReady(false)
        setLocalMediaDuration(0)
        setMediaDuration(0)
      }
    }

    const loadToken = ++sourceLoadTokenRef.current
    const url = audioUrl
    const load = () => {
      if (loadToken !== sourceLoadTokenRef.current) return
      // Incoming crossfade decks stay silent until the crossfade starts;
      // anything else comes up from silence once it actually plays.
      if (crossfade) {
        pendingFadeInRef.current.delete(target)
        applyGain(target, 0)
      } else {
        armFadeIn(target)
      }
      target.pause()
      target.currentTime = 0
      const previousSrc = target.getAttribute('src')
      // Official CDN requests opt into CORS for the analyser; blob and
      // third-party URLs keep the old no-CORS path and simply fall back to the
      // simulated pulse when captureStream cannot expose them.
      target.crossOrigin = canAnalyseAudio(url) ? 'anonymous' : null
      target.src = url
      target.load()
      attachAudioAnalyser(target)
      if (previousSrc?.startsWith('blob:')) URL.revokeObjectURL(previousSrc)

      if (usePlayerStore.getState().playing) {
        void target.play().catch(() => undefined)
      }
    }
    // Replacing the source of an element that is still audible (stem or
    // quality switch, recovery reload, a third track during a crossfade)
    // cuts its waveform: fade it out first.
    if (
      !target.paused &&
      mixer().deckGain(target) * mixer().transportGain > 0.001
    ) {
      mixer().rampDeck(target, 0, SOURCE_SWAP_FADE_MS, 'smooth', load)
    } else {
      load()
    }
  }, [
    audioUrl,
    sourceReloadToken,
    setAudioReady,
    setBuffered,
    setCurrentTime,
    setMediaDuration,
  ])

  useEffect(() => {
    const wasPlaying = lastPlayingRef.current
    lastPlayingRef.current = playing

    if (playing) {
      resumeAudioAnalyser()
      if (!sourceReady || !audioUrl) return
      const incoming = incomingRef.current
      const target =
        incoming && incoming.getAttribute('src') === audioUrl ? incoming : audioRef.current
      if (!target || target.getAttribute('src') !== audioUrl) return
      attachAudioAnalyser(target)

      // Resuming, or a deferred source becoming ready after resume, must come
      // up from silence instead of jumping straight to full volume.
      const needsFadeIn = mixer().transportGain < 0.999
      if (needsFadeIn) {
        pendingFadeInRef.current.delete(target)
        applyGain(target, 1)
        // A completed pause starts at zero. A quick resume that interrupts a
        // pause fade keeps its current level and ramps back up from there.
        if (target.paused) mixer().setTransport(0)
      }
      if (target.paused) void target.play().catch(() => undefined)
      if (needsFadeIn) fadeTransport(1, RESUME_FADE_MS)
      return
    }

    if (!wasPlaying) {
      // Keep a paused deck silent without cutting a fade that is still
      // finishing; a later resume will fade in from zero.
      if (audioRef.current?.paused) mixer().setTransport(0)
      return
    }

    // Pause transition: fade the audible decks first, then stop them.
    const current = audioRef.current
    if (!current || current.paused) {
      pausePlayback()
      return
    }
    fadeTransport(0, PAUSE_FADE_MS, () => {
      if (usePlayerStore.getState().playing) return
      pausePlayback()
    })
  }, [playing, sourceReady, audioUrl])

  useEffect(() => {
    if (!playing || !sourceReady || audioReady) {
      bufferRecoveryRef.current = null
      return
    }
    const songId = currentSong?.id
    const timer = window.setTimeout(() => {
      const state = usePlayerStore.getState()
      if (!state.playing) return
      const incoming = incomingRef.current
      const target =
        incoming && incoming.getAttribute('src') === audioUrl
          ? incoming
          : audioRef.current
      if (target && target.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        if (target.paused) {
          void target
            .play()
            .then(() => setAudioReady(true))
            .catch(() => {
              void refreshCurrentUrl()
            })
        } else {
          setAudioReady(true)
        }
        return
      }
      const attempts =
        bufferRecoveryRef.current?.songId === songId
          ? bufferRecoveryRef.current.attempts + 1
          : 1
      bufferRecoveryRef.current = {
        songId: songId ?? 0,
        attempts,
      }
      if (attempts >= 2) {
        usePlayerStore.getState().setPlaying(false)
        toast.warning(i18n._(msg`歌曲加载超时，请重新播放`))
        return
      }
      void refreshCurrentUrl()
    }, 12_000)
    return () => window.clearTimeout(timer)
  }, [
    audioReady,
    audioUrl,
    currentSong?.id,
    playing,
    refreshCurrentUrl,
    setAudioReady,
    sourceReady,
    sourceReloadToken,
  ])

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
      const inDialog = Boolean(
        target?.closest('[role="dialog"], [role="menu"], [role="listbox"]'),
      )
      if (
        event.code === 'Space' &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        // The player owns Space outside text fields and menus. Letting a
        // focused track-info button handle it opened/closes the song detail
        // page instead of toggling playback.
        if (inDialog) return
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
        return
      }
      if (inDialog || event.defaultPrevented) return
      // Focused sliders and tab lists use the arrow keys themselves.
      if (
        target?.closest(
          '[role="slider"], [role="tablist"], [role="tab"], [role="radiogroup"]',
        )
      ) {
        return
      }
      const modifier = event.ctrlKey || event.metaKey
      if (
        (event.code === 'ArrowLeft' || event.code === 'ArrowRight') &&
        !event.altKey &&
        !event.shiftKey
      ) {
        const forward = event.code === 'ArrowRight'
        event.preventDefault()
        if (modifier) {
          if (event.repeat) return
          const state = usePlayerStore.getState()
          void (forward ? state.next() : state.prev())
          return
        }
        seekBy(forward ? SEEK_STEP : -SEEK_STEP)
        return
      }
      if (modifier || event.altKey || event.shiftKey || event.repeat) return
      if (event.code === 'KeyM') {
        event.preventDefault()
        toggleMute()
      } else if (event.code === 'KeyL') {
        event.preventDefault()
        toggleLikeCurrent()
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
      // Matched third-party URLs are registered by the API when the matcher
      // resolves them, so the local proxy can download them for transcoding.
      const meta = {
        id: active.id,
        name: active.name,
        url: active.url ?? '',
        // Each provider gets its own cached copy of the same song id.
        source: cacheSourceOf(active),
        lyricSongId: active.alternativeSongId ?? active.id,
        artists: formatArtists(active.ar),
        duration: active.dt,
        trialEnd: active.trialEnd ?? 0,
        picUrl: active.al.picUrl,
        albumId: active.al.id,
        // Kept with the cached copy so the source menu can still link to the
        // video after the queue no longer holds the freshly matched URL.
        webUrl: active.matchedWebUrl,
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
    // Ask the CDN for a 512px copy instead of the multi-megapixel original.
    const artworkUrl = resizedImageUrl(currentSong.al.picUrl, '512y512')
    const artwork = artworkUrl
      ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
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
      if (typeof details.seekTime === 'number') {
        usePlayerStore.getState().seekTo(details.seekTime)
      }
    })
    set('seekbackward', (details) => {
      const audio = getAudio()
      if (audio) seekAudio(playheadTime(audio) - (details.seekOffset ?? 10))
    })
    set('seekforward', (details) => {
      const audio = getAudio()
      if (audio) seekAudio(playheadTime(audio) + (details.seekOffset ?? 10))
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
  // once per second so that echo can never become a render loop. A store
  // subscription keeps the position stream off the render path.
  const lastPositionRef = useRef(-1)

  useEffect(() => {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) {
      return
    }
    const publish = (time: number) => {
      if (Math.abs(time - lastPositionRef.current) < 1) return
      const durationSeconds = mediaSessionDuration / 1000
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return
      lastPositionRef.current = time
      try {
        navigator.mediaSession.setPositionState({
          duration: durationSeconds,
          playbackRate: 1,
          position: Math.min(durationSeconds, Math.max(0, time)),
        })
      } catch {
        // Ignore transient invalid states while a track is switching.
      }
    }
    publish(usePlayerStore.getState().currentTime)
    return usePlayerStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime) publish(state.currentTime)
    })
  }, [mediaSessionDuration])

  if (!queue.length || !currentSong) {
    return (
      <div className="player-glass flex h-[76px] items-center justify-center text-[12px] text-ink-4">
        <Trans>选择一首歌曲开始播放</Trans>
      </div>
    )
  }

  const sourceMatches =
    Boolean(audioUrl) && audioRef.current?.getAttribute('src') === audioUrl
  // A trial clip is limited to its trial length (freeTrialInfo end - start)
  // file itself is longer; otherwise prefer the loaded media duration.
  const trialDuration =
    currentSong.trialEnd && currentSong.trialEnd > 0 ? currentSong.trialEnd * 1000 : 0
  const duration =
    trialDuration || (sourceMatches ? mediaDuration : 0) || currentSong.dt || 0
  const loadingSource = playing && !sourceReady
  const buffering = playing && sourceReady && !audioReady
  const playbackPlaying = videoActive ? videoPlaying : playing
  const playbackBusy = videoActive ? false : busyVisible

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
      // Keep the store in step so the song page shows (and play starts at)
      // the same target; this bar applies it itself on loadedmetadata.
      usePlayerStore.getState().seekTo((value / 100) * (duration / 1000), { defer: true })
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
    // A click on the current position should not enter the seeking state.
    seekingRef.current = Math.abs(playheadTime(audio) - seconds) > 0.15
    seekElement(audio, seconds)
    setCurrentTime(seconds)
  }

  const clearBufferingTimer = () => {
    if (bufferingTimerRef.current === null) return
    window.clearTimeout(bufferingTimerRef.current)
    bufferingTimerRef.current = null
  }

  const markAudioReady = () => {
    clearBufferingTimer()
    setAudioReady(true)
    if (usePlayerStore.getState().sourceTransition === 'stem') {
      usePlayerStore.setState({ sourceTransition: 'none' })
    }
  }

  const markBuffering = () => {
    if (bufferingTimerRef.current !== null) return
    bufferingTimerRef.current = window.setTimeout(() => {
      bufferingTimerRef.current = null
      if (seekingRef.current) return
      setAudioReady(false)
    }, 240)
  }

  const updateBuffered = () => {
    if (switchingRef.current) return
    const audio = audioRef.current
    if (!audio) return
    const ranges = audio.buffered
    if (!ranges.length || !audio.duration) return
    setBuffered((ranges.end(ranges.length - 1) / audio.duration) * 100)
  }

  /** The trial window is over: stop and explain why (see togglePlay restart). */
  const endTrial = (audio: HTMLAudioElement) => {
    // Stopping through the store runs the normal pause fade; a file that
    // already ended is silent anyway.
    if (audio.ended) audio.pause()
    usePlayerStore.getState().setPlaying(false)
    if (!trialNotifiedRef.current) {
      trialNotifiedRef.current = true
      toast.warning(i18n._(msg`试听结束，登录或开通会员可播放完整版`))
    }
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
      const durationMs = Number.isFinite(value) && value > 0 ? value * 1000 : 0
      setLocalMediaDuration(durationMs)
      setMediaDuration(durationMs)
      // A seek requested before the media became seekable (clicking the bar
      // right after a restart) is what the user asked for: it wins over an
      // automatic resume point. Previously a recovery reload's resumeAt of 0
      // won and the click jumped back to the start.
      const pending = pendingSeekRef.current
      if (pending) {
        pendingSeekRef.current = null
        setPendingSeek(null)
        if (pending.songId === currentSong.id) {
          const mediaSeconds =
            Number.isFinite(value) && value > 0 ? value : duration / 1000
          const seconds = (pending.percent / 100) * mediaSeconds
          audio.currentTime = seconds
          if (audio === audioRef.current) setCurrentTime(seconds)
          if (resumeAt != null) consumeResumeAt()
          return
        }
      }
      // A source switch, recovery reload or restored session keeps its position.
      if (resumeAt != null) {
        const target = Math.min(
          resumeAt,
          Number.isFinite(value) && value > 0 ? value : resumeAt,
        )
        audio.currentTime = target
        if (audio === audioRef.current) setCurrentTime(target)
        consumeResumeAt()
      }
    },
    onLoadedData: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current && audio !== incomingRef.current) return
      if (!audioUrl || audio.getAttribute('src') !== audioUrl) return
      if (stemSwitchTimerRef.current) {
        window.clearTimeout(stemSwitchTimerRef.current)
        stemSwitchTimerRef.current = null
      }
      stemSwitchRef.current = false
      seekingRef.current = false
      markAudioReady()
      if (audio === audioRef.current) {
        switchingRef.current = false
        prefetchNext()
      }
    },
    onCanPlay: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current && audio !== incomingRef.current) return
      if (!audioUrl || audio.getAttribute('src') !== audioUrl) return
      if (stemSwitchTimerRef.current) {
        window.clearTimeout(stemSwitchTimerRef.current)
        stemSwitchTimerRef.current = null
      }
      stemSwitchRef.current = false
      markAudioReady()
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
      if (stemSwitchTimerRef.current) {
        window.clearTimeout(stemSwitchTimerRef.current)
        stemSwitchTimerRef.current = null
      }
      stemSwitchRef.current = false
      if (audio === incomingRef.current) {
        maybeStartCrossfade(audio)
        return
      }
      runPendingFadeIn(audio)
      finishSeekDip(audio)
      // Safety net: a resume point loadedmetadata did not apply (the source
      // was not reloaded) must not stay on screen while playback runs elsewhere.
      const pendingResume = usePlayerStore.getState().resumeAt
      if (pendingResume != null) {
        const limit = Number.isFinite(audio.duration) ? audio.duration : pendingResume
        if (Math.abs(audio.currentTime - pendingResume) > 0.5) {
          audio.currentTime = Math.min(pendingResume, limit)
        }
        setCurrentTime(audio.currentTime)
        consumeResumeAt()
      }
      switchingRef.current = false
      markAudioReady()
    },
    onSeeking: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (
        event.currentTarget !== audioRef.current &&
        event.currentTarget !== incomingRef.current
      ) {
        return
      }
      seekingRef.current = true
      clearBufferingTimer()
    },
    onSeeked: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (
        event.currentTarget !== audioRef.current &&
        event.currentTarget !== incomingRef.current
      ) {
        return
      }
      seekingRef.current = false
      finishSeekDip(event.currentTarget)
      if (!audioUrl || event.currentTarget.getAttribute('src') !== audioUrl) return
      markAudioReady()
    },
    onPause: (event: SyntheticEvent<HTMLAudioElement>) => {
      // A user-initiated pause must keep the source ready. Clearing it here
      // made the next resume look like buffering for a few frames, which
      // flashed the loading state and shifted the now-playing layout.
      if (event.currentTarget !== audioRef.current) return
      if (stemSwitchRef.current || switchingRef.current) return
      if (usePlayerStore.getState().playing) markBuffering()
    },
    onDurationChange: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current && audio !== incomingRef.current) return
      if (!audioUrl || audio.getAttribute('src') !== audioUrl) return
      const value = audio.duration
      const durationMs = Number.isFinite(value) && value > 0 ? value * 1000 : 0
      setLocalMediaDuration(durationMs)
      setMediaDuration(durationMs)
    },
    onWaiting: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget !== audioRef.current) return
      if (seekingRef.current || stemSwitchRef.current) return
      markBuffering()
    },
    onStalled: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget !== audioRef.current) return
      if (seekingRef.current || stemSwitchRef.current) return
      markBuffering()
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => {
      const audio = event.currentTarget
      if (audio !== audioRef.current) return
      if (switchingRef.current) return
      if (audioUrl && audio.getAttribute('src') !== audioUrl) return
      // Fallback for a start that did not report `playing`.
      if (!audio.paused) runPendingFadeIn(audio)
      // The playhead has not moved to the seek target yet; reporting the old
      // position would snap the progress thumb back for a frame.
      const dip = seekDipRef.current
      if (dip && dip.element === audio && dip.phase === 'out') return
      setCurrentTime(audio.currentTime)
      updateBuffered()
      if (errorSkipsRef.current && audio.currentTime > 1) errorSkipsRef.current = 0

      const trialEnd = currentSong.trialEnd ?? 0
      const isTrial = trialEnd > 0
      if (isTrial && audio.currentTime >= trialEnd) {
        endTrial(audio)
        return
      }

      // Start the next track just before the current one ends so the two
      // elements can overlap. Without this, `ended` only fires after the audio
      // has stopped, which guarantees a gap even with a crossfade configured.
      // A trial clip ends at the trial limit instead of rolling into the next
      // track (the clip file is about as long as the trial itself).
      if (
        crossfadeRef.current.enabled &&
        crossfadeRef.current.ms > 0 &&
        !isTrial &&
        mode !== 'singleLoop' &&
        usePlayerStore.getState().playing &&
        !switchingRef.current &&
        !autoNextTriggeredRef.current &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        const remainingMs = (audio.duration - audio.currentTime) * 1000
        const fadeWindow = crossfadeWindowMs(
          crossfadeRef.current.ms,
          audio.duration,
        )
        if (remainingMs > 0 && remainingMs <= fadeWindow + 80) {
          autoNextTriggeredRef.current = true
          naturalEndAtRef.current = performance.now()
          void next({ auto: true })
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
      // The clip file can be a few ms shorter than the reported trial length.
      if ((currentSong.trialEnd ?? 0) > 0) {
        endTrial(event.currentTarget)
        return
      }
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
      clearBufferingTimer()
      setAudioReady(false)
      if (usePlayerStore.getState().sourceTransition === 'stem') {
        usePlayerStore.setState({ sourceTransition: 'none' })
      }
      if (!audioUrl) return
      if (audio === incomingRef.current) {
        // The transition source failed: drop the fade and let the recovery
        // path replace the active element's source instead. The old track is
        // still the active one and never enters the fade.
        crossfadePendingRef.current = false
        handoffModeRef.current = null
        incomingRef.current = null
        outgoingRef.current = null
        clearCrossfadeTimer()
        audio.pause()
      }
      if (retriedRef.current === currentSong.id) {
        // Recovery skip: stop at the end in sequential mode instead of looping
        // through a queue whose sources are all broken. Random / single-loop
        // modes never reach an "end", so cap consecutive skips as well.
        errorSkipsRef.current += 1
        if (errorSkipsRef.current >= Math.min(MAX_ERROR_SKIPS, queue.length)) {
          errorSkipsRef.current = 0
          usePlayerStore.getState().setPlaying(false)
          toast.warning(i18n._(msg`连续多首歌曲无法播放，已暂停播放`))
          return
        }
        void next({ auto: true })
        return
      }
      retriedRef.current = currentSong.id
      void refreshCurrentUrl()
    },
  }

  // Video mode drives the MV element's volume instead of the audio one.
  const currentVolume = videoActive ? videoVolume : volume
  const volumeIcon =
    currentVolume === 0 ? (
      <VolumeX className="h-4 w-4" />
    ) : currentVolume < 45 ? (
      <Volume1 className="h-4 w-4" />
    ) : (
      <Volume2 className="h-4 w-4" />
    )

  return (
    <div
      className={cn(
        'player-glass relative grid h-[76px] items-center px-4 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-2 max-md:px-3',
        showNowPlaying
          ? 'gap-2 grid-cols-[minmax(0,1fr)_minmax(340px,560px)_minmax(0,1fr)]'
          : // Fixed 170 / 300 / 150px minimums overflowed bars narrower than
            // ~690px (a 768–950px window with the sidebar open) and clipped
            // the right-hand buttons. The song column now gives way first
            // (the title truncates); the transport and the buttons keep the
            // width their content needs.
            'grid-cols-[minmax(0,1fr)_minmax(min-content,1.5fr)_minmax(max-content,1fr)] gap-4',
        // NowPlaying renders its own transport. Keep this instance mounted for
        // the audio engine, but hide its UI so there is no surface to morph.
        showNowPlaying ? 'invisible pointer-events-none z-30' : 'z-30',
      )}
      style={
        showNowPlaying
          ? {
              background: 'transparent',
              backdropFilter: 'none',
              WebkitBackdropFilter: 'none',
              borderTopColor: 'transparent',
            }
          : undefined
      }
      onClick={() => {
        // The queue backdrop stops above the player bar so controls stay
        // usable; clicking the bar itself is still an outside click.
        if (showQueue) toggleQueue(false)
      }}
    >
      {resumeHint ? (
        <span
          className="pointer-events-none fixed z-[80] rounded-[6px] bg-black/80 px-2 py-1 text-[11px] text-white shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          style={{
            left: Math.min(resumeHint.x + 12, window.innerWidth - 100),
            top: Math.min(resumeHint.y + 18, window.innerHeight - 32),
          }}
        >
          <Trans>打开播放页</Trans>
        </span>
      ) : null}
      {videoActive ? <VideoProgress /> : null}
      {showNowPlaying ? (
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => toggleNowPlaying(false)}
            aria-label={i18n._(msg`收起播放页`)}
            className="np-round-button pressable flex h-9 w-9 items-center justify-center rounded-full text-white/75"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div
        className={cn(
          'flex min-w-0 cursor-pointer items-center gap-3',
          showNowPlaying && 'hidden',
        )}
        onClick={(event) => {
          const target = event.target as HTMLElement
          // Cover/title have their own handlers; links/artists and the
          // utility controls must keep their native actions. Everything else
          // in this block (cover/title gaps, badges, empty space) opens the
          // immersive player.
          if (
            target.closest(
              'button, a, input, select, textarea, [role="button"], [contenteditable="true"]',
            )
          ) {
            return
          }
          toggleNowPlaying()
        }}
      >
        <button
          type="button"
          data-player-cover
          data-player-open-target
          onClick={() => toggleNowPlaying()}
          aria-label={i18n._(msg`打开播放页`)}
          className="group pressable relative shrink-0 cursor-pointer"
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
          data-player-open-target
          aria-label={i18n._(msg`打开播放页`)}
          // Not flex-1: the like / add-to-playlist buttons follow the title
          // instead of sitting at the far edge of the column.
          className="min-w-0 cursor-pointer"
          onClick={(event) => {
            // Do not let nested controls open the immersive player.
            if ((event.target as HTMLElement).closest('button')) return
            toggleNowPlaying()
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter') {
              event.preventDefault()
              toggleNowPlaying()
            }
          }}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-ink-1 hover:text-accent">
              {currentSong.name}
            </span>
            {currentSong.trialEnd ? (
              <span className="shrink-0 rounded-[6px] bg-warn/12 px-1 text-[11px] text-warn-ink">
                <Trans>试听</Trans>
              </span>
            ) : null}
            {currentSong.alternativeVersion ? (
              <span
                className="shrink-0 rounded-[6px] bg-accent/10 px-1 text-[11px] text-accent"
                title={i18n._(msg`当前使用网易云推荐的其他可播放版本`)}
              >
                <Trans>其他版本</Trans>
              </span>
            ) : currentSong.unblocked ? (
              <span
                className="shrink-0 rounded-[6px] bg-accent/10 px-1 text-[11px] text-accent"
                title={i18n._(msg`该歌曲没有官方音源，当前使用匹配到的其他音源`)}
              >
                <Trans>其他音源</Trans>
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-ink-3">
            {busyVisible && loadingSource ? (
              <>
                <Loader2 className="h-3 w-3 flex-none animate-spin text-accent" />
                <Trans>正在加载音源…</Trans>
              </>
            ) : (
              <ArtistLinks artists={currentSong.ar} />
            )}
          </p>
        </div>

        {/* Song actions live with the song (Apple Music / Spotify), not in
            the transport. Hidden on mobile like before; the song page has
            the like button there. */}
        <div className="flex shrink-0 items-center gap-0.5 max-md:hidden">
          <button
            type="button"
            aria-label={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
            aria-pressed={liked}
            title={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
            onClick={() => {
              if (isLogin) void likeSong(currentSong.id, !liked)
              else void toggleLocalFavorite(currentSong)
            }}
            className="pressable flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          >
            <Heart
              className={cn(
                'h-4 w-4 transition-colors',
                liked ? 'fill-love text-love' : 'text-ink-4 hover:text-ink-2',
              )}
            />
          </button>
          <PlaylistPicker
            song={currentSong}
            tint={playerMenuTint}
            buttonClassName="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5"
          />
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
              heartMode ? 'text-love' : 'text-ink-4 hover:text-ink-2',
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
            aria-label={i18n._(msg`上一首`)}
            onClick={() => void prev()}
            className="pressable flex h-8 w-8 items-center justify-center text-ink-2 hover:text-ink-1 max-md:h-10 max-md:w-10"
          >
            <SkipBack className="h-5 w-5 fill-current" />
          </button>
          <button
            type="button"
            aria-label={
              videoActive
                ? playbackPlaying
                  ? i18n._(msg`暂停`)
                  : i18n._(msg`播放`)
                : loadingSource
                  ? i18n._(msg`正在加载音源`)
                  : buffering
                    ? i18n._(msg`正在缓冲`)
                    : playbackPlaying
                      ? i18n._(msg`暂停`)
                      : i18n._(msg`播放`)
            }
            onClick={() => {
              if (videoActive) toggleVideo()
              else void togglePlay()
            }}
            className="pressable flex h-10 w-10 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-black/5 hover:text-ink-1 max-md:h-10 max-md:w-10"
          >
            {playbackBusy ? (
              <Loader2 className={TRANSPORT_BUSY_ICON} />
            ) : playbackPlaying ? (
              <Pause className={TRANSPORT_PAUSE_ICON} />
            ) : (
              <Play className={TRANSPORT_PLAY_ICON} />
            )}
          </button>
          <button
            type="button"
            aria-label={i18n._(msg`下一首`)}
            onClick={() => void next()}
            className="pressable flex h-8 w-8 items-center justify-center text-ink-2 hover:text-ink-1 max-md:h-10 max-md:w-10"
          >
            <SkipForward className="h-5 w-5 fill-current" />
          </button>
          <button
            type="button"
            title={
              i18n._(PLAY_MODE_LABELS[mode])
            }
            onClick={cycleMode}
            className={cn(
              'pressable flex h-8 w-8 items-center justify-center transition-colors max-md:h-10 max-md:w-10',
              mode === 'order'
                ? 'text-ink-4 hover:text-ink-2'
                : 'text-ink-2 hover:text-ink-1',
            )}
          >
            {modeIcon}
          </button>
        </div>

        {!videoActive ? (
          <AudioProgressRow
            sliderKey={`${currentSong.id}-${playToken}-audio`}
            audioRef={audioRef}
            audioUrl={audioUrl}
            durationMs={duration}
            pendingSeek={pendingSeek}
            onSeek={handleSeek}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 max-md:hidden">
        <button
          type="button"
          onClick={() => toggleQueue()}
          aria-label={i18n._(msg`播放列表`)}
          aria-pressed={showQueue}
          title={i18n._(msg`播放列表`)}
          className={cn(
            'pressable flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5',
            showQueue ? 'text-accent' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          <ListMusic className="h-4 w-4" />
        </button>

        {/* Wide bars show the level inline (click the speaker to mute);
            narrower ones keep the vertical popover. */}
        <div className="hidden items-center gap-1 lg:flex">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={currentVolume === 0 ? i18n._(msg`取消静音`) : i18n._(msg`静音`)}
            title={i18n._(msg`静音（M）`)}
            className="pressable flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-black/5 hover:text-ink-2"
          >
            {volumeIcon}
          </button>
          {/* ProgressSlider is w-full; the wrapper sets the 96px width. */}
          <div className="w-24 shrink-0">
            <ProgressSlider
              value={currentVolume}
              onChange={(value) =>
                (videoActive ? setVideoVolume : setVolume)(Math.round(value))
              }
              ariaLabel={i18n._(msg`音量`)}
              valueText={`${currentVolume}%`}
            />
          </div>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'pressable flex h-7 w-7 items-center justify-center rounded-full transition-colors max-md:h-10 max-md:w-10 lg:hidden',
                showNowPlaying
                  ? 'text-white/55 hover:bg-white/10 hover:text-white'
                  : 'text-ink-3 hover:bg-black/5 hover:text-ink-2',
              )}
              aria-label={i18n._(msg`音量`)}
              title={i18n._(msg`音量（Alt + ↑ / ↓）`)}
            >
              {volumeIcon}
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
                <VolumeSlider
                  value={videoActive ? videoVolume : volume}
                  onChange={videoActive ? setVideoVolume : setVolume}
                />
                <span className="text-[11px] tabular-nums text-ink-4">
                  {currentVolume}
                </span>
              </div>
            </PopoverContent>
        </Popover>

        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={i18n._(msg`更多播放选项`)}
              title={i18n._(msg`更多播放选项`)}
              className="pressable flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-black/5 hover:text-ink-2 max-md:h-10 max-md:w-10"
            >
              <Ellipsis className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <MorePlaybackOptions
            immersive={false}
            onClose={() => setMoreOpen(false)}
          />
        </Popover>

        {/* {!showNowPlaying ? (
          <button
            type="button"
            onClick={() => toggleNowPlaying()}
            className="pressable flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-black/5 hover:text-ink-2 max-md:h-10 max-md:w-10"
            aria-label={i18n._(msg`展开播放页`)}
          >
            <ChevronUp className="h-[16px] w-[16px]" />
          </button>
        ) : null} */}
      </div>

      <audio ref={audioARef} className="hidden" {...audioProps} />
      <audio ref={audioBRef} className="hidden" {...audioProps} />
    </div>
  )
}

/**
 * Elapsed / slider / duration row. It owns the currentTime and buffered
 * subscriptions, so the ~4 Hz timeupdate stream re-renders this row only.
 */
function AudioProgressRow({
  sliderKey,
  audioRef,
  audioUrl,
  durationMs,
  pendingSeek,
  onSeek,
}: {
  sliderKey: string
  audioRef: RefObject<HTMLAudioElement | null>
  audioUrl: string
  durationMs: number
  pendingSeek: number | null
  onSeek: (value: number) => void
}) {
  const currentTime = usePlayerStore((state) => state.currentTime)
  const buffered = usePlayerStore((state) => state.buffered)
  const showRemaining = useSettingsStore((state) => state.showRemainingTime)
  // Where playback is about to resume (restored session, recovery reload,
  // source switch). The new media starts at 0 until loadedmetadata seeks it;
  // showing currentTime in between made the bar jump 0:00 -> 1:12.
  const resumeTime = usePlayerStore((state) => state.resumeAt)
  // While the audio element still points at the previous track, force the
  // progress UI to zero so stale timeupdate events can never leak through.
  const sourceMatches =
    Boolean(audioUrl) && audioRef.current?.getAttribute('src') === audioUrl
  const percent = durationMs ? Math.min(100, (currentTime * 1000 * 100) / durationMs) : 0
  const pendingTime =
    pendingSeek !== null ? (pendingSeek / 100) * (durationMs / 1000) : null
  // A deferred seek keeps showing its target instead of snapping back to 0.
  const resumePercent =
    resumeTime != null && durationMs
      ? Math.min(100, (resumeTime * 1000 * 100) / durationMs)
      : 0
  const displayTime = pendingTime ?? resumeTime ?? (sourceMatches ? currentTime : 0)
  const displayPercent =
    pendingSeek ?? (resumeTime != null ? resumePercent : sourceMatches ? percent : 0)
  const displayBuffered = sourceMatches ? buffered : 0

  return (
    <div
      // Mobile: an edge-to-edge line on the bar's top border (Apple Music /
      // Spotify mini player). `-top-px` sits it on the 1px border itself.
      className="player-progress-row mt-1.5 grid h-5 w-full grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-2.5 max-md:absolute max-md:inset-x-0 max-md:-top-px max-md:z-10 max-md:mt-0 max-md:block max-md:h-auto max-md:px-0"
    >
      <span
        data-testid="elapsed-time"
        className="text-right text-[11px] leading-none tabular-nums text-ink-4 max-md:hidden"
      >
        {formatDuration(displayTime * 1000)}
      </span>
      <ProgressSlider
        key={sliderKey}
        value={displayPercent}
        buffered={displayBuffered}
        onChange={onSeek}
        valueText={`${formatDuration(displayTime * 1000)} / ${formatDuration(durationMs)}`}
      />
      <TimeToggle
        className="text-left text-[11px] leading-none tabular-nums text-ink-4 hover:text-ink-2 max-md:hidden"
        showRemaining={showRemaining}
        label={
          showRemaining
            ? formatRemaining(durationMs - displayTime * 1000)
            : formatDuration(durationMs)
        }
      />
    </div>
  )
}

/** MV/video progress strip; subscribes to the video clock on its own. */
function VideoProgress() {
  const currentTime = useVideoPlaybackStore((state) => state.currentTime)
  const duration = useVideoPlaybackStore((state) => state.duration)
  const seek = useVideoPlaybackStore((state) => state.seek)
  return (
    <ImmersiveProgressBar
      value={duration ? Math.min(100, (currentTime / duration) * 100) : 0}
      durationMs={duration * 1000}
      onChange={(value) => {
        if (duration) seek((value / 100) * duration)
      }}
    />
  )
}
