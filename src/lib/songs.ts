import type { Album, Artist, Mv, NoCopyrightRcmd, Playlist, Song } from '../types'

export type RawSong = {
  id: number
  name: string
  dt?: number
  duration?: number
  fee?: number
  noCopyrightRcmd?: NoCopyrightRcmd | null
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

/** NetEase uses an empty / 纯音乐 lyric for instrumental tracks. */
export function isInstrumentalSong(
  song: Pick<Song, 'lyric' | 'isNotLyric'> | null | undefined,
) {
  if (!song) return false
  return Boolean(song.isNotLyric) || Boolean(song.lyric?.includes('纯音乐，请欣赏'))
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
    noCopyrightRcmd: target.noCopyrightRcmd ?? null,
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

/** Used when a trial payload carries no usable window or file length. */
const DEFAULT_TRIAL_SECONDS = 30

/**
 * Length in seconds of the trial clip returned by `/song/url/v1`, or null
 * when the full track is available.
 *
 * For a trial NetEase serves a separate short file. `freeTrialInfo` only says
 * which part of the original track that clip was cut from (for example
 * `{ start: 87, end: 117 }`), so the clip itself plays from 0 to
 * `end - start`, not to `end`. `fileTimeMs` is the `time` field: the length of
 * the file actually returned, which also caps the result.
 */
export function trialLengthSeconds(
  info: { start?: number | null; end?: number | null } | null | undefined,
  fileTimeMs?: number | null,
): number | null {
  if (!info) return null
  const start = Number(info.start) || 0
  const end = Number(info.end)
  let seconds = Number.isFinite(end) && end > start ? end - start : 0
  // Some payloads report the window in milliseconds.
  if (seconds > 600) seconds /= 1000
  const fileSeconds = Number(fileTimeMs) > 0 ? Number(fileTimeMs) / 1000 : 0
  if (fileSeconds && (!seconds || fileSeconds < seconds)) seconds = fileSeconds
  return seconds > 0 ? Math.max(1, Math.round(seconds)) : DEFAULT_TRIAL_SECONDS
}

/**
 * NetEase's copyright hint for a row (e.g. "其它版本可播"), also rendered as
 * the list tag. Empty means the song carries no hint.
 */
export function copyrightHint(song: Pick<Song, 'noCopyrightRcmd'>) {
  return song.noCopyrightRcmd?.typeDesc?.trim() ?? ''
}
