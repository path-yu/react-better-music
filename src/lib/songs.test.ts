import { describe, expect, it } from 'vitest'
import type { Mv, Playlist } from '../types'
import {
  isPlayable,
  normalizeMv,
  normalizePlaylist,
  normalizeSong,
  normalizeSongs,
} from './songs'

describe('normalizeSong', () => {
  it('unwraps nested song payloads', () => {
    const song = normalizeSong({
      id: 1,
      name: 'outer',
      song: {
        id: 2,
        name: 'inner',
        ar: [],
        al: { id: 0, name: '专辑' },
      },
    })
    expect(song.id).toBe(2)
    expect(song.name).toBe('inner')
  })

  it('falls back to artists, album and duration fields', () => {
    const song = normalizeSong({
      id: 3,
      name: 'x',
      artists: [{ id: 9, name: 'A' }],
      album: { id: 8, name: 'B', picUrl: 'cover' },
      duration: 61_000,
    })
    expect(song.ar).toEqual([{ id: 9, name: 'A' }])
    expect(song.al).toEqual({ id: 8, name: 'B', picUrl: 'cover' })
    expect(song.dt).toBe(61_000)
  })

  it('defaults a missing album and duration', () => {
    const song = normalizeSong({ id: 4, name: 'y' })
    expect(song.al).toEqual({ id: 0, name: '未知专辑', picUrl: undefined })
    expect(song.dt).toBe(0)
  })
})

describe('normalizeSongs', () => {
  it('returns an empty array for non-array input', () => {
    expect(normalizeSongs(undefined)).toEqual([])
    expect(normalizeSongs(null)).toEqual([])
  })

  it('maps raw songs', () => {
    expect(normalizeSongs([{ id: 1, name: 'a' }])).toHaveLength(1)
  })
})

describe('normalizePlaylist', () => {
  it('falls back to picUrl when the cover is missing', () => {
    const playlist = {
      id: 1,
      name: 'p',
      picUrl: 'cover',
      trackCount: 0,
      playCount: 0,
      creator: { userId: 1, nickname: 'n' },
    } as Playlist
    const normalized = normalizePlaylist(playlist)
    expect(normalized.coverImgUrl).toBe('cover')
    expect(normalized.tags).toEqual([])
  })

  it('keeps an existing cover', () => {
    const playlist: Playlist = {
      id: 1,
      name: 'p',
      coverImgUrl: 'cover',
      trackCount: 0,
      playCount: 0,
      creator: { userId: 1, nickname: 'n' },
    }
    expect(normalizePlaylist(playlist).coverImgUrl).toBe('cover')
  })
})

describe('normalizeMv', () => {
  it('fills the cover, artist names and play count', () => {
    const mv: Mv = {
      id: 1,
      name: 'm',
      artists: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
    }
    const normalized = normalizeMv(mv)
    expect(normalized.cover).toBe('')
    expect(normalized.artistName).toBe('A / B')
    expect(normalized.playCount).toBe(0)
  })

  it('prefers explicit fields when present', () => {
    const normalized = normalizeMv({
      id: 2,
      name: 'n',
      cover: 'c',
      artistName: 'X',
      playCount: 12,
    })
    expect(normalized.cover).toBe('c')
    expect(normalized.artistName).toBe('X')
    expect(normalized.playCount).toBe(12)
  })
})

describe('isPlayable', () => {
  it('treats fee 0 as unavailable', () => {
    expect(isPlayable(normalizeSong({ id: 1, name: 'a', fee: 0 }))).toBe(false)
    expect(isPlayable(normalizeSong({ id: 1, name: 'a', fee: 1 }))).toBe(true)
    expect(isPlayable(normalizeSong({ id: 1, name: 'a' }))).toBe(true)
  })
})
