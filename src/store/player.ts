import { create } from 'zustand'
import { msg } from '@lingui/core/macro'
import { persist } from 'zustand/middleware'
import {
  checkMusicAvailable,
  fetchIntelligenceList,
  fetchLyric,
  fetchMatchedSongUrl,
  fetchPersonalFm,
  fetchSongCopyrightRecommendation,
  fetchSongDetail,
  fetchSongUrlInfo,
} from '../api'
import { buildLyricLines, isEmptyLyric, type LyricLine } from '../lib/lyric'
import { copyrightHint } from '../lib/songs'
import { apiUrl } from '../lib/http'
import { getAudio } from '../lib/audio'
import {
  cacheSourceOf,
  getCachedAudio,
  getCachedAudioMeta,
  hasCachedAudio,
  removeCachedAudio,
} from '../lib/songCache'
import { cacheCoverImage } from '../lib/coverCache'
import {
  clearPrefetchedAudio,
  consumePrefetchedAudio,
  discardPrefetchedAudio,
  prefetchAudio,
  retainPrefetchedAudio,
} from '../lib/audioPrefetch'
import {
  getCachedLyricsPatch,
  saveCachedLyrics,
  type LyricsPatch,
} from '../lib/lyricsCache'
import { createCoalescedStorage } from '../lib/persistStorage'
import { toast } from '../lib/toast'
import { apiErrorMessage } from '../lib/apiErrors'
import { i18n } from '../i18n'
import { useSettingsStore } from './settings'
import { useLocalLibraryStore } from './localLibrary'
import { useVideoPlaybackStore } from './videoPlayback'
import { PLAY_MODE_CYCLE, PLAY_MODE_LABELS } from '../lib/playMode'
import type { Song } from '../types'

/** `order` stops after the last track; `loop` wraps around to the first. */
export type PlayMode = 'order' | 'loop' | 'random' | 'singleLoop'

interface PlayerState {
  queue: Song[]
  currentIndex: number
  /** Direction of the most recent queue step, used by the artwork slide. */
  lastStepDirection: 1 | -1
  playlistId: string
  playing: boolean
  mode: PlayMode
  volume: number
  currentTime: number
  /** Duration reported by the active media element, in milliseconds. */
  mediaDuration: number
  buffered: number
  playToken: number
  /** Forces the source effect to reload even when the signed URL is unchanged. */
  sourceReloadToken: number
  /** Preserve progress/play state while swapping original → vocals/accompaniment. */
  sourceTransition: 'none' | 'stem'
  audioReady: boolean
  audioUrl: string
  sourceReady: boolean
  /** True while playing a blob read from the offline cache (skip caching again). */
  audioFromCache: boolean
  /** Blob downloaded by the neighbour prefetch, reused when caching this track. */
  audioBlob: Blob | null
  loadRequestId: number
  showNowPlaying: boolean
  showQueue: boolean
  heartMode: boolean
  heartLoading: boolean
  lyricLines: LyricLine[]
  lyricLoading: boolean
  /** A manual "switch source" request is in flight. */
  switchingSource: boolean
  /** Position to restore after swapping the current track's source. */
  resumeAt: number | null
  initQueue: (songs: Song[], index: number, playlistId: string) => Promise<void>
  playAt: (index: number) => Promise<boolean>
  playSong: (song: Song) => Promise<void>
  /** Queue this song right after the current track (deduplicating/moving it). */
  playNext: (song: Song) => Promise<boolean>
  addToQueue: (songs: Song[]) => void
  /** Reorder one queue entry; the current track stays selected. */
  moveQueueItem: (from: number, to: number) => void
  togglePlay: () => Promise<void>
  /** `auto` is true only when the current track ended on its own. */
  next: (options?: { auto?: boolean }) => Promise<void>
  prev: () => Promise<void>
  setPlaying: (value: boolean) => void
  cycleMode: () => void
  toggleHeartMode: () => Promise<void>
  setVolume: (value: number) => void
  setCurrentTime: (value: number) => void
  setMediaDuration: (value: number) => void
  setBuffered: (value: number) => void
  setAudioReady: (value: boolean) => void
  toggleNowPlaying: (value?: boolean) => void
  toggleQueue: (value?: boolean) => void
  clearQueue: () => void
  refreshCurrentUrl: () => Promise<boolean>
  /** Fetch lyrics for the current track without starting playback. */
  ensureLyrics: () => Promise<void>
  /** Replace the current track with a matched provider source (manual picker). */
  switchToOtherSource: (source?: string, force?: boolean) => Promise<void>
  /** Play a cached copy of the current track from the given provider. */
  playCachedSource: (source: string) => Promise<void>
  /** Switch to NetEase's recommended other edition (`/song/copyright/rcmd`). */
  switchToRecommendedVersion: () => Promise<void>
  consumeResumeAt: () => void
  /**
   * The one seek entry point for every progress bar, the remote and media
   * keys. Seeks the media when it is loaded; otherwise (a restored session
   * not played yet, or metadata still loading) remembers the target as the
   * resume position, which loadAt / loadedmetadata apply. `defer` skips the
   * direct seek for callers that apply it themselves on loadedmetadata.
   */
  seekTo: (seconds: number, options?: { defer?: boolean }) => void
  prefetchNext: () => void
  invalidateUrls: () => void
  markSongLike: (id: number, like: boolean) => void
}

type SongSource = {
  url: string | null
  trialEnd: number | null
  /** The URL came from `/song/url/match` (third-party provider). */
  unblocked: boolean
  /** `/check/music` verdict: false means NetEase reports no copyright. */
  available: boolean
  /** Which provider module produced the matched URL. */
  matchedSource?: string
  /** Official playable edition recommended by `/song/copyright/rcmd`. */
  alternativeSongId?: number
  alternativeVersion?: boolean
  /** Fresh metadata of the recommended edition (duration, cover, artists). */
  alternativeSong?: Song
}

/**
 * Resolve a playable media URL. The official lookup runs first; only an
 * undecided gray track (`fee === 0` without a `noCopyrightRcmd` hint) asks
 * `/check/music`, and a copyright-less verdict falls back to the local
 * UnblockNeteaseMusic matcher.
 */
/**
 * A logged-in music VIP already has the right to the official VIP stream.
 * Resolve lazily to avoid the user/player store circular import at module load.
 */
async function hasVipPlaybackAccess(song: Song) {
  if (song.fee !== 1) return false
  try {
    const { useUserStore } = await import('./user')
    const { isLogin, profile } = useUserStore.getState()
    return isLogin && Number(profile?.vipType) > 0
  } catch {
    return false
  }
}

async function resolveSongSource(song: Song): Promise<SongSource> {
  const level = useSettingsStore.getState().playLevel
  const autoReplace = useSettingsStore.getState().autoReplaceVipSource
  const preferUnblock = useSettingsStore.getState().preferUnblockSource
  const preferredSource = useSettingsStore.getState().preferredSource
  const requestedSource = preferredSource === 'auto' ? undefined : preferredSource
  const vipAccess = await hasVipPlaybackAccess(song)

  // Cache the match attempt so a VIP-first lookup and a trial fallback don't
  // request the same matcher twice in one resolution.
  // NetEase's own recommendation reuses the same catalogue/edition and usually
  // keeps lyrics and timing sane, so it is the fallback order by default and
  // the preferred one when `preferUnblockSource` is off.
  let alternativePromise: Promise<SongSource | null> | null = null
  const getAlternative = () => {
    if (!alternativePromise) {
      alternativePromise = (async () => {
        try {
          const recommendation = await fetchSongCopyrightRecommendation(song.id)
          if (!recommendation || recommendation.id === song.id) return null
          // A new song id means a different duration/cover/lyric timeline. Pull
          // fresh metadata instead of reusing the grey track's fields.
          const detail =
            (await fetchSongDetail(recommendation.id).catch(() => null)) ??
            recommendation
          const info = await fetchSongUrlInfo(detail.id, level)
          if (!info.url) return null
          return {
            url: info.url,
            trialEnd: info.trialEnd,
            unblocked: false,
            available: true,
            matchedSource: 'copyright-rcmd',
            alternativeSongId: detail.id,
            alternativeVersion: true,
            alternativeSong: detail,
          } satisfies SongSource
        } catch {
          return null
        }
      })()
    }
    return alternativePromise
  }

  let matchedPromise: Promise<{ url: string; source: string }> | null = null
  const getMatched = () => {
    if (!matchedPromise) {
      matchedPromise = fetchMatchedSongUrl(song.id, requestedSource)
        .then((matched) => ({ url: matched.url, source: matched.source }))
        .catch(() => ({ url: '', source: '' }))
    }
    return matchedPromise
  }
  const matchedSource = async (): Promise<SongSource | null> => {
    const matched = await getMatched()
    return matched.url
      ? {
          url: matched.url,
          trialEnd: null,
          unblocked: true,
          available: true,
          matchedSource: matched.source || requestedSource,
        }
      : null
  }
  /**
   * Automatic replacement, honouring the user's endpoint order: the matcher
   * first by default (`preferUnblockSource`, on out of the box) and the
   * official "other playable edition" as its fallback; turning the switch off
   * restores the recommendation-first order.
   */
  const autoMatchedSource = async (): Promise<SongSource | null> => {
    if (!autoReplace) return null
    if (preferUnblock) {
      const matched = await matchedSource()
      if (matched) return matched
      return getAlternative()
    }
    const alternative = await getAlternative()
    if (alternative) return alternative
    return matchedSource()
  }

  // Only true VIP tracks get the matcher before the official lookup. `fee`
  // is a bitmask, not a boolean: common free/low-quality tracks use fee=8
  // and already have a normal CDN URL, so treating every non-zero fee as VIP
  // made `/song/url/match` run for songs that did not need it.
  if (!vipAccess && song.fee === 1 && autoReplace) {
    const matched = await autoMatchedSource()
    if (matched) return matched
  }

  let urlError: unknown = null
  try {
    const info = await fetchSongUrlInfo(song.id, level)
    if (info.url) {
      // A 30-second trial is still "a URL", but the user asked to replace
      // VIP/trial playback whenever possible. Try the matcher before returning
      // the trial so the official endpoint isn't the only request made.
      if (!vipAccess && autoReplace && info.trialEnd && info.trialEnd > 0) {
        const matched = await autoMatchedSource()
        if (matched) return matched
      }
      return { ...info, unblocked: false, available: true }
    }
  } catch (error) {
    // Gray tracks often fail outright; normal tracks surface the error below.
    urlError = error
  }

  // No official URL at all. Automatic matching (when enabled) applies the
  // user's endpoint order; the official recommended edition is still tried
  // when it is off, because only `/song/url/match` is gated by that setting.
  if (!vipAccess && autoReplace) {
    const matched = await autoMatchedSource()
    if (matched) return matched
  }

  const alternative = await getAlternative()
  if (alternative) return alternative

  const hint = copyrightHint(song)
  if (!hint) {
    // Normal tracks have no verdict to ask for.
    if (song.fee !== 0) {
      if (urlError) throw urlError
      return { url: null, trialEnd: null, unblocked: false, available: true }
    }
    // A failed check is "unknown", not "no copyright".
    const available = await checkMusicAvailable(song.id).catch(() => true)
    if (available) return { url: null, trialEnd: null, unblocked: false, available: true }
  }

  // A VIP user must never fall back to the gray-track matcher.
  if (vipAccess) {
    if (urlError) throw urlError
    return { url: null, trialEnd: null, unblocked: false, available: true }
  }

  // Reuse the cached matcher attempt. When auto matching was already enabled
  // this is a failed result, so we don't hit the provider twice.
  const fallback = await getMatched()
  if (fallback.url) {
    return {
      url: fallback.url,
      trialEnd: null,
      unblocked: true,
      available: false,
      matchedSource: fallback.source || requestedSource,
    }
  }
  return { url: null, trialEnd: null, unblocked: false, available: false }
}

/** Songs already announced as matched to another provider (one toast each). */
const unblockAnnounced = new Set<number>()

/**
 * A playlist full of gray/VIP tracks would otherwise show one toast per track.
 * Keep the notice to the first match of a window; the player bar's source
 * picker already says which provider is playing for the rest.
 */
const MATCH_NOTICE_COOLDOWN = 60_000
let matchedNoticeAt = 0

/** Show the "matched another source" notice unless it was just shown. */
function announceMatch(show: () => void) {
  const now = Date.now()
  if (now - matchedNoticeAt < MATCH_NOTICE_COOLDOWN) return
  matchedNoticeAt = now
  show()
}

/**
 * `/audio/proxy` only accepts NetEase CDN hosts (enforced in server/server.js),
 * so third-party matches are streamed directly by the audio element.
 */
const NETEASE_MEDIA = /^https?:\/\/[^/]*music\.126\.net\//

/** Deduplicate lyric loads between the current track and neighbour prefetch. */
const lyricsRequests = new Map<number, Promise<LyricsPatch | null>>()

async function loadLyricsPatch(songId: number): Promise<LyricsPatch | null> {
  const cached = await getCachedLyricsPatch(songId)
  if (cached) return cached
  const running = lyricsRequests.get(songId)
  if (running) return running

  const task = fetchLyric(songId)
    .then((data) => {
      const patch: LyricsPatch = {
        lyric: data.lyric,
        tlyric: data.tlyric,
        yrc: data.yrc,
        isNotLyric: isEmptyLyric(data.lyric) && !data.yrc,
      }
      // Save as soon as the response arrives, not only when the track starts.
      void saveCachedLyrics(songId, patch)
      return patch
    })
    .catch(() => null)
    .finally(() => {
      lyricsRequests.delete(songId)
    })
  lyricsRequests.set(songId, task)
  return task
}

function playbackUrl(url: string, unblocked: boolean) {
  return unblocked && !NETEASE_MEDIA.test(url) ? url : apiUrl('/audio/proxy', { url })
}

/**
 * The `copyright-rcmd` path merges another edition's name/cover/duration into
 * the queue item. Switching away has to undo that, otherwise the player keeps
 * showing the cover version's title while a different audio plays.
 */
async function originalSongFields(id: number): Promise<Partial<Song> | null> {
  try {
    const detail = await fetchSongDetail(id)
    if (!detail) return null
    return {
      name: detail.name,
      ar: detail.ar,
      al: detail.al,
      dt: detail.dt,
      fee: detail.fee,
      alia: detail.alia,
      tns: detail.tns,
    }
  } catch {
    return null
  }
}

async function enrichSong(song: Song): Promise<Song> {
  const source = await resolveSongSource(song)
  if (!source.url) {
    throw new Error(
      source.available
        ? i18n._(msg`获取歌曲播放地址失败`)
        : i18n._(msg`亲爱的，暂无版权，已为你跳过`),
    )
  }
  // Downloaded/streamed audio may come from the recommended edition. Prefer
  // its lyrics/timing, but fall back to the original when it has none.
  // This also runs on URL recovery (stall / media error / seek after restore):
  // a lyric failure must never turn into "track unavailable", and lyrics that
  // are already known for the same timeline are reused instead of re-fetched.
  const lyricSongId = source.alternativeSongId ?? song.id
  const knownLyricSongId = song.alternativeSongId ?? song.id
  const hasKnownLyrics = Boolean(song.lyric || song.yrc || song.isNotLyric)
  let lyricPatch: LyricsPatch | null =
    hasKnownLyrics && lyricSongId === knownLyricSongId
      ? null
      : await loadLyricsPatch(lyricSongId)
  if (
    lyricPatch?.isNotLyric &&
    source.alternativeSongId &&
    source.alternativeSongId !== song.id
  ) {
    lyricPatch = (await loadLyricsPatch(song.id)) ?? lyricPatch
  }
  if (lyricPatch && !lyricPatch.isNotLyric && !buildLyricLines(lyricPatch).length) {
    lyricPatch = { ...lyricPatch, isNotLyric: true }
  }
  // Leaving a previously recommended edition: put the track's own title,
  // artists and cover back instead of keeping the other edition's metadata.
  const restoredFields =
    !source.alternativeSong && song.alternativeSongId
      ? await originalSongFields(song.id)
      : null
  const effectiveSong = source.alternativeSong
    ? { ...song, ...source.alternativeSong, id: song.id }
    : restoredFields
      ? { ...song, ...restoredFields, id: song.id }
      : song
  return {
    ...effectiveSong,
    url: source.url,
    unblocked: source.unblocked,
    matchedSource: source.matchedSource,
    alternativeSongId: source.alternativeSongId,
    alternativeVersion: source.alternativeVersion,
    urlFetchedAt: Date.now(),
    trialEnd: source.trialEnd,
    // null = keep the lyrics already on the song (reused or failed to load).
    ...(lyricPatch ?? {}),
  }
}

function readLyrics(song?: Song) {
  if (!song) return []
  if (song.lyric || song.yrc) {
    return buildLyricLines({
      lyric: song.lyric,
      tlyric: song.tlyric,
      yrc: song.yrc,
    })
  }
  return []
}

// NetEase media URLs expire after roughly 20 minutes; treat anything older
// than this as stale and resolve it again before playback.
const URL_TTL = 10 * 60 * 1000
// Give the current track a head start before downloading the next one.
const AUDIO_PREFETCH_DELAY = 1800

let prefetchTimer: number | undefined
let prefetchToken = 0
/**
 * Random mode uses a pre-shuffled permutation plus a cursor. The order stays
 * fixed for the current queue, so next/previous walk the same sequence instead
 * of independently rolling two random tracks. The cursor is rebuilt when the
 * queue changes or when the user jumps to an explicit song.
 */
let shuffleOrder: number[] = []
let shuffleCursor = -1
let shuffleKey = ''
// Explicit "Play next" must win over the shuffled target.
let forcedNextSongId: number | null = null

const shuffleQueueKey = (queue: Song[]) =>
  queue.map((song) => song?.id ?? 0).join(',')

function shuffleArray(values: number[]) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[values[i], values[j]] = [values[j], values[i]]
  }
}

function ensureShuffleOrder(queue: Song[], currentIndex: number) {
  const key = shuffleQueueKey(queue)
  if (key !== shuffleKey || shuffleOrder.length !== queue.length) {
    shuffleKey = key
    shuffleOrder = queue.map((_, index) => index)
    shuffleArray(shuffleOrder)
    shuffleCursor = Math.max(0, shuffleOrder.indexOf(currentIndex))
    return
  }
  if (shuffleOrder[shuffleCursor] !== currentIndex) {
    const position = shuffleOrder.indexOf(currentIndex)
    if (position >= 0) shuffleCursor = position
  }
}

/** Peek without moving the cursor, used by neighbour prefetch. */
function peekShuffled(queue: Song[], currentIndex: number, direction: 1 | -1) {
  ensureShuffleOrder(queue, currentIndex)
  if (shuffleOrder.length <= 1) return null
  if (direction === 1) return shuffleOrder[shuffleCursor + 1] ?? null
  return shuffleOrder[shuffleCursor - 1] ?? null
}

/** Advance the cursor for a real next/previous action. */
function stepShuffled(queue: Song[], currentIndex: number, direction: 1 | -1) {
  ensureShuffleOrder(queue, currentIndex)
  const length = shuffleOrder.length
  if (length <= 1) return null

  if (direction === 1) {
    if (shuffleCursor + 1 < length) {
      shuffleCursor += 1
      return shuffleOrder[shuffleCursor]
    }
    // Start a new cycle: keep the current song as the boundary so pressing
    // previous from the new cycle returns to where the user came from.
    const rest = Array.from({ length }, (_, index) => index).filter(
      (index) => index !== currentIndex,
    )
    shuffleArray(rest)
    shuffleOrder = [currentIndex, ...rest]
    shuffleCursor = 1
    return shuffleOrder[1] ?? null
  }

  if (shuffleCursor > 0) {
    shuffleCursor -= 1
    return shuffleOrder[shuffleCursor]
  }
  // At the very beginning there is no previous track in this permutation.
  const candidates = shuffleOrder.filter((index) => index !== currentIndex)
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null
}
const urlRequests = new Map<number, Promise<SongSource>>()

/**
 * VIP/free-trial audio may already be cached from before the user enabled
 * source matching. That cached blob can be a 30s preview or an official URL
 * from a provider the user no longer prefers, so re-resolve instead of using it.
 */
async function shouldBypassAudioCache(song: Song) {
  if (!useSettingsStore.getState().autoReplaceVipSource) return false
  // The current source is a preview: resolve it again and replace the cache.
  if ((song.trialEnd ?? 0) > 0) return true
  if (song.fee !== 1) return false

  // Do not discard every VIP cache just because matching is enabled. Only a
  // cached 30s preview (or a legacy entry without trial metadata) is stale;
  // a full matched track must be reused or it is re-resolved on every play.
  const meta = await getCachedAudioMeta(song.id, cacheSourceOf(song))
  return Boolean(meta && (meta.trialEnd === undefined || meta.trialEnd > 0))
}

function hasFreshUrl(song: Song) {
  const settings = useSettingsStore.getState()
  // A cached trial URL must not bypass auto matching after the user enables it;
  // otherwise an already-played song keeps using the 30s preview for 10 min.
  if (
    settings.autoReplaceVipSource &&
    !song.unblocked &&
    (song.trialEnd ?? 0) > 0
  ) {
    return false
  }
  // A different explicit provider was selected: don't reuse the URL produced by
  // the previous provider.
  if (
    settings.autoReplaceVipSource &&
    song.unblocked &&
    settings.preferredSource !== 'auto' &&
    song.matchedSource &&
    song.matchedSource !== settings.preferredSource
  ) {
    return false
  }
  return Boolean(
    song.url &&
      song.urlFetchedAt &&
      Date.now() - song.urlFetchedAt < URL_TTL,
  )
}

type PersistedPlayerState = Pick<
  PlayerState,
  'queue' | 'currentIndex' | 'playlistId' | 'mode' | 'volume'
>

const MAX_PERSISTED_QUEUE = 1000

/* ------------------------- remembered playback position ------------------------ */

/** Kept apart from the persisted queue: it changes every second. */
const POSITION_KEY = 'react-music-player-position'
const POSITION_SAVE_INTERVAL = 5_000

function readSavedPosition() {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { songId?: unknown; time?: unknown }
    const songId = Number(parsed.songId)
    const time = Number(parsed.time)
    if (!Number.isSafeInteger(songId) || songId <= 0) return null
    if (!Number.isFinite(time) || time < 3) return null
    return { songId, time }
  } catch {
    return null
  }
}

/** Where the current track was when the app closed; used by the first play. */
let restoredPosition = readSavedPosition()

function peekRestoredPosition(song: Song | undefined) {
  const restored = restoredPosition
  if (!song || !restored || restored.songId !== song.id) return null
  // Resuming in the last seconds would only replay the ending.
  if (song.dt && restored.time > song.dt / 1000 - 5) return null
  return restored.time
}

function takeRestoredPosition(song: Song | undefined) {
  const time = peekRestoredPosition(song)
  restoredPosition = null
  return time
}

let persistedWindow: {
  source: Song[]
  index: number
  queue: Song[]
  offset: number
} | null = null

/** Persisted songs keep only what restore needs; lyrics and media URLs are re-fetched. */
function persistQueue(queue: Song[], currentIndex: number) {
  const cached = persistedWindow
  if (cached && cached.source === queue && cached.index === currentIndex) {
    return cached
  }
  const size = Math.min(queue.length, MAX_PERSISTED_QUEUE)
  const offset =
    queue.length > MAX_PERSISTED_QUEUE
      ? Math.min(
          Math.max(0, currentIndex - Math.floor(MAX_PERSISTED_QUEUE / 2)),
          queue.length - MAX_PERSISTED_QUEUE,
        )
      : 0
  const compacted: Song[] = queue.slice(offset, offset + size).map((song) => ({
    id: song.id,
    name: song.name,
    ar: song.ar,
    al: song.al,
    dt: song.dt,
    fee: song.fee,
    noCopyrightRcmd: song.noCopyrightRcmd,
    mv: song.mv,
    mvid: song.mvid,
    alia: song.alia,
    tns: song.tns,
    like: song.like,
    // Keep the provider the track was left on. Without it a restart resolves
    // again from scratch and may quietly pick another edition than the one the
    // user chose (and already has cached).
    matchedSource: song.matchedSource,
    alternativeSongId: song.alternativeSongId,
    alternativeVersion: song.alternativeVersion,
  }))
  persistedWindow = { source: queue, index: currentIndex, queue: compacted, offset }
  return persistedWindow
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      const patchSong = (index: number, patch: Partial<Song>) => {
        set((state) => ({
          queue: state.queue.map((song, i) => (i === index ? { ...song, ...patch } : song)),
        }))
      }

      const requestNeighborUrl = (song: Song) => {
        const pendingRequest = urlRequests.get(song.id)
        if (pendingRequest) return pendingRequest
        const request = resolveSongSource(song).finally(() => {
          urlRequests.delete(song.id)
        })
        urlRequests.set(song.id, request)
        return request
      }

      // Resolve the next track's URL right away and download its audio once
      // the current track is ready, so the next transition can start from a
      // local blob.
      const prefetchNeighbors = (index: number, delay = AUDIO_PREFETCH_DELAY) => {
        const { queue, mode } = get()
        const token = prefetchToken + 1
        prefetchToken = token
        if (prefetchTimer !== undefined) {
          window.clearTimeout(prefetchTimer)
          prefetchTimer = undefined
        }

        const findNeighbor = (candidateIndex: number) => {
          if (candidateIndex === index) return null
          const candidate = queue[candidateIndex]
          return candidate ? { index: candidateIndex, song: candidate } : null
        }

        // Prefetch both directions. In order/single-loop mode the adjacent
        // indices are deterministic. Random mode picks the same two indices it
        // will use for the next/previous action, so playback can actually
        // consume the prefetched blob instead of choosing another random track
        // that was never downloaded.
        let neighbors: Array<{ index: number; song: Song }>
        if (mode === 'random' && queue.length > 1) {
          const candidates = queue
            .map((song, candidateIndex) => (song && candidateIndex !== index ? candidateIndex : -1))
            .filter((candidateIndex) => candidateIndex >= 0)
          const pick = (exclude: number[] = []) => {
            const available = candidates.filter(
              (candidateIndex) => !exclude.includes(candidateIndex),
            )
            return available[Math.floor(Math.random() * available.length)] ?? null
          }
          const forcedIndex =
            forcedNextSongId === null
              ? -1
              : queue.findIndex((song) => song.id === forcedNextSongId)
          const nextIndex =
            forcedIndex >= 0 && forcedIndex !== index
              ? forcedIndex
              : (peekShuffled(queue, index, 1) ?? pick())
          const previousIndex =
            peekShuffled(queue, index, -1) ??
            pick(nextIndex === null ? [] : [nextIndex])
          neighbors = [nextIndex, previousIndex]
            .filter((candidateIndex): candidateIndex is number => candidateIndex !== null)
            .map((candidateIndex) => findNeighbor(candidateIndex))
            .filter((entry): entry is { index: number; song: Song } => Boolean(entry))
        } else {
          const nextIndex = (index + 1) % queue.length
          const previousIndex = (index - 1 + queue.length) % queue.length
          neighbors = [findNeighbor(nextIndex), findNeighbor(previousIndex)].filter(
            (entry): entry is { index: number; song: Song } => Boolean(entry),
          )
        }
        const uniqueNeighbors = Array.from(
          new Map(neighbors.map((entry) => [entry.song.id, entry])).values(),
        )

        // Both reachable neighbours may keep their prefetched audio.
        retainPrefetchedAudio(uniqueNeighbors.map((entry) => entry.song.id))
        if (!uniqueNeighbors.length) return

        // Lyrics are tiny compared with audio; fetch both neighbours now and
        // patch the queue so switching does not show the lyric spinner. The
        // helper checks IndexedDB first, so a previously heard track is instant.
        for (const { index: neighborIndex, song } of uniqueNeighbors) {
          if (song.lyric || song.yrc || song.isNotLyric) continue
          void loadLyricsPatch(song.id).then((patch) => {
            if (!patch) return
            const active = get().queue[neighborIndex]
            if (!active || active.id !== song.id) return
            patchSong(neighborIndex, patch)
          })
        }

        const resolves = uniqueNeighbors.map(async ({ index: neighborIndex, song }) => {
          const bypassAudioCache = await shouldBypassAudioCache(song)
          if (bypassAudioCache) {
            void removeCachedAudio(song.id, cacheSourceOf(song))
          }
          if (!bypassAudioCache && (await hasCachedAudio(song.id, cacheSourceOf(song)))) {
            return null
          }
          let url = hasFreshUrl(song) ? (song.url ?? null) : null
          let trialEnd = song.trialEnd ?? null
          let unblocked = Boolean(song.unblocked)
          if (!url) {
            try {
              const info = await requestNeighborUrl(song)
              url = info.url
              trialEnd = info.trialEnd
              unblocked = info.unblocked
              if (!url) return null
              const active = get().queue[neighborIndex]
              if (!active || active.id !== song.id) return null
              patchSong(neighborIndex, {
                url,
                urlFetchedAt: Date.now(),
                trialEnd,
                unblocked,
                matchedSource: info.matchedSource,
              })
            } catch {
              return null
            }
          }
          return { songId: song.id, url, trialEnd, unblocked }
        })

        void Promise.all(resolves).then((results) => {
          if (token !== prefetchToken || get().currentIndex !== index) return
          const start = () => {
            if (token !== prefetchToken || get().currentIndex !== index) return
            for (const result of results) {
              // Matched third-party URLs are allow-listed by the API, so the
              // proxy can download them just like NetEase's own CDN.
              if (!result) continue
              void prefetchAudio(result.songId, result.url, result.trialEnd)
            }
          }
          if (delay <= 0) {
            start()
            return
          }
          prefetchTimer = window.setTimeout(start, delay)
        })
      }

      const resolveLyrics = async (index: number, song: Song, requestId: number) => {
        // Recommended editions have their own duration and lyric timeline.
        const lyricsSongId = song.alternativeSongId ?? song.id
        if (song.lyric || song.yrc || song.isNotLyric) {
          void saveCachedLyrics(lyricsSongId, {
            lyric: song.lyric ?? '',
            tlyric: song.tlyric ?? '',
            yrc: song.yrc ?? '',
            isNotLyric: Boolean(song.isNotLyric),
          })
          set({ lyricLines: readLyrics(song), lyricLoading: false })
          return
        }
        try {
          // Neighbour prefetch may already have filled the queue, or the
          // persistent cache may have lyrics from an earlier session.
          const patch = await loadLyricsPatch(lyricsSongId)
          if (get().loadRequestId !== requestId) return
          if (!patch) {
            set({ lyricLoading: false })
            return
          }
          patchSong(index, patch)
          set({ lyricLines: readLyrics({ ...song, ...patch }), lyricLoading: false })
        } catch {
          if (get().loadRequestId === requestId) set({ lyricLoading: false })
        }
      }

      /**
       * Play a cached copy of the current track for one provider. Used by the
       * source menu, so returning to a provider that was played before works
       * offline and keeps that edition's own lyrics.
       */
      const applyCachedVariant = async (song: Song, source: string) => {
        const blob = await getCachedAudio(song.id, source)
        if (!blob) return false
        const meta = await getCachedAudioMeta(song.id, source)
        const active = get()
        const index = active.currentIndex
        if (active.queue[index]?.id !== song.id) return false
        const isRcmd = source === 'copyright-rcmd'
        const requestId = active.loadRequestId + 1
        let editionId = isRcmd ? meta?.lyricSongId : undefined
        // Cached before lyric ids were stored: ask for the recommendation again
        // so the edition still gets its own title and cover.
        if (isRcmd && !editionId) {
          try {
            const rcmd = await fetchSongCopyrightRecommendation(song.id)
            editionId = rcmd?.id
          } catch {
            // Offline: fall back to whatever the cache recorded.
          }
        }
        // Switching to the recommended edition shows that edition's own
        // title/cover; switching away restores this track's metadata.
        const restored = isRcmd
          ? editionId && editionId !== song.id
            ? await originalSongFields(editionId)
            : meta?.name
              ? { name: meta.name }
              : null
          : await originalSongFields(song.id)
        const patch: Partial<Song> = {
          ...(restored ?? {}),
          // The blob is the media now; there is no signed URL to keep.
          url: '',
          urlFetchedAt: 0,
          unblocked: !isRcmd,
          matchedSource: source,
          trialEnd: null,
          // Only the recommended edition needs a foreign lyric timeline.
          alternativeSongId: isRcmd ? editionId : undefined,
          alternativeVersion: isRcmd,
          lyric: '',
          tlyric: '',
          yrc: '',
          isNotLyric: false,
        }
        patchSong(index, patch)
        set({
          loadRequestId: requestId,
          audioUrl: URL.createObjectURL(blob),
          sourceReady: true,
          audioFromCache: true,
          audioBlob: null,
          sourceTransition: 'none',
          resumeAt: active.currentTime,
          lyricLoading: true,
          lyricLines: [],
          playToken: active.playToken + 1,
        })
        await resolveLyrics(index, { ...song, ...patch }, requestId)
        return true
      }

      // Reason of the last failed load, for merged "skipped N tracks" notices.
      let lastLoadError = ''

      const loadAt = async (
        index: number,
        options: {
          /** The caller reports failures itself (skipping through the queue). */
          silent?: boolean
          /** Position to start at once the media is seekable. */
          resumeAt?: number | null
        } = {},
      ) => {
        // Any explicit load supersedes the position restored at launch.
        restoredPosition = null
        const state = get()
        const song = state.queue[index]
        if (!song) return false
        // Keep artwork available even when the track itself is played from the
        // local audio cache or when the network drops later.
        void cacheCoverImage(song.al?.picUrl, song.id)
        const requestId = state.loadRequestId + 1
        // Neighbour prefetch normally has already filled these fields. Hydrate
        // them synchronously so switching to a known track never flashes the
        // lyric loading state.
        const hasKnownLyrics = Boolean(
          song.lyric || song.yrc || song.isNotLyric,
        )
        // Clear stale lyrics/source so a different song never shows the
        // previous track's data while its own source is still resolving.
        set({
          loadRequestId: requestId,
          lyricLoading: !hasKnownLyrics,
          lyricLines: hasKnownLyrics ? readLyrics(song) : [],
          audioUrl: '',
          sourceReady: false,
          sourceTransition: 'none',
          audioFromCache: false,
          audioBlob: null,
          resumeAt: options.resumeAt ?? null,
        })
        try {
          // Prefer audio cached in IndexedDB (WebCodecs-transcoded Opus), except
          // for VIP/trial tracks when source matching is enabled: those caches
          // may be the old 30s preview and must be refreshed.
          const bypassAudioCache = await shouldBypassAudioCache(song)
          if (bypassAudioCache) {
            void removeCachedAudio(song.id, cacheSourceOf(song))
          }
          const cached = bypassAudioCache
            ? null
            : await getCachedAudio(song.id, cacheSourceOf(song))
          if (get().loadRequestId !== requestId) return true

          if (cached) {
            const url = URL.createObjectURL(cached)
            if (get().loadRequestId !== requestId) {
              URL.revokeObjectURL(url)
              return true
            }
            set({ audioUrl: url, sourceReady: true, audioFromCache: true })
            void useLocalLibraryStore.getState().recordRecent(song)
            prefetchNeighbors(index)
            await resolveLyrics(index, song, requestId)
            return true
          }

          // A neighbour preload is already a local Blob: play it immediately,
          // unless it is the stale preview we are trying to replace.
          if (bypassAudioCache) discardPrefetchedAudio(song.id)
          const prefetched = bypassAudioCache
            ? null
            : consumePrefetchedAudio(song.id)
          if (prefetched) {
            set({ audioUrl: prefetched.url, sourceReady: true, audioBlob: prefetched.blob })
            void useLocalLibraryStore.getState().recordRecent(song)
            if (prefetched.trialEnd && prefetched.trialEnd > 0) {
              toast.warning(
                i18n._(
                  msg`当前仅可试听 ${prefetched.trialEnd} 秒，登录或开通会员后可播放完整版`,
                ),
              )
            }
            prefetchNeighbors(index)
            await resolveLyrics(index, song, requestId)
            return true
          }

          // Prefetched (and still fresh) URLs are used directly; otherwise
          // resolve a new one because NetEase media URLs expire.
          const fresh = hasFreshUrl(song)
          let url: string | null = fresh ? (song.url ?? null) : null
          let trialEnd: number | null = fresh ? (song.trialEnd ?? null) : null
          let unblocked = fresh ? Boolean(song.unblocked) : false
          let matchedSource = fresh ? song.matchedSource : undefined
          let alternativeSongId = fresh ? song.alternativeSongId : undefined
          let alternativeVersion = fresh ? song.alternativeVersion : undefined
          let available = true
          let effectiveSong = song
          if (!url) {
            const source = await resolveSongSource(song)
            if (get().loadRequestId !== requestId) return true
            url = source.url
            trialEnd = source.trialEnd
            unblocked = source.unblocked
            matchedSource = source.matchedSource
            alternativeSongId = source.alternativeSongId
            alternativeVersion = source.alternativeVersion
            available = source.available
            const alternativePatch = source.alternativeSong
              ? {
                  ...source.alternativeSong,
                  // Keep the queue identity, but replace duration/cover/artists
                  // with the edition that is actually being streamed.
                  id: song.id,
                  url: '',
                  urlFetchedAt: 0,
                  lyric: '',
                  tlyric: '',
                  yrc: '',
                  isNotLyric: false,
                }
              : null
            // Coming back from a recommended edition: restore this track's
            // own title, artists and cover.
            const restoredFields =
              !alternativePatch && song.alternativeSongId
                ? await originalSongFields(song.id)
                : null
            if (alternativePatch) {
              effectiveSong = {
                ...song,
                ...alternativePatch,
                alternativeSongId,
                alternativeVersion,
              }
            } else if (restoredFields) {
              effectiveSong = { ...song, ...restoredFields, id: song.id }
            }
            if (url) {
              patchSong(index, {
                ...(alternativePatch ?? restoredFields ?? {}),
                url,
                urlFetchedAt: Date.now(),
                trialEnd,
                unblocked,
                matchedSource,
                alternativeSongId,
                alternativeVersion,
              })
            }
          }
          // A prefetched neighbour can still carry the recommended edition's
          // metadata while the URL now belongs to another provider.
          if (
            fresh &&
            url &&
            song.alternativeSongId &&
            matchedSource !== 'copyright-rcmd'
          ) {
            const restored = await originalSongFields(song.id)
            if (restored) {
              const resetLyrics: Partial<Song> = {
                lyric: '',
                tlyric: '',
                yrc: '',
                isNotLyric: false,
              }
              effectiveSong = {
                ...effectiveSong,
                ...restored,
                ...resetLyrics,
                alternativeSongId: undefined,
                alternativeVersion: false,
                id: song.id,
              }
              patchSong(index, {
                ...restored,
                ...resetLyrics,
                alternativeSongId: undefined,
                alternativeVersion: false,
              })
            }
          }
          if (!url) {
            throw new Error(
              available
                ? i18n._(msg`获取歌曲播放地址失败`)
                : i18n._(msg`亲爱的，暂无版权，已为你跳过`),
            )
          }
          // Announce once per song, even when the URL was patched earlier by a
          // prefetch or a retry (those paths never showed the notice).
          if (unblocked && !unblockAnnounced.has(song.id)) {
            unblockAnnounced.add(song.id)
            // Video mode has no audible audio source, so the source-match
            // notice would be noise over the MV. Keep it for audio playback.
            if (!useVideoPlaybackStore.getState().active) {
              announceMatch(() =>
                toast.info(
                  effectiveSong.fee === 0
                    ? i18n._(msg`「${effectiveSong.name}」暂无官方音源，已为你匹配其他音源播放`)
                    : i18n._(msg`「${effectiveSong.name}」VIP 歌曲已为你匹配其他音源播放`),
                ),
              )
            }
          } else if (alternativeVersion && !unblockAnnounced.has(song.id)) {
            unblockAnnounced.add(song.id)
            if (!useVideoPlaybackStore.getState().active) {
              announceMatch(() =>
                toast.info(
                  i18n._(msg`「${effectiveSong.name}」已为你切换到其他可播放版本`),
                ),
              )
            }
          }
          // Stream through the local API: the WebView cannot load the CDN
          // media URL directly (it answers 403 for cross-origin media).
          set({ audioUrl: playbackUrl(url, unblocked), sourceReady: true })
          void useLocalLibraryStore.getState().recordRecent(effectiveSong)
          if (trialEnd && trialEnd > 0) {
            toast.warning(
              i18n._(msg`当前仅可试听 ${trialEnd} 秒，登录或开通会员后可播放完整版`),
            )
          }
          prefetchNeighbors(index)
          await resolveLyrics(index, effectiveSong, requestId)
          return true
        } catch (error) {
          if (get().loadRequestId !== requestId) return true
          set({
            lyricLoading: false,
            playing: false,
            audioUrl: '',
            sourceReady: false,
            audioFromCache: false,
            audioBlob: null,
          })
          const message = apiErrorMessage(error, i18n._(msg`歌曲加载失败`))
          if (options.silent) lastLoadError = message
          else toast.warning(message)
          return false
        }
      }

      const appendHeartSongs = async () => {
        const state = get()
        const song = state.queue[state.currentIndex]
        if (!state.heartMode || !song || state.heartLoading) return false
        set({ heartLoading: true })
        try {
          let recommendations: Song[] = []
          let heartError: unknown = null
          if (/^\d+$/.test(state.playlistId)) {
            try {
              recommendations = await fetchIntelligenceList({
                id: song.id,
                pid: state.playlistId,
                sid: song.id,
                count: 10,
              })
            } catch (error) {
              heartError = error
            }
          }
          if (!recommendations.length) {
            try {
              recommendations = await fetchPersonalFm(10)
            } catch {
              throw heartError ?? new Error(i18n._(msg`智能播放暂不可用，请先登录`))
            }
          }
          if (!get().heartMode) return false
          const queue = get().queue
          const existing = new Set(queue.map((item) => item.id))
          const additions = recommendations.filter((item) => !existing.has(item.id))
          if (!additions.length) return false
          const insertIndex = Math.min(get().currentIndex + 1, queue.length)
          const nextQueue = [...queue]
          nextQueue.splice(insertIndex, 0, ...additions)
          set({ queue: nextQueue })
          return true
        } catch (error) {
          toast.warning(
            apiErrorMessage(
              error,
              i18n._(msg`心动模式暂不可用，请先登录`),
            ),
          )
          return false
        } finally {
          set({ heartLoading: false })
        }
      }

      const maybeRefillHeart = () => {
        const state = get()
        if (!state.heartMode) return
        if (state.queue.length - 1 - state.currentIndex < 3) void appendHeartSongs()
      }

      /** One notice for a whole skip run instead of one toast per broken track. */
      const reportSkipped = (skipped: number, played: boolean) => {
        if (!skipped) return
        if (skipped === 1) {
          // Keep the specific reason (e.g. no copyright) for a single skip.
          toast.warning(lastLoadError || i18n._(msg`歌曲加载失败`))
          return
        }
        toast.warning(
          played
            ? i18n._(msg`已跳过 ${skipped} 首无法播放的歌曲`)
            : i18n._(msg`连续 ${skipped} 首歌曲无法播放，已停止播放`),
        )
      }

      const step = async (direction: 1 | -1, auto = false) => {
        const { queue, currentIndex, mode } = get()
        if (!queue.length) return
        // 顺序播放 stops after the last track when playback advances on its own
        // (natural end or an error-recovery skip). Manual next/previous still
        // wrap. Heart mode keeps refilling the queue, so it never "ends".
        const stopAtEnd = auto && mode === 'order' && !get().heartMode
        if (stopAtEnd && direction === 1 && currentIndex >= queue.length - 1) {
          // PlayerBar also asks for the next track ~0.4s before the end to
          // overlap the crossfade; let the last track finish in that case.
          const audio = getAudio()
          if (!audio || audio.ended || audio.error) set({ playing: false })
          return
        }
        let skipped = 0
        if (mode === 'random' && queue.length > 1) {
          const candidates = queue
            .map((song, index) => (song ? index : -1))
            .filter((index) => index >= 0 && index !== currentIndex)
          if (!candidates.length) {
            set({ playing: false })
            return
          }
          const forcedIndex =
            direction === 1 && forcedNextSongId !== null
              ? queue.findIndex((item) => item.id === forcedNextSongId)
              : -1
          const shuffledIndex =
            forcedIndex >= 0
              ? forcedIndex
              : stepShuffled(queue, currentIndex, direction)
          const nextIndex =
            shuffledIndex !== null &&
            shuffledIndex !== currentIndex &&
            queue[shuffledIndex]
              ? shuffledIndex
              : candidates[Math.floor(Math.random() * candidates.length)]
          if (direction === 1) forcedNextSongId = null
          set((state) => ({
            currentIndex: nextIndex,
            lastStepDirection: direction,
            playing: true,
            currentTime: 0,
            buffered: 0,
            audioReady: false,
            audioUrl: '',
            sourceReady: false,
            resumeAt: null,
            lyricLines: [],
            lyricLoading: true,
            playToken: state.playToken + 1,
          }))
          const ok = await loadAt(nextIndex, { silent: true })
          if (ok) {
            maybeRefillHeart()
            return
          }
          skipped += 1
          // Fall through to the sequential scan so a failed random pick does
          // not leave the player silently stuck on an empty source.
        }
        let index = currentIndex
        // Both a manual "next" and natural playback completion wrap around.
        // Scan the whole queue so an unplayable track cannot strand playback,
        // then stop only when every entry has been tried.
        const maxSteps = queue.length
        for (let attempt = 0; attempt < maxSteps; attempt += 1) {
          // Skipping broken tracks in 顺序播放 must not wrap to the top either.
          if (stopAtEnd && direction === 1 && index + 1 >= queue.length) break
          index = (index + direction + queue.length) % queue.length
          const song = queue[index]
          if (!song) continue
          set((state) => ({
            currentIndex: index,
            lastStepDirection: direction,
            playing: true,
            currentTime: 0,
            buffered: 0,
            audioReady: false,
            audioUrl: '',
            sourceReady: false,
            resumeAt: null,
            lyricLines: [],
            lyricLoading: true,
            playToken: state.playToken + 1,
          }))
          const ok = await loadAt(index, { silent: true })
          if (ok) {
            maybeRefillHeart()
            reportSkipped(skipped, true)
            return
          }
          skipped += 1
        }
        set({ playing: false })
        reportSkipped(skipped, false)
      }

      return {
        queue: [],
        currentIndex: 0,
        lastStepDirection: 1,
        playlistId: '',
        playing: false,
        mode: 'loop',
        volume: 80,
        currentTime: 0,
        mediaDuration: 0,
        buffered: 0,
        playToken: 0,
        sourceReloadToken: 0,
        sourceTransition: 'none',
        audioReady: false,
        audioUrl: '',
        sourceReady: false,
        audioFromCache: false,
        audioBlob: null,
        loadRequestId: 0,
        showNowPlaying: false,
        showQueue: false,
        heartMode: false,
        heartLoading: false,
        lyricLines: [],
        lyricLoading: false,
        switchingSource: false,
        resumeAt: null,

        async initQueue(songs, index, playlistId) {
          if (!songs.length) {
            toast.warning(i18n._(msg`该列表暂无可播放歌曲`))
            return
          }
          const target = songs[index]
          const targetIndex = target
            ? Math.max(0, songs.findIndex((song) => song.id === target.id))
            : 0
          set((state) => ({
            queue: [...songs],
            currentIndex: targetIndex,
            playlistId,
            playing: true,
            currentTime: 0,
            buffered: 0,
            audioReady: false,
            audioUrl: '',
            sourceReady: false,
            resumeAt: null,
            lyricLines: [],
            lyricLoading: true,
            playToken: state.playToken + 1,
          }))
          if (get().mode === 'random') {
            ensureShuffleOrder(get().queue, targetIndex)
          }
          await loadAt(targetIndex)
        },

        async playAt(index) {
          // A manual selection starts a new intent; don't keep an old forced
          // next-selection around.
          forcedNextSongId = null
          const { queue, currentIndex } = get()
          const song = queue[index]
          if (!song) return false
          set((state) => ({
            currentIndex: index,
            lastStepDirection: index >= currentIndex ? 1 : -1,
            playing: true,
            currentTime: 0,
            buffered: 0,
            audioReady: false,
            audioUrl: '',
            sourceReady: false,
            resumeAt: null,
            lyricLines: [],
            lyricLoading: true,
            playToken: state.playToken + 1,
          }))
          const ok = await loadAt(index)
          if (!ok) set({ playing: false })
          if (ok) maybeRefillHeart()
          return ok
        },

        async playSong(song) {
          const { queue } = get()
          const existing = queue.findIndex((item) => item.id === song.id)
          if (existing >= 0) {
            await get().playAt(existing)
            return
          }
          const insertIndex = queue.length ? get().currentIndex + 1 : 0
          const nextQueue = [...queue]
          nextQueue.splice(insertIndex, 0, song)
          set({ queue: nextQueue })
          await get().playAt(insertIndex)
        },

        async playNext(song) {
          const state = get()
          if (!state.queue.length) {
            await state.initQueue([song], 0, '')
            return true
          }
          if (state.queue[state.currentIndex]?.id === song.id) return false

          const queue = [...state.queue]
          let currentIndex = state.currentIndex
          const existingIndex = queue.findIndex((item) => item.id === song.id)
          if (existingIndex >= 0) {
            const [existing] = queue.splice(existingIndex, 1)
            if (existingIndex < currentIndex) currentIndex -= 1
            queue.splice(Math.min(currentIndex + 1, queue.length), 0, existing)
          } else {
            queue.splice(Math.min(currentIndex + 1, queue.length), 0, song)
          }
          set({ queue, currentIndex })
          // In random mode, regular prefetch reserves a random target. Force
          // this song to be that forward target so it really plays next.
          forcedNextSongId = song.id
          // The new neighbour should be ready before the current track ends.
          prefetchNeighbors(currentIndex, 0)
          return true
        },

        addToQueue(songs) {
          const { queue } = get()
          const existingIds = new Set(queue.map((song) => song.id))
          const additions = songs.filter((song) => !existingIds.has(song.id))
          if (!additions.length) {
            toast.info(i18n._(msg`歌曲已在播放列表中`))
            return
          }
          set({ queue: [...queue, ...additions] })
          toast.success(
            i18n._(msg`已添加 ${additions.length} 首歌曲到播放列表`),
          )
        },

        moveQueueItem(from, to) {
          const { queue, currentIndex } = get()
          if (
            from < 0 ||
            from >= queue.length ||
            to < 0 ||
            to >= queue.length ||
            from === to
          ) {
            return
          }
          const currentSong = queue[currentIndex]
          const nextQueue = [...queue]
          const [moved] = nextQueue.splice(from, 1)
          nextQueue.splice(to, 0, moved)
          const nextIndex = currentSong
            ? nextQueue.indexOf(currentSong)
            : Math.min(currentIndex, nextQueue.length - 1)
          set({
            queue: nextQueue,
            currentIndex: Math.max(0, nextIndex),
          })
          prefetchNeighbors(Math.max(0, nextIndex), 0)
        },

        async togglePlay() {
          const { queue, currentIndex, playing } = get()
          if (!queue.length) return
          if (playing) {
            set({ playing: false })
            return
          }
          const song = queue[currentIndex]
          if (!song) return
          if (!get().audioUrl) {
            // First play after a restart continues where the app was closed.
            // A seek made before pressing play wins over the remembered spot.
            const ok = await loadAt(currentIndex, {
              resumeAt: get().resumeAt ?? takeRestoredPosition(song),
            })
            if (!ok) return
          }
          // A trial that already hit its limit should restart from the top
          // instead of immediately pausing again.
          const active = get().queue[get().currentIndex]
          const audio = getAudio()
          if (
            audio &&
            active?.trialEnd &&
            (audio.ended || audio.currentTime >= active.trialEnd)
          ) {
            audio.currentTime = 0
            set({ currentTime: 0 })
          }
          set({ playing: true })
        },

        next: (options) => step(1, options?.auto ?? false),
        prev: () => step(-1),

        setPlaying(value) {
          set({ playing: value })
        },

        cycleMode() {
          const mode = get().mode
          const nextMode =
            PLAY_MODE_CYCLE[(PLAY_MODE_CYCLE.indexOf(mode) + 1) % PLAY_MODE_CYCLE.length]
          set({ mode: nextMode })
          if (nextMode === 'random') {
            const state = get()
            ensureShuffleOrder(state.queue, state.currentIndex)
          } else {
            shuffleOrder = []
            shuffleCursor = -1
            shuffleKey = ''
          }
          toast.info(i18n._(PLAY_MODE_LABELS[nextMode]))
        },

        async toggleHeartMode() {
          const state = get()
          if (state.heartMode) {
            set({ heartMode: false })
            toast.info(i18n._(msg`已关闭心动模式`))
            return
          }
          const song = state.queue[state.currentIndex]
          if (!song) {
            toast.warning(i18n._(msg`请先播放歌曲`))
            return
          }
          set({ heartMode: true })
          const ok = await appendHeartSongs()
          if (!ok) {
            set({ heartMode: false })
            return
          }
          toast.success(i18n._(msg`心动模式已开启，将为你推荐歌曲`))
        },

        setVolume(value) {
          set({ volume: Math.min(100, Math.max(0, value)) })
        },

        setCurrentTime(value) {
          set({ currentTime: value })
        },

        setMediaDuration(value) {
          set({ mediaDuration: value })
        },

        setBuffered(value) {
          set({ buffered: value })
        },

        setAudioReady(value) {
          set({ audioReady: value })
        },

        toggleNowPlaying(value) {
          set((state) => ({
            showNowPlaying: value ?? !state.showNowPlaying,
          }))
        },

        toggleQueue(value) {
          set((state) => ({ showQueue: value ?? !state.showQueue }))
        },

        clearQueue() {
          clearPrefetchedAudio()
          forcedNextSongId = null
          shuffleOrder = []
          shuffleCursor = -1
          shuffleKey = ''
          prefetchToken += 1
          if (prefetchTimer !== undefined) {
            window.clearTimeout(prefetchTimer)
            prefetchTimer = undefined
          }
          set((state) => ({
            // Invalidate any in-flight loadAt/lyrics request so it cannot
            // write a source or lyrics back into the now-empty player.
            loadRequestId: state.loadRequestId + 1,
            queue: [],
            currentIndex: 0,
            playing: false,
            currentTime: 0,
            mediaDuration: 0,
            buffered: 0,
            sourceReloadToken: 0,
            sourceTransition: 'none',
            playlistId: '',
            lyricLines: [],
            lyricLoading: false,
            resumeAt: null,
            audioUrl: '',
            sourceReady: false,
            audioFromCache: false,
            audioBlob: null,
            heartMode: false,
            heartLoading: false,
            showNowPlaying: false,
            showQueue: false,
          }))
          toast.info(i18n._(msg`播放列表已清空`))
        },

        async refreshCurrentUrl() {
          const { currentIndex, queue } = get()
          const song = queue[currentIndex]
          if (!song) return false
          try {
            const fresh = await enrichSong(song)
            const active = get().queue[get().currentIndex]
            if (!active || active.id !== song.id) return true
            const freshUrl = fresh.url
            const freshLines = readLyrics(fresh)
            patchSong(currentIndex, fresh)
            set({
              audioUrl: freshUrl
                ? playbackUrl(freshUrl, Boolean(fresh.unblocked))
                : '',
              sourceReady: true,
              sourceReloadToken: get().sourceReloadToken + 1,
              // A recovery reload should keep the position instead of jumping
              // back to the beginning.
              // A seek on a track restored at launch falls back to the saved spot.
              resumeAt:
                get().resumeAt ?? (get().currentTime || takeRestoredPosition(song)),
              audioFromCache: false,
              audioBlob: null,
              // Keep the visible lyrics if the recovery could not load them.
              lyricLines: freshLines.length ? freshLines : get().lyricLines,
              lyricLoading: false,
            })
            return true
          } catch (error) {
            if (get().queue[get().currentIndex]?.id !== song.id) return false
            set({ playing: false })
            toast.warning(
              apiErrorMessage(error, i18n._(msg`歌曲资源已失效`)),
            )
            return false
          }
        },

        async ensureLyrics() {
          const state = get()
          const song = state.queue[state.currentIndex]
          if (!song) return
          // Already resolved (including "no lyrics") — persist it and hydrate
          // the view without another network or cache read.
          if (song.lyric || song.yrc || song.isNotLyric) {
            // A recommended edition's lyrics belong to its own song id, never
            // to the original track, or switching back would read them again.
            void saveCachedLyrics(song.alternativeSongId ?? song.id, {
              lyric: song.lyric ?? '',
              tlyric: song.tlyric ?? '',
              yrc: song.yrc ?? '',
              isNotLyric: Boolean(song.isNotLyric),
            })
            if (!state.lyricLines.length) {
              set({ lyricLines: readLyrics(song), lyricLoading: false })
            }
            return
          }
          // A full track load is already fetching the lyric for this song.
          if (state.lyricLoading) return

          const requestId = state.loadRequestId
          set({ lyricLoading: true })
          try {
            const lyricsSongId = song.alternativeSongId ?? song.id
            const patch = await loadLyricsPatch(lyricsSongId)
            // A track switch (or a newer load) owns the state now.
            if (get().loadRequestId !== requestId) return
            const active = get().queue[get().currentIndex]
            if (!active || active.id !== song.id) return
            if (!patch) {
              set({ lyricLoading: false })
              return
            }
            patchSong(get().currentIndex, patch)
            set({ lyricLines: readLyrics({ ...active, ...patch }), lyricLoading: false })
          } catch {
            if (get().loadRequestId === requestId) set({ lyricLoading: false })
          }
        },

        async switchToOtherSource(source, force = false) {
          const state = get()
          const index = state.currentIndex
          const song = state.queue[index]
          if (!song || state.switchingSource) return
          if (!force && song.unblocked) return
          set({ switchingSource: true })
          try {
            // A provider that was played before already has a file on disk:
            // play it instead of asking the matcher for a fresh URL.
            if (source && (await applyCachedVariant(song, source))) {
              toast.success(i18n._(msg`已切换到缓存的音源`))
              return
            }
            const [matched, restored] = await Promise.all([
              fetchMatchedSongUrl(song.id, source),
              originalSongFields(song.id),
            ])
            if (!matched.url) {
              toast.info(i18n._(msg`未找到其他可用音源`))
              return
            }
            const active = get()
            if (active.queue[active.currentIndex]?.id !== song.id) return
            const resumeAt = active.currentTime
            const nextSource = matched.source || source || ''
            const requestId = active.loadRequestId + 1
            // Another provider is usually another edition, so the previous
            // recommendation's id and lyrics must not survive the switch.
            const patch: Partial<Song> = {
              ...(restored ?? {}),
              url: matched.url,
              unblocked: true,
              matchedSource: nextSource || undefined,
              trialEnd: null,
              urlFetchedAt: Date.now(),
              alternativeSongId: undefined,
              alternativeVersion: false,
              lyric: '',
              tlyric: '',
              yrc: '',
              isNotLyric: false,
            }
            patchSong(active.currentIndex, patch)
            set({
              loadRequestId: requestId,
              audioUrl: playbackUrl(matched.url, true),
              sourceReady: true,
              audioFromCache: false,
              audioBlob: null,
              sourceTransition: 'none',
              playToken: active.playToken + 1,
              resumeAt,
              lyricLoading: true,
              lyricLines: [],
            })
            await resolveLyrics(active.currentIndex, { ...song, ...patch }, requestId)
            toast.success(i18n._(msg`已切换到其他音源`))
          } catch {
            toast.warning(i18n._(msg`切换音源失败，请稍后再试`))
          } finally {
            set({ switchingSource: false })
          }
        },

        /** Play an already-cached copy of the current track, offline-safe. */
        async playCachedSource(source) {
          const state = get()
          const song = state.queue[state.currentIndex]
          if (!song) return
          const applied = await applyCachedVariant(song, source)
          if (!applied) {
            toast.info(i18n._(msg`该音源还没有缓存`))
            return
          }
          toast.success(i18n._(msg`已切换到缓存的音源`))
        },

        /** NetEase's own "other playable edition" for a grey/VIP track. */
        async switchToRecommendedVersion() {
          const state = get()
          const song = state.queue[state.currentIndex]
          if (!song || state.switchingSource) return
          set({ switchingSource: true })
          try {
            if (await applyCachedVariant(song, 'copyright-rcmd')) {
              toast.success(i18n._(msg`已切换到缓存的音源`))
              return
            }
            const recommendation = await fetchSongCopyrightRecommendation(song.id)
            if (!recommendation || recommendation.id === song.id) {
              toast.info(i18n._(msg`没有找到其他可播放版本`))
              return
            }
            const detail =
              (await fetchSongDetail(recommendation.id).catch(() => null)) ??
              recommendation
            const level = useSettingsStore.getState().playLevel
            const info = await fetchSongUrlInfo(detail.id, level)
            if (!info.url) {
              toast.info(i18n._(msg`没有找到其他可播放版本`))
              return
            }
            const active = get()
            if (active.queue[active.currentIndex]?.id !== song.id) return
            const requestId = active.loadRequestId + 1
            const patch: Partial<Song> = {
              ...detail,
              // Keep the queue identity; the streamed edition supplies the rest.
              id: song.id,
              url: info.url,
              urlFetchedAt: Date.now(),
              trialEnd: info.trialEnd,
              unblocked: false,
              matchedSource: 'copyright-rcmd',
              alternativeSongId: detail.id,
              alternativeVersion: true,
              lyric: '',
              tlyric: '',
              yrc: '',
              isNotLyric: false,
            }
            patchSong(active.currentIndex, patch)
            set({
              loadRequestId: requestId,
              audioUrl: playbackUrl(info.url, false),
              sourceReady: true,
              audioFromCache: false,
              audioBlob: null,
              sourceTransition: 'none',
              playToken: active.playToken + 1,
              resumeAt: active.currentTime,
              lyricLoading: true,
              lyricLines: [],
            })
            await resolveLyrics(active.currentIndex, { ...song, ...patch }, requestId)
            toast.success(i18n._(msg`已切换到推荐版本`))
          } catch {
            toast.warning(i18n._(msg`切换音源失败，请稍后再试`))
          } finally {
            set({ switchingSource: false })
          }
        },

        consumeResumeAt() {
          set({ resumeAt: null })
        },

        seekTo(seconds, options) {
          if (!Number.isFinite(seconds)) return
          const target = Math.max(0, seconds)
          const state = get()
          const audio = getAudio()
          const ready = Boolean(
            !options?.defer &&
              audio &&
              state.audioUrl &&
              audio.getAttribute('src') === state.audioUrl &&
              audio.readyState >= 1 &&
              Number.isFinite(audio.duration) &&
              audio.duration > 0,
          )
          if (ready && audio) {
            const clamped = Math.min(target, Math.max(0, audio.duration - 0.25))
            audio.currentTime = clamped
            set({ currentTime: clamped, resumeAt: null })
            return
          }
          // Assigning currentTime to an element without loaded media is
          // ignored, and the bars show resumeAt while it is set; a seek here
          // used to snap straight back to the remembered position.
          restoredPosition = null
          set({ currentTime: target, resumeAt: target })
        },

        prefetchNext() {
          // onLoadedData has fired, so the current track no longer needs the
          // bandwidth head start: download the next track right away.
          prefetchNeighbors(get().currentIndex, 0)
        },

        invalidateUrls() {
          clearPrefetchedAudio()
          prefetchToken += 1
          if (prefetchTimer !== undefined) {
            window.clearTimeout(prefetchTimer)
            prefetchTimer = undefined
          }
          set((state) => ({
            queue: state.queue.map((song) => ({ ...song, urlFetchedAt: undefined })),
          }))
        },

        markSongLike(id, like) {
          set((state) => ({
            queue: state.queue.map((song) => (song.id === id ? { ...song, like } : song)),
          }))
        },
      }
    },
    {
      name: 'react-music-player',
      version: 1,
      // v1 adds 列表循环. The old 顺序播放 wrapped around at the end, which is
      // what 列表循环 does now; keep that behaviour for existing installs.
      migrate: (persisted, version) => {
        const state = persisted as PersistedPlayerState
        if (version < 1 && state?.mode === 'order') return { ...state, mode: 'loop' }
        return state
      },
      storage: createCoalescedStorage(),
      partialize: (state): PersistedPlayerState => {
        const persisted = persistQueue(state.queue, state.currentIndex)
        return {
          queue: persisted.queue,
          currentIndex: persisted.queue.length
            ? Math.min(
                persisted.queue.length - 1,
                Math.max(0, state.currentIndex - persisted.offset),
              )
            : 0,
          playlistId: state.playlistId,
          mode: state.mode,
          volume: state.volume,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.lyricLines = readLyrics(state.queue[state.currentIndex])
          // Show the remembered position on the progress bar before playback.
          state.resumeAt = peekRestoredPosition(state.queue[state.currentIndex])
        }
      },
    },
  ),
)

/**
 * The now-playing overlay stays mounted (hidden) while closed. Its progress
 * views read this instead of `currentTime`: while the overlay is closed it
 * holds the last shown position (reset on track change), so those views stop
 * re-rendering on every timeupdate and the exit animation no longer snaps the
 * lyrics/progress back to 0.
 */
let overlayTime = 0
let overlaySongId: number | undefined

type OverlayTimeState = Pick<
  PlayerState,
  'showNowPlaying' | 'currentTime' | 'audioUrl' | 'resumeAt'
>

/**
 * Position to show. While a resume is pending (restored session, recovery
 * reload, source switch) the new media still sits at 0 until loadedmetadata
 * seeks it, so show the target instead; it used to flash 0:00 in between.
 */
function overlayLiveTime(state: OverlayTimeState) {
  return state.resumeAt ?? state.currentTime
}

export function selectOverlayTime(state: OverlayTimeState) {
  return state.showNowPlaying ? overlayLiveTime(state) : overlayTime
}

usePlayerStore.subscribe((state) => {
  const songId = state.queue[state.currentIndex]?.id
  if (state.showNowPlaying || songId !== overlaySongId) overlayTime = overlayLiveTime(state)
  overlaySongId = songId
})

let positionSavedAt = 0
let lastSavedPosition = ''

/** Remember the current position, throttled; forced when the window hides. */
function savePosition(force = false) {
  const state = usePlayerStore.getState()
  // Nothing loaded yet (e.g. a restored, unplayed queue): keep the old entry.
  if (!state.audioUrl) return
  const song = state.queue[state.currentIndex]
  if (!song) return
  const now = Date.now()
  if (!force && now - positionSavedAt < POSITION_SAVE_INTERVAL) return
  positionSavedAt = now
  const value = JSON.stringify({ songId: song.id, time: Math.floor(state.currentTime) })
  if (value === lastSavedPosition) return
  lastSavedPosition = value
  try {
    localStorage.setItem(POSITION_KEY, value)
  } catch {
    // storage may be unavailable
  }
}

usePlayerStore.subscribe((state, previous) => {
  if (!state.queue.length && previous.queue.length) {
    lastSavedPosition = ''
    try {
      localStorage.removeItem(POSITION_KEY)
    } catch {
      // storage may be unavailable
    }
    return
  }
  if (state.currentTime !== previous.currentTime) savePosition()
})

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => savePosition(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePosition(true)
  })
}

