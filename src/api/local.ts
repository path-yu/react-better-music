import { apiUrl } from '../lib/http'
import { fetchWithBootRetry } from '../lib/apiFetch'
import type { Song } from '../types'

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

export interface LocalLibrary {
  version: number
  playlists: LocalPlaylist[]
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
      `本地曲库请求失败 (${response.status})`
    throw new Error(message)
  }
  return (payload as { data?: T })?.data as T
}

export const fetchLocalLibrary = () =>
  localRequest<LocalLibrary>('GET', '/local/library')

export const createLocalPlaylist = (name: string) =>
  localRequest<LocalPlaylist>('POST', '/local/playlists', { name })

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
