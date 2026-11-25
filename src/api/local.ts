import { msg } from '@lingui/core/macro'
import { i18n } from '../i18n'
import { apiUrl } from '../lib/http'
import { fetchWithBootRetry } from '../lib/apiFetch'
import type { Album, ArtistSummary, Playlist, Song } from '../types'

export interface LocalPlaylist {
  id: string
  name: string
  songs: Song[]
  createdAt: number
  updatedAt: number
}

export interface LocalRecent {
  song: Song
  playedAt: number
}

/** A guest-favorited NetEase playlist, including a local track snapshot. */
export interface LocalSubscribedPlaylist extends Playlist {
  songs?: Song[]
}

/** A guest-favorited album; only the fields the album card renders. */
export interface LocalSubscribedAlbum extends Album {
  company?: string
}

/** A guest-followed artist; only the fields the sidebar row renders. */
export interface LocalSubscribedArtist extends ArtistSummary {}

/** A guest-followed account; only the fields the sidebar row renders. */
export interface LocalSubscribedUser {
  userId: number
  nickname: string
  avatarUrl: string
  signature?: string
}

export interface LocalLibrary {
  version: number
  playlists: LocalPlaylist[]
  subscribedPlaylists: LocalSubscribedPlaylist[]
  subscribedAlbums: LocalSubscribedAlbum[]
  subscribedArtists: LocalSubscribedArtist[]
  subscribedUsers: LocalSubscribedUser[]
  favorites: Song[]
  recent: LocalRecent[]
}

async function localRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const request = method === 'GET' ? fetchWithBootRetry : fetch
  const response = await request(apiUrl(path), {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload: unknown = text
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // keep text
  }
  if (!response.ok) {
    const message =
      (payload as { msg?: string; message?: string } | null)?.msg ??
      (payload as { message?: string } | null)?.message ??
      i18n._(msg`本地曲库请求失败 (${response.status})`)
    throw new Error(message)
  }
  return (payload as { data?: T })?.data as T
}

export const fetchLocalLibrary = () =>
  localRequest<LocalLibrary>('GET', '/local/library')

export const createLocalPlaylist = (name: string, songs?: Song[]) =>
  localRequest<LocalPlaylist>('POST', '/local/playlists', { name, songs })

export const renameLocalPlaylist = (id: string, name: string) =>
  localRequest<LocalPlaylist>('PATCH', `/local/playlists/${encodeURIComponent(id)}`, {
    name,
  })

export const deleteLocalPlaylist = (id: string) =>
  localRequest<{ id: string }>(
    'DELETE',
    `/local/playlists/${encodeURIComponent(id)}`,
  )

export const addLocalPlaylistSong = (id: string, song: Song) =>
  localRequest<LocalPlaylist>(
    'POST',
    `/local/playlists/${encodeURIComponent(id)}/songs`,
    { song },
  )

export const removeLocalPlaylistSong = (id: string, songId: number) =>
  localRequest<LocalPlaylist>(
    'DELETE',
    `/local/playlists/${encodeURIComponent(id)}/songs/${songId}`,
  )

export const addLocalSubscribedPlaylist = (
  playlist: LocalSubscribedPlaylist,
) =>
  localRequest<LocalSubscribedPlaylist[]>(
    'POST',
    '/local/subscribed-playlists',
    { playlist },
  )

export const removeLocalSubscribedPlaylist = (playlistId: number) =>
  localRequest<LocalSubscribedPlaylist[]>(
    'DELETE',
    `/local/subscribed-playlists/${playlistId}`,
  )

export const addLocalSubscribedAlbum = (album: LocalSubscribedAlbum) =>
  localRequest<LocalSubscribedAlbum[]>('POST', '/local/subscribed-albums', {
    album,
  })

export const removeLocalSubscribedAlbum = (albumId: number) =>
  localRequest<LocalSubscribedAlbum[]>(
    'DELETE',
    `/local/subscribed-albums/${albumId}`,
  )

export const addLocalSubscribedArtist = (artist: LocalSubscribedArtist) =>
  localRequest<LocalSubscribedArtist[]>('POST', '/local/subscribed-artists', {
    artist,
  })

export const removeLocalSubscribedArtist = (artistId: number) =>
  localRequest<LocalSubscribedArtist[]>(
    'DELETE',
    `/local/subscribed-artists/${artistId}`,
  )

export const addLocalSubscribedUser = (user: LocalSubscribedUser) =>
  localRequest<LocalSubscribedUser[]>('POST', '/local/subscribed-users', {
    user,
  })

export const removeLocalSubscribedUser = (userId: number) =>
  localRequest<LocalSubscribedUser[]>(
    'DELETE',
    `/local/subscribed-users/${userId}`,
  )

export const addLocalFavorite = (song: Song) =>
  localRequest<Song[]>('POST', '/local/favorites', { song })

export const removeLocalFavorite = (songId: number) =>
  localRequest<Song[]>('DELETE', `/local/favorites/${songId}`)

export const recordLocalRecent = (song: Song) =>
  localRequest<LocalRecent[]>('POST', '/local/recent', { song })

export const removeLocalRecent = (songId: number) =>
  localRequest<LocalRecent[]>('DELETE', `/local/recent/${songId}`)

export const clearLocalRecent = () =>
  localRequest<LocalRecent[]>('DELETE', '/local/recent')
