import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  checkMusicAvailable,
  fetchIntelligenceList,
  fetchLyric,
  fetchPersonalFm,
  fetchSongUrl,
} from '../api'
import { buildLyricLines, isEmptyLyric, type LyricLine } from '../lib/lyric'
import { apiUrl } from '../lib/http'
import { getCachedAudio } from '../lib/songCache'
import { toast } from '../lib/toast'
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
  markSongLike: (id: number, like: boolean) => void
}

async function enrichSong(song: Song): Promise<Song> {
  const available = await checkMusicAvailable(song.id)
  if (!available) {
    throw new Error('亲爱的，暂无版权，已为你跳过')
  }
  const url = await fetchSongUrl(song.id)
  if (!url) {
    throw new Error('获取歌曲播放地址失败')
  }
  const lyricData = await fetchLyric(song.id)
  const lyrics = buildLyricLines(lyricData)
  return {
    ...song,
    url,
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

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      const patchSong = (index: number, patch: Partial<Song>) => {
        set((state) => ({
          queue: state.queue.map((song, i) => (i === index ? { ...song, ...patch } : song)),
        }))
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
            set({ audioUrl: url, sourceReady: true })
            await resolveLyrics(index, song, requestId)
            return true
          }

          // Always resolve a fresh URL: NetEase media URLs expire, and the
          // persisted queue can still hold an URL that is no longer valid.
          const url = await fetchSongUrl(song.id)
          if (get().loadRequestId !== requestId) return true
          if (!url) {
            const available = await checkMusicAvailable(song.id)
            throw new Error(available ? '获取歌曲播放地址失败' : '亲爱的，暂无版权，已为你跳过')
          }
          patchSong(index, { url })
          // Stream through the local API: the WebView cannot load the CDN
          // media URL directly (it answers 403 for cross-origin media).
          set({ audioUrl: apiUrl('/audio/proxy', { url }), sourceReady: true })
          await resolveLyrics(index, song, requestId)
          return true
        } catch (error) {
          if (get().loadRequestId !== requestId) return true
          set({ lyricLoading: false, playing: false, audioUrl: '', sourceReady: false })
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
          let nextIndex = currentIndex
          while (nextIndex === currentIndex) {
            nextIndex = Math.floor(Math.random() * queue.length)
          }
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
          await loadAt(nextIndex)
          maybeRefillHeart()
          return
        }
        let index = currentIndex
        for (let attempt = 0; attempt < queue.length; attempt += 1) {
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
          const targetIndex = Math.max(
            0,
            target ? list.findIndex((song) => song.id === target.id) : 0,
          )
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
            heartMode: false,
            heartLoading: false,
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

        markSongLike(id, like) {
          set((state) => ({
            queue: state.queue.map((song) => (song.id === id ? { ...song, like } : song)),
          }))
        },
      }
    },
    {
      name: 'react-music-player',
      partialize: (state) => ({
        queue: state.queue,
        currentIndex: state.currentIndex,
        playlistId: state.playlistId,
        mode: state.mode,
        volume: state.volume,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.lyricLines = readLyrics(state.queue[state.currentIndex])
        }
      },
    },
  ),
)

