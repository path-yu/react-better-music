import { create } from 'zustand'
import { msg } from '@lingui/core/macro'
import {
  addLocalFavorite,
  addLocalPlaylistSong,
  addLocalSubscribedAlbum,
  addLocalSubscribedArtist,
  addLocalSubscribedPlaylist,
  addLocalSubscribedUser,
  clearLocalRecent,
  createLocalPlaylist,
  deleteLocalPlaylist,
  fetchLocalLibrary,
  recordLocalRecent,
  removeLocalFavorite,
  removeLocalPlaylistSong,
  removeLocalRecent,
  removeLocalSubscribedAlbum,
  removeLocalSubscribedArtist,
  removeLocalSubscribedPlaylist,
  removeLocalSubscribedUser,
  renameLocalPlaylist,
  type LocalPlaylist,
  type LocalRecent,
  type LocalSubscribedAlbum,
  type LocalSubscribedArtist,
  type LocalSubscribedPlaylist,
  type LocalSubscribedUser,
} from '../api/local'
import { toast } from '../lib/toast'
import { i18n } from '../i18n'
import type { Album, ArtistSummary, Song, UserProfile } from '../types'

interface LocalLibraryState {
  loaded: boolean
  loading: boolean
  playlists: LocalPlaylist[]
  subscribedPlaylists: LocalSubscribedPlaylist[]
  subscribedAlbums: LocalSubscribedAlbum[]
  subscribedArtists: LocalSubscribedArtist[]
  subscribedUsers: LocalSubscribedUser[]
  favorites: Song[]
  recent: LocalRecent[]
  load: (force?: boolean) => Promise<void>
  createPlaylist: (name: string, songs?: Song[]) => Promise<LocalPlaylist | null>
  renamePlaylist: (id: string, name: string) => Promise<boolean>
  removePlaylist: (id: string) => Promise<boolean>
  addSong: (playlistId: string, song: Song) => Promise<boolean>
  removeSong: (playlistId: string, songId: number) => Promise<boolean>
  toggleSubscribedPlaylist: (
    playlist: LocalSubscribedPlaylist,
  ) => Promise<boolean | null>
  cacheSubscribedPlaylist: (
    playlist: LocalSubscribedPlaylist,
  ) => Promise<void>
  /** Guest album collection; the signed-in path uses NetEase's album/sub. */
  toggleSubscribedAlbum: (album: Album) => Promise<boolean | null>
  /** Guest artist follows; the signed-in path uses NetEase's artist/sub. */
  toggleSubscribedArtist: (artist: ArtistSummary) => Promise<boolean | null>
  /** Refresh a followed artist's snapshot (avatar backfill); never toggles. */
  cacheSubscribedArtist: (artist: ArtistSummary) => Promise<void>
  /** Guest account follows; the signed-in path uses NetEase's /follow. */
  toggleSubscribedUser: (user: UserProfile) => Promise<boolean | null>
  toggleFavorite: (song: Song) => Promise<boolean>
  recordRecent: (song: Song) => Promise<void>
  removeRecent: (songId: number) => Promise<void>
  clearRecent: () => Promise<void>
}

/** Songs with a favorite toggle in flight; repeated clicks are ignored. */
const favoritePending = new Set<number>()

export const useLocalLibraryStore = create<LocalLibraryState>()((set, get) => ({
  loaded: false,
  loading: false,
  playlists: [],
  subscribedPlaylists: [],
  subscribedAlbums: [],
  subscribedArtists: [],
  subscribedUsers: [],
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
        subscribedAlbums: library.subscribedAlbums ?? [],
        subscribedArtists: library.subscribedArtists ?? [],
        subscribedUsers: library.subscribedUsers ?? [],
        favorites: library.favorites ?? [],
        recent: library.recent ?? [],
      })
    } catch {
      set({ loading: false })
    }
  },

  async createPlaylist(name, songs) {
    try {
      const playlist = await createLocalPlaylist(name, songs)
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
    } catch (error) {
      // The local API explains why (e.g. the song is already in the playlist).
      toast.error(
        error instanceof Error && error.message ? error.message : i18n._(msg`收藏失败`),
      )
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

  async cacheSubscribedPlaylist(playlist) {
    try {
      const next = await addLocalSubscribedPlaylist(playlist)
      set({ subscribedPlaylists: next })
    } catch {
      // Backfilling a subscribed playlist is best-effort; the normal favorite
      // action still works even if this silent refresh fails.
    }
  },

  async toggleSubscribedAlbum(album) {
    const subscribed = get().subscribedAlbums.some(
      (item) => Number(item.id) === Number(album.id),
    )
    try {
      const next = subscribed
        ? await removeLocalSubscribedAlbum(album.id)
        : await addLocalSubscribedAlbum(album)
      set({ subscribedAlbums: next })
      return !subscribed
    } catch {
      toast.error(i18n._(msg`收藏失败`))
      return null
    }
  },

  async toggleSubscribedArtist(artist) {
    const subscribed = get().subscribedArtists.some(
      (item) => Number(item.id) === Number(artist.id),
    )
    try {
      const next = subscribed
        ? await removeLocalSubscribedArtist(artist.id)
        : await addLocalSubscribedArtist(artist)
      set({ subscribedArtists: next })
      return !subscribed
    } catch {
      toast.error(i18n._(msg`关注失败`))
      return null
    }
  },

  async cacheSubscribedArtist(artist) {
    try {
      const next = await addLocalSubscribedArtist(artist)
      set({ subscribedArtists: next })
    } catch {
      // Backfilling an avatar is best-effort; the follow action still works.
    }
  },

  async toggleSubscribedUser(user) {
    const subscribed = get().subscribedUsers.some(
      (item) => Number(item.userId) === Number(user.userId),
    )
    try {
      const next = subscribed
        ? await removeLocalSubscribedUser(user.userId)
        : await addLocalSubscribedUser({
            userId: user.userId,
            nickname: user.nickname,
            avatarUrl: user.avatarUrl ?? '',
            signature: user.signature,
          })
      set({ subscribedUsers: next })
      return !subscribed
    } catch {
      toast.error(i18n._(msg`关注失败`))
      return null
    }
  },

  async toggleFavorite(song) {
    const liked = get().favorites.some((item) => item.id === song.id)
    if (favoritePending.has(song.id)) return liked
    favoritePending.add(song.id)
    // Show the change immediately; the response then replaces the list.
    set((state) => ({
      favorites: liked
        ? state.favorites.filter((item) => item.id !== song.id)
        : [song, ...state.favorites],
    }))
    try {
      const favorites = liked
        ? await removeLocalFavorite(song.id)
        : await addLocalFavorite(song)
      set({ favorites })
      return !liked
    } catch {
      // Undo only this song so a concurrent toggle of another one survives.
      set((state) => ({
        favorites: liked
          ? state.favorites.some((item) => item.id === song.id)
            ? state.favorites
            : [song, ...state.favorites]
          : state.favorites.filter((item) => item.id !== song.id),
      }))
      toast.error(i18n._(msg`收藏失败`))
      return liked
    } finally {
      favoritePending.delete(song.id)
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
