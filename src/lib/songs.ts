import type { Album, Artist, Mv, Playlist, Song } from '../types'

export type RawSong = {
  id: number
  name: string
  dt?: number
  duration?: number
  fee?: number
  mv?: number
  mvid?: number
  alia?: string[]
  tns?: string[]
  ar?: Artist[]
  artists?: Artist[]
  al?: Album & { picUrl?: string }
  album?: Album & { picUrl?: string }
  song?: RawSong
}

export function normalizeSong(raw: RawSong): Song {
  const target = raw.song ?? raw
  const ar = target.ar ?? target.artists ?? []
  const al = target.al ?? target.album ?? { id: 0, name: '未知专辑' }
  return {
    id: target.id,
    name: target.name,
    ar,
    al: {
      id: al.id,
      name: al.name,
      picUrl: al.picUrl,
    },
    dt: target.dt ?? target.duration ?? 0,
    fee: target.fee,
    mv: target.mv,
    mvid: target.mvid,
    alia: target.alia,
    tns: target.tns,
  }
}

export function normalizeSongs(list: RawSong[] | undefined | null): Song[] {
  if (!Array.isArray(list)) return []
  return list.map(normalizeSong)
}

export function normalizePlaylist(raw: Playlist): Playlist {
  return {
    ...raw,
    coverImgUrl: raw.coverImgUrl ?? raw.picUrl ?? '',
    tags: raw.tags ?? [],
  }
}

export function normalizeMv(raw: Mv): Mv {
  return {
    ...raw,
    cover: raw.cover ?? raw.picUrl ?? '',
    artistName:
      raw.artistName ??
      (raw.artists?.map((artist) => artist.name).join(' / ') ?? ''),
    playCount: raw.playCount ?? 0,
  }
}

/**
 * A track the UI labels "无音源": NetEase reports `fee === 0` and hands out no
 * media URL. The list tag and the `/song/url/match` gate share this predicate,
 * so the two can never disagree about which rows are eligible for unblocking.
 */
export function hasNoSource(song: Pick<Song, 'fee'>) {
  return song.fee === 0
}

export function isPlayable(song: Song) {
  return !hasNoSource(song)
}
