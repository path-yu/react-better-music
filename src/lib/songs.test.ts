import { describe, expect, it } from 'vitest'
import type { Mv, Playlist } from '../types'
import {
  isInstrumentalSong,
  normalizeMv,
  normalizePlaylist,
  normalizeSong,
  normalizeSongs,
  trialLengthSeconds,
} from './songs'

describe('isInstrumentalSong', () => {
  it('detects NetEase instrumental placeholders', () => {
    expect(
      isInstrumentalSong({
        lyric: '[00:00.00]纯音乐，请欣赏',
      }),
    ).toBe(true)
  })

  it('detects the isNotLyric flag', () => {
    expect(isInstrumentalSong({ isNotLyric: true })).toBe(true)
  })

  it('keeps songs with real lyrics', () => {
    expect(
      isInstrumentalSong({
        lyric: '[00:00.00]故事的小黄花',
        isNotLyric: false,
      }),
    ).toBe(false)
    expect(isInstrumentalSong(undefined)).toBe(false)
  })
})

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

describe('trialLengthSeconds', () => {
  it('returns null for a full track', () => {
    expect(trialLengthSeconds(null)).toBeNull()
    expect(trialLengthSeconds(undefined, 258_902)).toBeNull()
  })

  it('uses the window length, not its end offset', () => {
    expect(trialLengthSeconds({ start: 87, end: 117 })).toBe(30)
    expect(trialLengthSeconds({ start: 0, end: 30 })).toBe(30)
  })

  it('accepts a window reported in milliseconds', () => {
    expect(trialLengthSeconds({ start: 0, end: 30_000 })).toBe(30)
    expect(trialLengthSeconds({ start: 87_000, end: 117_000 })).toBe(30)
  })

  it('falls back to the returned file length', () => {
    expect(trialLengthSeconds({ start: 0, end: 0 }, 29_960)).toBe(30)
    expect(trialLengthSeconds({ start: 0, end: 60 }, 15_000)).toBe(15)
  })

  it('defaults to 30 seconds when nothing usable is reported', () => {
    expect(trialLengthSeconds({})).toBe(30)
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
