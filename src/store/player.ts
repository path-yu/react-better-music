import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  checkMusicAvailable,
  fetchIntelligenceList,
  fetchLyric,
  fetchPersonalFm,
  fetchSongUrlInfo,
} from '../api'
import { buildLyricLines, isEmptyLyric, type LyricLine } from '../lib/lyric'
import { apiUrl } from '../lib/http'
import { getAudio } from '../lib/audio'
import { getCachedAudio, hasCachedAudio } from '../lib/songCache'
import {
  clearPrefetchedAudio,
  consumePrefetchedAudio,
  prefetchAudio,
  retainPrefetchedAudio,
} from '../lib/audioPrefetch'
import { createCoalescedStorage } from '../lib/persistStorage'
import { toast } from '../lib/toast'
import { useSettingsStore } from './settings'
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
  initQueue: (songs: Song[], index: number, playlistId: string) => Promise<void>
  playAt: (index: number) => Promise<boolean>
  playSong: (song: Song) => Promise<void>
  addToQueue: (songs: Song[]) => void
  togglePlay: () => Promise<void>
  next: () => Promise<void>
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
  prefetchNext: () => void
  invalidateUrls: () => void
  markSongLike: (id: number, like: boolean) => void
}

async function enrichSong(song: Song): Promise<Song> {
  const available = await checkMusicAvailable(song.id)
  if (!available) {
    throw new Error('亲爱的，暂无版权，已为你跳过')
  }
  const { url, trialEnd } = await fetchSongUrlInfo(
    song.id,
    useSettingsStore.getState().playLevel,
  )
  if (!url) {
    throw new Error('获取歌曲播放地址失败')
  }
  const lyricData = await fetchLyric(song.id)
  const lyrics = buildLyricLines(lyricData)
  return {
    ...song,
    url,
    urlFetchedAt: Date.now(),
    trialEnd,
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

const playableQueue = (songs: Song[]) => songs.filter((song) => song.fee !== 0)

// NetEase media URLs expire after roughly 20 minutes; treat anything older
// than this as stale and resolve it again before playback.
const URL_TTL = 10 * 60 * 1000
// Give the current track a head start before downloading the next one.
const AUDIO_PREFETCH_DELAY = 1800

let prefetchTimer: number | undefined
let prefetchToken = 0
const urlRequests = new Map<
  number,
  Promise<{ url: string | null; trialEnd: number | null }>
>()

function hasFreshUrl(song: Song) {
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
        const level = useSettingsStore.getState().playLevel
        const pendingRequest = urlRequests.get(song.id)
        if (pendingRequest) return pendingRequest
        const request = fetchSongUrlInfo(song.id, level).finally(() => {
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
            if (candidate && candidate.fee !== 0) {
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
          if (await hasCachedAudio(song.id)) return null
          let url = hasFreshUrl(song) ? (song.url ?? null) : null
          let trialEnd = song.trialEnd ?? null
          if (!url) {
            try {
              const info = await requestNeighborUrl(song)
              url = info.url
              trialEnd = info.trialEnd
            } catch {
              return null
            }
            if (!url) return null
            const active = get().queue[neighborIndex]
            if (!active || active.id !== song.id) return null
            patchSong(neighborIndex, { url, urlFetchedAt: Date.now(), trialEnd })
          }
          return { songId: song.id, url, trialEnd }
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
              if (result) void prefetchAudio(result.songId, result.url, result.trialEnd)
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
        if (song.fee === 0) {
          toast.warning(`「${song.name}」暂无音源`)
          return false
        }
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
        })
        try {
          // Prefer audio cached in IndexedDB (ffmpeg-transcoded Opus).
          const cached = await getCachedAudio(song.id)
          if (get().loadRequestId !== requestId) return true

          if (cached) {
            const url = URL.createObjectURL(cached)
            if (get().loadRequestId !== requestId) {
              URL.revokeObjectURL(url)
              return true
            }
            set({ audioUrl: url, sourceReady: true, audioFromCache: true })
            prefetchNeighbors(index)
            await resolveLyrics(index, song, requestId)
            return true
          }

          // A neighbour preload is already a local Blob: play it immediately.
          const prefetched = consumePrefetchedAudio(song.id)
          if (prefetched) {
            set({ audioUrl: prefetched.url, sourceReady: true, audioBlob: prefetched.blob })
            if (prefetched.trialEnd && prefetched.trialEnd > 0) {
              toast.warning(
                `当前仅可试听 ${prefetched.trialEnd} 秒，登录或开通会员后可播放完整版`,
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
          if (!url) {
            const info = await fetchSongUrlInfo(song.id, useSettingsStore.getState().playLevel)
            url = info.url
            trialEnd = info.trialEnd
            if (get().loadRequestId !== requestId) return true
            if (url) patchSong(index, { url, urlFetchedAt: Date.now(), trialEnd })
          }
          if (!url) {
            const available = await checkMusicAvailable(song.id)
            throw new Error(available ? '获取歌曲播放地址失败' : '亲爱的，暂无版权，已为你跳过')
          }
          // Stream through the local API: the WebView cannot load the CDN
          // media URL directly (it answers 403 for cross-origin media).
          set({ audioUrl: apiUrl('/audio/proxy', { url }), sourceReady: true })
          if (trialEnd && trialEnd > 0) {
            toast.warning(`当前仅可试听 ${trialEnd} 秒，登录或开通会员后可播放完整版`)
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
          toast.warning(error instanceof Error ? error.message : '歌曲加载失败')
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
            error instanceof Error && error.message
              ? `${error.message}，请确认已登录后重试`
              : '心动模式暂不可用，请先登录',
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

      const step = async (direction: 1 | -1) => {
        const { queue, currentIndex, mode } = get()
        if (!queue.length) return
        if (mode === 'random' && queue.length > 1) {
          const candidates = queue
            .map((song, index) => (song && song.fee !== 0 ? index : -1))
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
        // Sequential playback stops at the end of the queue; only previous /
        // loop modes wrap around.
        const maxSteps =
          direction === 1 && mode === 'order'
            ? queue.length - 1 - currentIndex
            : queue.length
        for (let attempt = 0; attempt < maxSteps; attempt += 1) {
          index = (index + direction + queue.length) % queue.length
          const song = queue[index]
          if (!song || song.fee === 0) continue
          set((state) => ({
            currentIndex: index,
            playing: true,
            currentTime: 0,
            buffered: 0,
            audioReady: false,
            audioUrl: '',
            sourceReady: false,
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

        async initQueue(songs, index, playlistId) {
          const list = playableQueue(songs)
          if (!list.length) {
            toast.warning('该列表暂无可播放歌曲')
            return
          }
          const target = songs[index]
          if (target && target.fee === 0) {
            toast.warning(`「${target.name}」暂无音源`)
            return
          }
          const targetIndex = target
            ? Math.max(0, list.findIndex((song) => song.id === target.id))
            : 0
          set((state) => ({
            queue: list,
            currentIndex: targetIndex,
            playlistId,
            playing: true,
            currentTime: 0,
            buffered: 0,
            audioReady: false,
            audioUrl: '',
            sourceReady: false,
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
          if (song.fee === 0) {
            toast.warning(`「${song.name}」暂无音源`)
            return false
          }
          set((state) => ({
            currentIndex: index,
            playing: true,
            currentTime: 0,
            buffered: 0,
            audioReady: false,
            audioUrl: '',
            sourceReady: false,
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
            toast.info('歌曲已在播放列表中')
            return
          }
          set({ queue: [...queue, ...additions] })
          toast.success(`已添加 ${additions.length} 首歌曲到播放列表`)
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

        next: () => step(1),
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
              ? '顺序播放'
              : nextMode === 'random'
                ? '随机播放'
                : '单曲循环',
          )
        },

        async toggleHeartMode() {
          const state = get()
          if (state.heartMode) {
            set({ heartMode: false })
            toast.info('已关闭心动模式')
            return
          }
          const song = state.queue[state.currentIndex]
          if (!song) {
            toast.warning('请先播放歌曲')
            return
          }
          set({ heartMode: true })
          const ok = await appendHeartSongs()
          if (!ok) {
            set({ heartMode: false })
            return
          }
          toast.success('心动模式已开启，将为你推荐歌曲')
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
          toast.info('播放列表已清空')
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
              audioUrl: freshUrl ? apiUrl('/audio/proxy', { url: freshUrl }) : '',
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
            toast.warning(error instanceof Error ? error.message : '歌曲资源已失效')
            return false
          }
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

