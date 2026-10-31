import { create } from 'zustand'
import { msg } from '@lingui/core/macro'
import { persist } from 'zustand/middleware'
import {
  checkMusicAvailable,
  fetchIntelligenceList,
  fetchLyric,
  fetchMatchedSongUrl,
  fetchPersonalFm,
  fetchSongUrlInfo,
} from '../api'
import { buildLyricLines, isEmptyLyric, type LyricLine } from '../lib/lyric'
import { copyrightHint } from '../lib/songs'
import { apiUrl } from '../lib/http'
import { getAudio } from '../lib/audio'
import { getCachedAudio, hasCachedAudio, removeCachedAudio } from '../lib/songCache'
import {
  clearPrefetchedAudio,
  consumePrefetchedAudio,
  discardPrefetchedAudio,
  prefetchAudio,
  retainPrefetchedAudio,
} from '../lib/audioPrefetch'
import { createCoalescedStorage } from '../lib/persistStorage'
import { toast } from '../lib/toast'
import { apiErrorMessage } from '../lib/apiErrors'
import { i18n } from '../i18n'
import { useSettingsStore } from './settings'
import { useLocalLibraryStore } from './localLibrary'
import { useVideoPlaybackStore } from './videoPlayback'
import type { Song } from '../types'

export type PlayMode = 'order' | 'random' | 'singleLoop'

interface PlayerState {
  queue: Song[]
  currentIndex: number
  playlistId: string
  playing: boolean
  mode: PlayMode
  volume: number
  currentTime: number
  buffered: number
  playToken: number
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
  addToQueue: (songs: Song[]) => void
  togglePlay: () => Promise<void>
  /** `auto` is true only when the current track ended on its own. */
  next: (options?: { auto?: boolean }) => Promise<void>
  prev: () => Promise<void>
  setPlaying: (value: boolean) => void
  cycleMode: () => void
  toggleHeartMode: () => Promise<void>
  setVolume: (value: number) => void
  setCurrentTime: (value: number) => void
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
  consumeResumeAt: () => void
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
}

/**
 * Resolve a playable media URL. The official lookup runs first; only an
 * undecided gray track (`fee === 0` without a `noCopyrightRcmd` hint) asks
 * `/check/music`, and a copyright-less verdict falls back to the local
 * UnblockNeteaseMusic matcher.
 */
async function resolveSongSource(song: Song): Promise<SongSource> {
  const level = useSettingsStore.getState().playLevel
  const autoReplace = useSettingsStore.getState().autoReplaceVipSource
  const preferredSource = useSettingsStore.getState().preferredSource
  const requestedSource = preferredSource === 'auto' ? undefined : preferredSource

  // Cache the match attempt so a VIP-first lookup and a trial fallback don't
  // request the same matcher twice in one resolution.
  let matchedPromise: Promise<{ url: string; source: string }> | null = null
  const getMatched = () => {
    if (!matchedPromise) {
      matchedPromise = fetchMatchedSongUrl(song.id, requestedSource)
        .then((matched) => ({ url: matched.url, source: matched.source }))
        .catch(() => ({ url: '', source: '' }))
    }
    return matchedPromise
  }
  const autoMatchedSource = async (): Promise<SongSource | null> => {
    if (!autoReplace) return null
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

  // Only true VIP tracks get the matcher before the official lookup. `fee`
  // is a bitmask, not a boolean: common free/low-quality tracks use fee=8
  // and already have a normal CDN URL, so treating every non-zero fee as VIP
  // made `/song/url/match` run for songs that did not need it.
  if (song.fee === 1 && autoReplace) {
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
      if (autoReplace && info.trialEnd && info.trialEnd > 0) {
        const matched = await autoMatchedSource()
        if (matched) return matched
      }
      return { ...info, unblocked: false, available: true }
    }
  } catch (error) {
    // Gray tracks often fail outright; normal tracks surface the error below.
    urlError = error
  }

  // No official URL at all: if auto matching is on, try it before deciding the
  // track is unavailable.
  if (autoReplace) {
    const matched = await autoMatchedSource()
    if (matched) return matched
  }

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
 * `/audio/proxy` only accepts NetEase CDN hosts (enforced in server/server.js),
 * so third-party matches are streamed directly by the audio element.
 */
const NETEASE_MEDIA = /^https?:\/\/[^/]*music\.126\.net\//

function playbackUrl(url: string, unblocked: boolean) {
  return unblocked && !NETEASE_MEDIA.test(url) ? url : apiUrl('/audio/proxy', { url })
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
  const lyricData = await fetchLyric(song.id)
  const lyrics = buildLyricLines(lyricData)
  return {
    ...song,
    url: source.url,
    unblocked: source.unblocked,
    matchedSource: source.matchedSource,
    urlFetchedAt: Date.now(),
    trialEnd: source.trialEnd,
    lyric: lyricData.lyric,
    tlyric: lyricData.tlyric,
    yrc: lyricData.yrc,
    isNotLyric: isEmptyLyric(lyricData.lyric) && !lyricData.yrc,
    ...(lyrics.length ? {} : { isNotLyric: true }),
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
const urlRequests = new Map<number, Promise<SongSource>>()

/**
 * VIP/free-trial audio may already be cached from before the user enabled
 * source matching. That cached blob can be a 30s preview or an official URL
 * from a provider the user no longer prefers, so re-resolve instead of using it.
 */
function shouldBypassAudioCache(song: Song) {
  return (
    useSettingsStore.getState().autoReplaceVipSource &&
    (song.fee === 1 || (song.trialEnd ?? 0) > 0)
  )
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

        const findNext = () => {
          // Random jumps are unpredictable and single-track loop replays the
          // same song, so only sequential playback has a reliable neighbour.
          if (mode !== 'order') return null
          for (let step = 1; index + step < queue.length; step += 1) {
            const candidateIndex = index + step
            const candidate = queue[candidateIndex]
            if (candidate) {
              return { index: candidateIndex, song: candidate }
            }
          }
          return null
        }
        // Only the next track is prefetched: downloading the previous one as
        // well doubled the bandwidth and Blob memory for a case users rarely
        // hit.
        const next = findNext()
        const neighbors = next ? [next] : []

        // Only the reachable neighbour may keep its prefetched audio.
        retainPrefetchedAudio(neighbors.map((entry) => entry.song.id))
        if (!neighbors.length) return

        const resolves = neighbors.map(async ({ index: neighborIndex, song }) => {
          const bypassAudioCache = shouldBypassAudioCache(song)
          if (bypassAudioCache) void removeCachedAudio(song.id)
          if (!bypassAudioCache && (await hasCachedAudio(song.id))) return null
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

        // Lossless/Hi-Res files can reach dozens of megabytes; keep those as
        // streams instead of holding a full Blob in memory.
        const level = useSettingsStore.getState().playLevel
        const allowDownload = level !== 'lossless' && level !== 'hires'

        void Promise.all(resolves).then((results) => {
          if (token !== prefetchToken || get().currentIndex !== index) return
          const start = () => {
            if (token !== prefetchToken || get().currentIndex !== index) return
            if (!allowDownload) return
            for (const result of results) {
              // Third-party URLs cannot go through the NetEase-only audio
              // proxy, so they stay streaming-only. A matched URL that still
              // points at the NetEase CDN can replace the old trial cache.
              if (
                result &&
                (!result.unblocked || NETEASE_MEDIA.test(result.url ?? ''))
              ) {
                void prefetchAudio(result.songId, result.url, result.trialEnd)
              }
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
        if (song.lyric || song.yrc || song.isNotLyric) {
          set({ lyricLines: readLyrics(song), lyricLoading: false })
          return
        }
        try {
          const lyricData = await fetchLyric(song.id)
          if (get().loadRequestId !== requestId) return
          const patch: Partial<Song> = {
            lyric: lyricData.lyric,
            tlyric: lyricData.tlyric,
            yrc: lyricData.yrc,
            isNotLyric: isEmptyLyric(lyricData.lyric) && !lyricData.yrc,
          }
          patchSong(index, patch)
          set({ lyricLines: readLyrics({ ...song, ...patch }), lyricLoading: false })
        } catch {
          if (get().loadRequestId === requestId) set({ lyricLoading: false })
        }
      }

      const loadAt = async (index: number) => {
        const state = get()
        const song = state.queue[index]
        if (!song) return false
        const requestId = state.loadRequestId + 1
        // Clear stale lyrics/source so a different song never shows the
        // previous track's data while its own source is still resolving.
        set({
          loadRequestId: requestId,
          lyricLoading: true,
          lyricLines: [],
          audioUrl: '',
          sourceReady: false,
          audioFromCache: false,
          audioBlob: null,
          resumeAt: null,
        })
        try {
          // Prefer audio cached in IndexedDB (WebCodecs-transcoded Opus), except
          // for VIP/trial tracks when source matching is enabled: those caches
          // may be the old 30s preview and must be refreshed.
          const bypassAudioCache = shouldBypassAudioCache(song)
          if (bypassAudioCache) void removeCachedAudio(song.id)
          const cached = bypassAudioCache ? null : await getCachedAudio(song.id)
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
          let available = true
          if (!url) {
            const source = await resolveSongSource(song)
            if (get().loadRequestId !== requestId) return true
            url = source.url
            trialEnd = source.trialEnd
            unblocked = source.unblocked
            matchedSource = source.matchedSource
            available = source.available
            if (url) {
              patchSong(index, {
                url,
                urlFetchedAt: Date.now(),
                trialEnd,
                unblocked,
                matchedSource,
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
              toast.info(
                song.fee === 0
                  ? i18n._(msg`「${song.name}」暂无官方音源，已为你匹配其他音源播放`)
                  : i18n._(msg`「${song.name}」VIP 歌曲已为你匹配其他音源播放`),
              )
            }
          }
          // Stream through the local API: the WebView cannot load the CDN
          // media URL directly (it answers 403 for cross-origin media).
          set({ audioUrl: playbackUrl(url, unblocked), sourceReady: true })
          void useLocalLibraryStore.getState().recordRecent(song)
          if (trialEnd && trialEnd > 0) {
            toast.warning(
              i18n._(msg`当前仅可试听 ${trialEnd} 秒，登录或开通会员后可播放完整版`),
            )
          }
          prefetchNeighbors(index)
          await resolveLyrics(index, song, requestId)
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
          toast.warning(
            apiErrorMessage(error, i18n._(msg`歌曲加载失败`)),
          )
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
              throw heartError ?? new Error('智能播放暂不可用，请先登录')
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

      const step = async (direction: 1 | -1, auto = false) => {
        const { queue, currentIndex, mode } = get()
        if (!queue.length) return
        if (mode === 'random' && queue.length > 1) {
          const candidates = queue
            .map((song, index) => (song ? index : -1))
            .filter((index) => index >= 0 && index !== currentIndex)
          if (!candidates.length) {
            set({ playing: false })
            return
          }
          const nextIndex = candidates[Math.floor(Math.random() * candidates.length)]
          set((state) => ({
            currentIndex: nextIndex,
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
          const ok = await loadAt(nextIndex)
          if (ok) {
            maybeRefillHeart()
            return
          }
          // Fall through to the sequential scan so a failed random pick does
          // not leave the player silently stuck on an empty source.
        }
        let index = currentIndex
        // A natural end in sequential mode stops; pressing next (or using a
        // media key) always advances, wrapping to the first track at the end.
        const maxSteps =
          direction === 1 && mode === 'order' && auto
            ? queue.length - 1 - currentIndex
            : queue.length
        for (let attempt = 0; attempt < maxSteps; attempt += 1) {
          index = (index + direction + queue.length) % queue.length
          const song = queue[index]
          if (!song) continue
          set((state) => ({
            currentIndex: index,
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
          if (ok) {
            maybeRefillHeart()
            return
          }
        }
        set({ playing: false })
      }

      return {
        queue: [],
        currentIndex: 0,
        playlistId: '',
        playing: false,
        mode: 'order',
        volume: 80,
        currentTime: 0,
        buffered: 0,
        playToken: 0,
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
          await loadAt(targetIndex)
        },

        async playAt(index) {
          const { queue } = get()
          const song = queue[index]
          if (!song) return false
          set((state) => ({
            currentIndex: index,
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
            const ok = await loadAt(currentIndex)
            if (!ok) return
          }
          // A trial that already hit its limit should restart from the top
          // instead of immediately pausing again.
          const active = get().queue[get().currentIndex]
          const audio = getAudio()
          if (audio && active?.trialEnd && audio.currentTime >= active.trialEnd) {
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
          const nextMode: PlayMode =
            mode === 'order' ? 'random' : mode === 'random' ? 'singleLoop' : 'order'
          set({ mode: nextMode })
          toast.info(
            nextMode === 'order'
              ? i18n._(msg`顺序播放`)
              : nextMode === 'random'
                ? i18n._(msg`随机播放`)
                : i18n._(msg`单曲循环`),
          )
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
          prefetchToken += 1
          if (prefetchTimer !== undefined) {
            window.clearTimeout(prefetchTimer)
            prefetchTimer = undefined
          }
          set({
            queue: [],
            currentIndex: 0,
            playing: false,
            currentTime: 0,
            buffered: 0,
            playlistId: '',
            lyricLines: [],
            audioUrl: '',
            sourceReady: false,
            audioFromCache: false,
            audioBlob: null,
            heartMode: false,
            heartLoading: false,
            showNowPlaying: false,
            showQueue: false,
          })
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
            patchSong(currentIndex, fresh)
            set({
              audioUrl: freshUrl
                ? playbackUrl(freshUrl, Boolean(fresh.unblocked))
                : '',
              sourceReady: true,
              audioFromCache: false,
              audioBlob: null,
              lyricLines: readLyrics(fresh),
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
          // Already resolved (including "no lyrics") — only hydrate the view.
          if (song.lyric || song.yrc || song.isNotLyric) {
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
            const lyricData = await fetchLyric(song.id)
            // A track switch (or a newer load) owns the state now.
            if (get().loadRequestId !== requestId) return
            const active = get().queue[get().currentIndex]
            if (!active || active.id !== song.id) return
            const patch: Partial<Song> = {
              lyric: lyricData.lyric,
              tlyric: lyricData.tlyric,
              yrc: lyricData.yrc,
              isNotLyric: isEmptyLyric(lyricData.lyric) && !lyricData.yrc,
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
            const matched = await fetchMatchedSongUrl(song.id, source)
            if (!matched.url) {
              toast.info(i18n._(msg`未找到其他可用音源`))
              return
            }
            const active = get()
            if (active.queue[active.currentIndex]?.id !== song.id) return
            const resumeAt = active.currentTime
            patchSong(active.currentIndex, {
              url: matched.url,
              unblocked: true,
              matchedSource: matched.source || source,
              trialEnd: null,
              urlFetchedAt: Date.now(),
            })
            set((current) => ({
              audioUrl: playbackUrl(matched.url, true),
              sourceReady: true,
              audioFromCache: false,
              audioBlob: null,
              playToken: current.playToken + 1,
              resumeAt,
            }))
            toast.success(i18n._(msg`已切换到其他音源`))
          } catch {
            toast.warning(i18n._(msg`切换音源失败，请稍后再试`))
          } finally {
            set({ switchingSource: false })
          }
        },

        consumeResumeAt() {
          set({ resumeAt: null })
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
      storage: createCoalescedStorage<PersistedPlayerState>(),
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
        }
      },
    },
  ),
)

