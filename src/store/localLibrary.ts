import { create } from 'zustand'
import { msg } from '@lingui/core/macro'
import {
  addLocalFavorite,
  addLocalPlaylistSong,
  addLocalSubscribedPlaylist,
  clearLocalRecent,
  createLocalPlaylist,
  deleteLocalPlaylist,
  fetchLocalLibrary,
  recordLocalRecent,
  removeLocalFavorite,
  removeLocalPlaylistSong,
  removeLocalRecent,
  removeLocalSubscribedPlaylist,
  renameLocalPlaylist,
  type LocalPlaylist,
  type LocalRecent,
} from '../api/local'
import { toast } from '../lib/toast'
import { i18n } from '../i18n'
import type { Playlist, Song } from '../types'

interface LocalLibraryState {
  loaded: boolean
  loading: boolean
  playlists: LocalPlaylist[]
  subscribedPlaylists: Playlist[]
  favorites: Song[]
  recent: LocalRecent[]
  load: (force?: boolean) => Promise<void>
  createPlaylist: (name: string) => Promise<LocalPlaylist | null>
  renamePlaylist: (id: string, name: string) => Promise<boolean>
  removePlaylist: (id: string) => Promise<boolean>
  addSong: (playlistId: string, song: Song) => Promise<boolean>
  removeSong: (playlistId: string, songId: number) => Promise<boolean>
  toggleSubscribedPlaylist: (playlist: Playlist) => Promise<boolean | null>
  toggleFavorite: (song: Song) => Promise<boolean>
  recordRecent: (song: Song) => Promise<void>
  removeRecent: (songId: number) => Promise<void>
  clearRecent: () => Promise<void>
}

export const useLocalLibraryStore = create<LocalLibraryState>()((set, get) => ({
  loaded: false,
  loading: false,
  playlists: [],
  subscribedPlaylists: [],
  favorites: [],
  recent: [],

  async load(force = false) {
    if (get().loading || (get().loaded && !force)) return
    set({ loading: true })
    try {
      const library = await fetchLocalLibrary()
      set({
        loaded: true,
        loading: false,
        playlists: library.playlists ?? [],
        subscribedPlaylists: library.subscribedPlaylists ?? [],
        favorites: library.favorites ?? [],
        recent: library.recent ?? [],
      })
    } catch {
      set({ loading: false })
    }
  },

  async createPlaylist(name) {
    try {
      const playlist = await createLocalPlaylist(name)
      set((state) => ({ playlists: [playlist, ...state.playlists] }))
      return playlist
    } catch (error) {
      toast.warning(
        error instanceof Error ? error.message : i18n._(msg`创建歌单失败`),
      )
      return null
    }
  },

  async renamePlaylist(id, name) {
    try {
      const playlist = await renameLocalPlaylist(id, name)
      set((state) => ({
        playlists: state.playlists.map((item) =>
          item.id === id ? playlist : item,
        ),
      }))
      return true
    } catch {
      toast.warning(i18n._(msg`重命名歌单失败`))
      return false
    }
  },

  async removePlaylist(id) {
    try {
      await deleteLocalPlaylist(id)
      set((state) => ({
        playlists: state.playlists.filter((item) => item.id !== id),
      }))
      return true
    } catch {
      toast.warning(i18n._(msg`删除歌单失败`))
      return false
    }
  },

  async addSong(playlistId, song) {
    try {
      const playlist = await addLocalPlaylistSong(playlistId, song)
      set((state) => ({
        playlists: state.playlists.map((item) =>
          item.id === playlistId ? playlist : item,
        ),
      }))
      return true
    } catch {
      toast.error(i18n._(msg`收藏失败`))
      return false
    }
  },

  async removeSong(playlistId, songId) {
    try {
      const playlist = await removeLocalPlaylistSong(playlistId, songId)
      set((state) => ({
        playlists: state.playlists.map((item) =>
          item.id === playlistId ? playlist : item,
        ),
      }))
      return true
    } catch {
      toast.error(i18n._(msg`移除歌曲失败`))
      return false
    }
  },

  async toggleSubscribedPlaylist(playlist) {
    const subscribed = get().subscribedPlaylists.some(
      (item) => Number(item.id) === Number(playlist.id),
    )
    try {
      const next = subscribed
        ? await removeLocalSubscribedPlaylist(playlist.id)
        : await addLocalSubscribedPlaylist(playlist)
      set({ subscribedPlaylists: next })
      return !subscribed
    } catch {
      toast.error(i18n._(msg`收藏失败`))
      return null
    }
  },

  async toggleFavorite(song) {
    const liked = get().favorites.some((item) => item.id === song.id)
    try {
      const favorites = liked
        ? await removeLocalFavorite(song.id)
        : await addLocalFavorite(song)
      set({ favorites })
      return !liked
    } catch {
      toast.error(i18n._(msg`收藏失败`))
      return liked
    }
  },

  async recordRecent(song) {
    const first = get().recent[0]
    // Player effects can fire more than once for the same track; don't rewrite
    // the file for a replay within a minute.
    if (
      first?.song.id === song.id &&
      Date.now() - first.playedAt < 60_000
    ) {
      return
    }
    try {
      const recent = await recordLocalRecent(song)
      set({ recent })
    } catch {
      // Recent history is best-effort; playback must not fail because of it.
    }
  },

  async removeRecent(songId) {
    try {
      const recent = await removeLocalRecent(songId)
      set({ recent })
    } catch {
      toast.warning(i18n._(msg`移除播放记录失败`))
    }
  },

  async clearRecent() {
    try {
      const recent = await clearLocalRecent()
      set({ recent })
    } catch {
      toast.warning(i18n._(msg`清空播放记录失败`))
    }
  },
}))
