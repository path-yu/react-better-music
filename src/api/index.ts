import type {
  Album,
  AlbumDetail,
  ApiResponse,
  ArtistAlbum,
  ArtistProfile,
  ArtistSummary,
  Banner,
  Comment,
  CommentResponse,
  Mv,
  Playlist,
  SearchResult,
  Song,
  SongPrivilege,
  Toplist,
  ToplistTrack,
  UserDetail,
  UserProfile,
  UserSummary,
  PlayLevel,
  VideoItem,
  VideoSearchItem,
} from '../types'
import { get, invalidateApiCache, postJson, uploadFile } from '../lib/http'
import {
  normalizeMv,
  normalizePlaylist,
  normalizeSongs,
  trialLengthSeconds,
  type RawSong,
} from '../lib/songs'
import {
  relatedVideoFromFeed,
  videoFromMv,
  videoFromSearch,
  type RawRelatedVideoFeed,
} from '../lib/video'

/** The CDN sometimes hands out http media URLs, which the WebView rejects. */
function secureMediaUrl(url: string | null | undefined) {
  if (!url) return null
  return url.replace(/^http:\/\//i, 'https://')
}

/* ------------------------------- discovery ------------------------------- */

export async function fetchBanners() {
  const res = await get<{ code: number; banners: Banner[] }>('/banner')
  return res.banners ?? []
}

export async function fetchPersonalized(limit = 15) {
  const res = await get<{ result: Playlist[] }>('/personalized', { limit })
  return (res.result ?? []).map(normalizePlaylist)
}

/** Daily recommended playlists for the signed-in account. */
export async function fetchDailyRecommendPlaylists(limit = 15) {
  const res = await get<{ recommend?: Playlist[] }>('/recommend/resource')
  return (res.recommend ?? []).map(normalizePlaylist).slice(0, limit)
}

async function fetchDailySongs() {
  const res = await get<{ data?: { dailySongs?: Parameters<typeof normalizeSongs>[0] } }>(
    '/recommend/songs',
  )
  return normalizeSongs(res.data?.dailySongs)
}

export async function fetchDailyRecommendSongs(limit = 12) {
  return (await fetchDailySongs()).slice(0, limit)
}

/** The full daily playlist; the home card only shows the first twelve. */
export async function fetchAllDailyRecommendSongs() {
  return fetchDailySongs()
}

export async function fetchRecommendMv(limit = 4) {
  const res = await get<{ data?: Mv[] }>('/mv/first', { limit })
  return (res.data ?? []).map(normalizeMv)
}

export async function fetchNewSongs(type: 0 | 7 | 96 | 8 | 16 = 0) {
  const res = await get<{ data?: Parameters<typeof normalizeSongs>[0] }>('/top/song', { type })
  return normalizeSongs(res.data)
}

/* ------------------------------ listening -------------------------------- */

interface RawRecentSongEntry {
  song?: RawSong
  songInfo?: RawSong
  data?: RawSong
  id?: number
}

/**
 * `/record/recent/song` nests the playable song under `song` (the weapi
 * response also uses `songInfo`/`data` on some storefronts). Normalise all
 * shapes so the table always gets complete Song objects.
 */
export async function fetchRecentSongs(limit = 100) {
  const res = await get<{ data?: { list?: RawRecentSongEntry[] } }>(
    '/record/recent/song',
    { limit },
  )
  const raw = (res.data?.list ?? [])
    .map((entry) => {
      const nested = entry.song ?? entry.songInfo ?? entry.data
      if (nested) return nested
      return entry.id ? (entry as unknown as RawSong) : null
    })
    .filter((song): song is RawSong => Boolean(song))
  return normalizeSongs(raw).slice(0, limit)
}

/* -------------------------------- playlist ------------------------------- */

export async function fetchTopPlaylists(options: {
  cat?: string
  limit?: number
  before?: number | string
}) {
  const res = await get<{ playlists?: Playlist[]; more?: boolean }>(
    '/top/playlist/highquality',
    {
      cat: options.cat ?? '全部',
      limit: options.limit ?? 20,
      before: options.before,
    },
  )
  return {
    playlists: (res.playlists ?? []).map(normalizePlaylist),
    more: Boolean(res.more),
  }
}

export async function fetchPlaylistTags() {
  const res = await get<{ tags?: Array<{ id: number; name: string }> }>(
    '/playlist/highquality/tags',
  )
  return res.tags ?? []
}

const TRACK_PAGE_SIZE = 300
const TRACK_FETCH_CONCURRENCY = 3

/** Official NetEase charts, including their top tracks. */
export async function fetchToplists(signal?: AbortSignal) {
  const res = await get<{
    list?: Array<
      Omit<Toplist, 'coverImgUrl'> & {
        coverImgUrl?: string
        coverUrl?: string
        tracks?: ToplistTrack[]
      }
    >
  }>('/toplist/detail', { timestamp: Date.now() }, signal)
  return (res.list ?? []).map((item) => ({
    ...item,
    coverImgUrl: item.coverImgUrl ?? item.coverUrl ?? '',
    tracks: (item.tracks ?? []).map((track, index) => ({
      ...track,
      id: track.id ?? index,
      name: track.name ?? track.first ?? '',
    })),
  }))
}

export async function fetchPlaylistDetail(id: string | number, signal?: AbortSignal) {
  const res = await get<{ playlist: Playlist }>(
    '/playlist/detail',
    { id, timestamp: Date.now() },
    signal,
  )
  return normalizePlaylist(res.playlist)
}

export async function fetchPlaylistRecommendations(
  id: string | number,
  signal?: AbortSignal,
) {
  const res = await get<{
    data?: {
      rcmdTitle?: string
      recPlaylist?: Array<{ playlist?: Partial<Playlist> }>
    }
  }>('/playlist/detail/rcmd/get', { id }, signal)
  const playlists = (res.data?.recPlaylist ?? [])
    .map((entry) => entry.playlist)
    .filter((item): item is Partial<Playlist> => Boolean(item?.id && item.name))
    .map((item) =>
      normalizePlaylist({
        ...item,
        id: Number(item.id),
        name: item.name ?? '',
        trackCount: item.trackCount ?? 0,
        playCount: item.playCount ?? 0,
        creator:
          item.creator ?? { userId: 0, nickname: '' },
        coverImgUrl: item.coverImgUrl ?? item.picUrl ?? '',
      } as Playlist),
    )
  return {
    title: res.data?.rcmdTitle?.trim() ?? '',
    playlists,
  }
}

/** Resolve a 163cn.tv share link to its final playlist URL. */
export async function resolvePlaylistLink(url: string, proxy?: string) {
  return get<{ code?: number; url?: string; msg?: string }>(
    '/link/resolve',
    proxy ? { url, proxy } : { url },
  )
}

export type ApplePlaylistTrack = {
  id: string
  name: string
  artist: string
  album: string
  duration: number
  artwork: string
}

/** Read an Apple Music playlist through the desktop API. */
export async function fetchApplePlaylist(url: string, proxy?: string) {
  return get<{
    code?: number
    title?: string
    coverUrl?: string
    tracks?: ApplePlaylistTrack[]
    msg?: string
  }>('/apple/playlist', proxy ? { url, proxy } : { url })
}

/** Read a QQ Music playlist through the desktop API. */
export async function fetchQqPlaylist(url: string, proxy?: string) {
  return get<{
    code?: number
    title?: string
    coverUrl?: string
    tracks?: ApplePlaylistTrack[]
    msg?: string
  }>('/qq/playlist', proxy ? { url, proxy } : { url })
}

/** Read a YouTube Music playlist through the desktop API. */
export async function fetchYoutubePlaylist(url: string, proxy?: string) {
  return get<{
    code?: number
    title?: string
    coverUrl?: string
    tracks?: ApplePlaylistTrack[]
    msg?: string
  }>('/youtube/playlist', proxy ? { url, proxy } : { url })
}

/** Create a playlist in the signed-in user's NetEase account. */
export async function createPlaylist(name: string) {
  return get<{
    code?: number
    id?: number
    playlist?: { id?: number }
  }>('/playlist/create', { name, timestamp: Date.now() })
}

const PLAYLIST_MUTATION_PREFIXES = ['/playlist/detail', '/playlist/track/all']

/** Track edits change detail/track reads that are cached for five minutes. */
const invalidatePlaylistReads = () => invalidateApiCache(PLAYLIST_MUTATION_PREFIXES)

/** Add one or more tracks to a signed-in user's playlist. */
export async function addTracksToPlaylist(
  playlistId: number | string,
  trackIds: Array<number | string>,
) {
  return get<{
    code?: number
    status?: number
    body?: { code?: number; message?: string }
  }>('/playlist/tracks', {
    op: 'add',
    pid: playlistId,
    tracks: trackIds.join(','),
    timestamp: Date.now(),
  }).finally(invalidatePlaylistReads)
}

/** Add a track to one of the signed-in user's playlists. */
export async function addSongToPlaylist(
  playlistId: number | string,
  trackId: number | string,
) {
  return addSongsToPlaylist(playlistId, [trackId])
}

/** Add several tracks in one `/playlist/tracks` call (comma-separated ids). */
export async function addSongsToPlaylist(
  playlistId: number | string,
  trackIds: Array<number | string>,
) {
  return get<{
    code?: number
    status?: number
    body?: { code?: number; message?: string }
  }>('/playlist/tracks', {
    op: 'add',
    pid: playlistId,
    tracks: trackIds.join(','),
    timestamp: Date.now(),
  }).finally(invalidatePlaylistReads)
}

/** Remove a track from one of the signed-in user's playlists. */
export async function removeSongFromPlaylist(
  playlistId: number | string,
  trackId: number | string,
) {
  return get<{
    code?: number
    status?: number
    body?: { code?: number; message?: string }
  }>('/playlist/tracks', {
    op: 'del',
    pid: playlistId,
    tracks: String(trackId),
    timestamp: Date.now(),
  }).finally(invalidatePlaylistReads)
}

export async function fetchPlaylistTracks(
  id: string | number,
  limit = TRACK_PAGE_SIZE,
  offset = 0,
  signal?: AbortSignal,
) {
  const res = await get<{ songs?: Parameters<typeof normalizeSongs>[0] }>(
    '/playlist/track/all',
    { id, limit, offset, timestamp: Date.now() },
    signal,
  )
  return normalizeSongs(res.songs)
}

/** Pause before retrying failed pages; the local API rate-limits bursts. */
const TRACK_RETRY_DELAY = 800

/**
 * Load the pages after the first one with bounded concurrency. A 5000-track
 * playlist used to fire 16 parallel requests at once, which the local API
 * rate-limits.
 *
 * Failed pages are retried once. Results are placed by page index, so a page
 * that only succeeds on retry still lands in playlist order. `failedPages`
 * counts pages that are still missing, so the caller can tell the user
 * instead of silently showing (and playing) a shorter playlist.
 */
export async function fetchRemainingPlaylistTracks(
  id: string | number,
  trackCount: number,
  signal?: AbortSignal,
): Promise<{ songs: Song[]; failedPages: number }> {
  const pages = Math.max(
    0,
    Math.ceil((trackCount - TRACK_PAGE_SIZE) / TRACK_PAGE_SIZE),
  )
  const results: Array<Song[] | undefined> = new Array(pages)

  const runPages = async (pageIndexes: number[]) => {
    const failed: number[] = []
    for (let start = 0; start < pageIndexes.length; start += TRACK_FETCH_CONCURRENCY) {
      if (signal?.aborted) break
      const batch = pageIndexes.slice(start, start + TRACK_FETCH_CONCURRENCY)
      const settled = await Promise.allSettled(
        batch.map((page) =>
          fetchPlaylistTracks(id, TRACK_PAGE_SIZE, (page + 1) * TRACK_PAGE_SIZE, signal),
        ),
      )
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') results[batch[index]] = result.value
        else failed.push(batch[index])
      })
    }
    return failed
  }

  let failed = await runPages(Array.from({ length: pages }, (_, index) => index))
  if (failed.length && !signal?.aborted) {
    await new Promise((resolve) => window.setTimeout(resolve, TRACK_RETRY_DELAY))
    if (!signal?.aborted) failed = await runPages(failed)
  }

  return {
    songs: results.flatMap((page) => page ?? []),
    failedPages: signal?.aborted ? 0 : failed.length,
  }
}

export async function updatePlaylistInfo(params: {
  id: string | number
  name: string
  tags: string
  desc: string
}) {
  const res = await get<ApiResponse>('/playlist/update', { ...params, timestamp: Date.now() })
  if (res.code === 200) invalidateApiCache(PLAYLIST_MUTATION_PREFIXES)
  return res
}

export async function updatePlaylistCover(file: File, imgSize: number, id: string | number) {
  const res = await uploadFile<{ code: number; data?: { url: string } }>(
    '/playlist/cover/update',
    file,
    {
      timestamp: Date.now(),
      imgSize,
      id,
    },
  )
  if (res.code === 200) invalidateApiCache(PLAYLIST_MUTATION_PREFIXES)
  return res
}

export async function updatePlaylistSubscribe(params: { id: string | number; t: 1 | 2 }) {
  const res = await get<ApiResponse>('/playlist/subscribe', { ...params, timestamp: Date.now() })
  // `subscribed` is part of the detail payload; a cached copy would show the
  // pre-toggle state when the user navigates back within the TTL.
  if (res.code === 200) invalidateApiCache(['/playlist/detail'])
  return res
}

/* ---------------------------------- song --------------------------------- */

/**
 * Resolve the full song metadata when only an id survives (cached audio).
 * `/song/detail` returns rights in a sibling `privileges` array rather than
 * inside each song, so fold them back in — list rows and the scrobble skip
 * both read `song.privilege`.
 */
export async function fetchSongDetail(id: number | string) {
  const res = await get<{ songs?: Song[]; privileges?: SongPrivilege[] }>(
    '/song/detail',
    { ids: id },
  )
  const song = res.songs?.[0]
  if (!song) return null
  const privilege = res.privileges?.find(
    (item) => Number(item.id) === Number(song.id),
  )
  return privilege ? { ...song, privilege } : song
}

/**
 * Per-track rights for a whole list in one (or a few) `/song/detail` calls.
 * Album payloads occasionally omit `st` / `privilege` for a row, which made
 * the 无版权 tag disappear; `privileges` is the authoritative fallback.
 */
export async function fetchSongPrivileges(ids: number[]) {
  const privileges = new Map<number, SongPrivilege>()
  const CHUNK = 200
  for (let index = 0; index < ids.length; index += CHUNK) {
    const chunk = ids.slice(index, index + CHUNK)
    if (!chunk.length) continue
    const res = await get<{ privileges?: SongPrivilege[] }>('/song/detail', {
      ids: chunk.join(','),
    })
    for (const privilege of res.privileges ?? []) {
      const id = Number(privilege.id)
      if (Number.isSafeInteger(id) && id > 0) privileges.set(id, privilege)
    }
  }
  return privileges
}

/** NetEase's recommended playable edition for a grey copyright track. */
export async function fetchSongCopyrightRecommendation(id: number | string) {
  const res = await get<{ data?: { rcmd?: Song | null } }>(
    '/song/copyright/rcmd',
    { songid: id },
  )
  return res.data?.rcmd ?? null
}

export async function fetchSongUrlInfo(id: number | string, level: PlayLevel = 'exhigh') {
  const res = await get<{
    data?: Array<{
      url: string | null
      /** Length of the returned file in ms (the clip itself for a trial). */
      time?: number
      freeTrialInfo?: { start?: number; end?: number } | null
    }>
  }>('/song/url/v1', { id, level })
  const item = res.data?.[0]
  return {
    url: secureMediaUrl(item?.url),
    /**
     * Length in seconds of the trial clip (it starts at 0 in the returned
     * file); null when the full track is available.
     */
    trialEnd: trialLengthSeconds(item?.freeTrialInfo, item?.time),
  }
}

export async function fetchSongUrl(id: number | string, level: PlayLevel = 'exhigh') {
  const { url } = await fetchSongUrlInfo(id, level)
  return url
}

/** Pull a URL out of the match endpoint's loose payload (string, array or object). */
function matchedUrl(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) return matchedUrl(payload[0])
  if (payload && typeof payload === 'object') {
    const url = (payload as { url?: unknown }).url
    if (typeof url === 'string') return url
  }
  return ''
}

/**
 * Gray-track rescue: the local API matches the song on another provider
 * (UnblockNeteaseMusic). The URL may point at a NetEase CDN host or a
 * third-party CDN; callers decide whether the media proxy accepts it.
 */
export async function fetchMatchedSongUrl(id: number | string, source?: string) {
  const res = await get<{
    code?: number
    data?: unknown
    source?: string
    proxyUrl?: string
    msg?: string
    webUrl?: string
  }>('/song/url/match', source ? { id, source } : { id })
  return {
    url: matchedUrl(res.data) || res.proxyUrl || '',
    source: res.source || '',
    // Only video-site sources have a page to link back to.
    webUrl: res.webUrl || '',
  }
}

export interface SourceCandidate {
  id: string
  title: string
  author: string
  cover: string
  duration: number
  views: number
  score: number
  webUrl: string
}

export type VideoSource = 'bilibili' | 'youtube'

/** Candidate videos for the source picker (metadata only, no stream URLs). */
export async function fetchSourceCandidates(
  id: number | string,
  source: VideoSource,
  signal?: AbortSignal,
) {
  const res = await get<{
    data?: { source?: string; items?: SourceCandidate[] }
  }>('/song/url/sources', { id, source }, signal)
  return res.data?.items ?? []
}

export interface QqSongMatch {
  name: string
  singers: string
  album: string
  duration: number
  /** Recording id on QQ Music; stable across name variations. */
  songmid?: string
  /** Release id on QQ Music, used to dedupe the same album. */
  albummid?: string
  /** QQ pay flag: 1 marks the paid original rather than a free re-upload. */
  pay?: number
}

/**
 * QQ Music search used as a second opinion for the album name: NetEase's own
 * search index cannot find the album of a delisted track, while QQ keeps the
 * original release metadata.
 */
export async function fetchQqSongMatches(
  keyword: string,
  signal?: AbortSignal,
): Promise<QqSongMatch[]> {
  const res = await get<{ data?: { songs?: QqSongMatch[] } }>(
    '/qq/search',
    { keyword },
    signal,
  )
  return res.data?.songs ?? []
}

/** Resolve the audio stream of one chosen candidate. */
export async function fetchVideoSourceUrl(
  source: VideoSource,
  videoId: string,
) {
  const res = await get<{
    data?: { url?: string; duration?: number; webUrl?: string }
  }>('/song/url/video', { source, vid: videoId })
  return {
    url: res.data?.url ?? '',
    duration: res.data?.duration ?? 0,
    webUrl: res.data?.webUrl ?? '',
  }
}

/**
 * Availability verdict for an *undecided* gray track (`fee === 0` with no
 * `noCopyrightRcmd` hint). Normal tracks never need it. `br` defaults to
 * 999000 (highest bitrate) server-side.
 */
/**
 * Report a completed listen. The desktop API implements the PC-client PLV/PLD
 * upload; callers should only invoke this once per real playback session.
 */
export async function scrobbleSong(params: {
  id: number
  time: number
  total: number
  name: string
  artist: string
  bitrate?: number
  level?: string
  vip?: boolean
  sourceid?: string
  source?: string
}) {
  return postJson<{ code?: number; msg?: string; data?: unknown }>(
    '/scrobble/v1',
    params,
  )
}

export async function checkMusicAvailable(id: number | string, br?: number) {
  const res = await get<{ success?: boolean; musicSuccess?: boolean; message?: string }>(
    '/check/music',
    br ? { id, br } : { id },
  )
  return Boolean(res.success ?? res.musicSuccess)
}

export async function fetchLyric(id: number | string) {
  const res = await get<{
    lrc?: { lyric?: string }
    tlyric?: { lyric?: string }
    yrc?: { lyric?: string }
  }>('/lyric/new', { id })
  return {
    lyric: res.lrc?.lyric ?? '',
    tlyric: res.tlyric?.lyric ?? '',
    yrc: res.yrc?.lyric ?? '',
  }
}

/**
 * Start of the chorus in milliseconds (`/song/chorus`), or null when NetEase
 * has no chorus marker for the track or the endpoint is unavailable. The
 * payload shape is not documented, so look for the first `startTime`.
 */
export async function fetchSongChorusStart(id: number) {
  try {
    const res = await get<Record<string, unknown>>('/song/chorus', { id })
    const candidates = [res.chorus, (res.data as Record<string, unknown> | undefined)?.chorus, res.data]
    for (const candidate of candidates) {
      const list = Array.isArray(candidate) ? candidate : candidate ? [candidate] : []
      for (const item of list) {
        if (!item || typeof item !== 'object') continue
        const start = Number((item as { startTime?: unknown }).startTime)
        if (Number.isFinite(start) && start > 0) return start
      }
    }
    return null
  } catch {
    return null
  }
}

export async function likeMusic(id: number, like: boolean) {
  return get<ApiResponse>('/like', { id, like })
}

/* -------------------------------- comments ------------------------------- */

type CommentQuery = {
  id: string | number
  limit?: number
  offset?: number
  before?: number
}

export function fetchMusicComments(params: CommentQuery, signal?: AbortSignal) {
  return get<CommentResponse>('/comment/music', { ...params, timestamp: Date.now() }, signal)
}

export function fetchPlaylistComments(params: CommentQuery, signal?: AbortSignal) {
  return get<CommentResponse>('/comment/playlist', { ...params, timestamp: Date.now() }, signal)
}

export function fetchMvComments(params: CommentQuery, signal?: AbortSignal) {
  return get<CommentResponse>('/comment/mv', { ...params, timestamp: Date.now() }, signal)
}

export function sendComment(params: {
  t: number
  type: number
  id: number
  content: string
  commentId?: number
}) {
  return get<{ code: number; comment?: Comment }>('/comment', {
    ...params,
    timestamp: Date.now(),
  })
}

export function likeComment(params: {
  t: number
  cid: number
  type: number
  id: number
}) {
  return get<ApiResponse>('/comment/like', { ...params, timestamp: Date.now() })
}

/* ----------------------------------- mv ---------------------------------- */

export async function fetchMvList(
  options: {
    limit?: number
    offset?: number
    area?: string
    order?: string
    type?: string
  },
  signal?: AbortSignal,
) {
  const res = await get<{ data?: Mv[]; count?: number }>('/mv/all', {
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    area: options.area ?? '全部',
    order: options.order ?? '最热',
    type: options.type ?? '全部',
  }, signal)
  return {
    list: (res.data ?? []).map(normalizeMv),
    count: res.count ?? 0,
  }
}

export async function fetchMvDetail(mvid: number | string) {
  const res = await get<{ data?: Mv }>('/mv/detail', { mvid })
  return res.data ? normalizeMv(res.data) : null
}

export async function fetchMvUrl(id: number | string, signal?: AbortSignal) {
  const res = await get<{ data?: { url?: string } }>('/mv/url', { id }, signal)
  const url = secureMediaUrl(res.data?.url) ?? ''
  if (!url) return ''
  // Removed/region-locked MVs still get a signed URL from the API, but the
  // CDN returns a 404 body with a video content type. Probe before mounting
  // <video> so Video.js never reports MEDIA_ELEMENT_ERROR: Format error.
  return (await isPlayableVideoUrl(url, signal)) ? url : ''
}

/**
 * A `src` pointing at an HTML error body still fires a media error in the
 * <video> element, which surfaces as the ugly MEDIA_ELEMENT_ERROR: Format
 * error panel. Probe the first byte first and reject dead CDN URLs.
 */
async function isPlayableVideoUrl(url: string, signal?: AbortSignal) {
  try {
    // Probe through the local API: the video CDN's CORS behavior differs
    // between WebView2 versions, and a failed cross-origin probe used to be
    // mistaken for a playable URL.
    const response = await get<{ ok?: boolean }>(
      '/media/probe',
      { url },
      signal,
    )
    return response.ok === true
  } catch {
    // If the API is still starting, do not hide a URL that might work.
    return true
  }
}

/** User-uploaded videos from `/cloudsearch?type=1014`. */
export async function fetchVideoUrl(id: number | string, signal?: AbortSignal) {
  const res = await get<{
    urls?: Array<{ url?: string }>
    data?: { url?: string }
  }>('/video/url', { id }, signal)
  const direct = secureMediaUrl(res.urls?.[0]?.url ?? res.data?.url)
  if (direct && (await isPlayableVideoUrl(direct, signal))) return direct

  // The cloud-search video list also contains MV ids (type 0). For those,
  // `/video/url` returns `{ urls: [] }`; the same id resolves through
  // `/mv/url`. Some MVs are removed/region-locked and the CDN still returns a
  // signed URL whose body is a 404, so validate the fallback as well.
  try {
    const mv = await get<{ data?: { url?: string } }>('/mv/url', { id }, signal)
    const mvUrl = secureMediaUrl(mv.data?.url)
    if (!mvUrl) return ''
    return (await isPlayableVideoUrl(mvUrl, signal)) ? mvUrl : ''
  } catch {
    return ''
  }
}

/** Mlog clips are served by `/mlog/url`, not `/video/url`. */
export async function fetchMlogUrl(id: number | string, signal?: AbortSignal) {
  const res = await get<{
    data?: {
      resource?: {
        content?: {
          video?: {
            urlInfos?: Array<{ url?: string }>
            urlInfo?: { url?: string }
          }
        }
      }
    }
  }>('/mlog/url', { id }, signal)
  const video = res.data?.resource?.content?.video
  return secureMediaUrl(video?.urlInfos?.[0]?.url ?? video?.urlInfo?.url) ?? ''
}

/**
 * Videos attached to a song. The Mlog recommendation endpoint is useful for
 * clips, but it is not an official MV search; resolve the song's own MV (or an
 * exact title/artist MV search) first so the entry point never opens a random
 * TV-performance clip when a real MV exists.
 */
export async function fetchRelatedVideos(
  song: Pick<Song, 'id' | 'name' | 'ar' | 'mv' | 'mvid'>,
  limit = 12,
  signal?: AbortSignal,
  officialOnly = false,
) {
  const official: VideoItem[] = []
  const relatedSearch: VideoItem[] = []
  const mvId = song.mv ?? song.mvid
  const artistNames = new Set(
    (song.ar ?? []).map((artist) => artist.name.trim().toLowerCase()),
  )
  const canonicalTitle = (value: string) =>
    value
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  const songTitle = canonicalTitle(song.name)

  const scoreMv = (mv: VideoItem) => {
    const title = canonicalTitle(mv.title)
    const artist = (mv.artist ?? '').trim().toLowerCase()
    let score = 0
    if (title === songTitle) score += 100
    else if (title.includes(songTitle) || songTitle.includes(title)) score += 55
    else return -1
    if (!artistNames.size || [...artistNames].some((name) => artist.includes(name))) {
      score += 40
    } else {
      return -1
    }
    // Prefer the studio/official cut over live, programme or behind-the-scenes
    // clips that NetEase sometimes stores as the song's `mv` reference.
    if (/live|现场|演唱会|节目|花絮|翻唱|合唱/i.test(mv.title)) score -= 30
    return score
  }

  // Search by song + artist first. A song's `mv` field can point at a TV
  // programme or teaser rather than the official MV (e.g. 我怀念的 → 5484821),
  // so never trust that id without matching its title and artist.
  try {
    const query = [song.name, ...(song.ar ?? []).map((artist) => artist.name)]
      .filter(Boolean)
      .join(' ')
    const result = await searchAll(
      { keywords: query, type: '1004', limit: 8 },
      signal,
    )
    const candidates = (result.mvs ?? [])
      .map((video) => ({ video, score: scoreMv(video) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)

    for (const item of candidates) {
      const exact = canonicalTitle(item.video.title) === songTitle
      const video = { ...item.video, official: exact }
      if (exact) {
        if (official.length < 3) official.push(video)
      } else if (relatedSearch.length < 3) {
        // Documentaries/live programmes are related videos, not the MV badge.
        relatedSearch.push(video)
      }
      if (official.length >= 3 && relatedSearch.length >= 3) break
    }
  } catch {
    // Fall through to the song's mv id and then Mlog recommendations.
  }

  if (!official.length && mvId && Number(mvId) > 0) {
    try {
      const detail = await fetchMvDetail(mvId)
      if (detail) {
        const candidate = videoFromMv(detail)
        if (scoreMv(candidate) > 0) {
          const exact = canonicalTitle(candidate.title) === songTitle
          const video = { ...candidate, official: exact }
          if (exact) official.push(video)
          else relatedSearch.push(video)
        }
      }
    } catch {
      // Keep Mlog recommendations as the fallback.
    }
  }

  // The MV badge only needs the official result; skip the slower clip feed.
  if (officialOnly) return official.slice(0, limit)

  const res = await get<{ data?: { feeds?: RawRelatedVideoFeed[] } }>(
    '/mlog/music/rcmd',
    // A zero `mv` means "no MV"; sending it makes the endpoint skip the list.
    { songid: song.id, mvid: mvId && Number(mvId) > 0 ? mvId : undefined, limit },
    signal,
  )
  const clips = (res.data?.feeds ?? [])
    .map(relatedVideoFromFeed)
    .filter((item): item is VideoItem => Boolean(item))

  const seen = new Set<string>()
  return [...official, ...relatedSearch, ...clips]
    .filter((item) => {
      const key = `${item.kind}:${item.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

export async function fetchSimilarMv(mvid: number | string) {
  const res = await get<{ mvs?: Mv[] }>('/simi/mv', { mvid })
  return (res.mvs ?? []).map(normalizeMv)
}

/**
 * `/simi/mv` currently returns a generic interview list for many unrelated ids.
 * Recommend other MVs by the same artist instead, filtering programme clips and
 * the current MV so every detail page gets a distinct, relevant list.
 */
export async function fetchRelatedMvs(mv: Mv, limit = 8) {
  if (!mv.artistId) return []
  const NOISE = /超级面对面|访谈|花絮|节目|采访|预告|幕后|邀你一起听/i
  const list = await fetchArtistMvs(mv.artistId, Math.max(limit * 3, 24))
  const seen = new Set<number>()
  return list
    .filter((item) => {
      if (item.id === mv.id || NOISE.test(item.name) || seen.has(item.id)) {
        return false
      }
      seen.add(item.id)
      return true
    })
    .slice(0, limit)
}

export async function fetchArtistDetail(id: number | string) {
  const res = await get<{
    artist?: {
      id: number
      name: string
      picUrl?: string
      briefDesc?: string
    }
  }>('/artists', { id })
  return res.artist ?? null
}

/* --------------------------------- search -------------------------------- */

export async function fetchDefaultSearchKeyword() {
  const res = await get<{ data?: { showKeyword?: string; realkeyword?: string } }>(
    '/search/default',
  )
  // `showKeyword` is display copy ("🔥 大家都在搜 疑心病"); `realkeyword` is the
  // actual query ("疑心病"). Keep them apart so the placeholder can stay
  // editorial while submitting the empty field searches the real keyword.
  const showKeyword = res.data?.showKeyword?.trim() ?? ''
  const realKeyword = res.data?.realkeyword?.trim() ?? ''
  return {
    showKeyword: showKeyword || realKeyword,
    realKeyword:
      realKeyword || showKeyword.replace(/^[^\p{L}\p{N}]+/u, '').trim() || showKeyword,
  }
}

export async function fetchHotSearchList() {
  const res = await get<{
    data?: Array<{ searchWord: string; score: number; content?: string }>
  }>('/search/hot/detail')
  return res.data ?? []
}

export async function fetchSearchSuggest(keywords: string, signal?: AbortSignal) {
  const res = await get<{
    result?: {
      songs?: Parameters<typeof normalizeSongs>[0]
      playlists?: Playlist[]
    }
  }>('/search/suggest', { keywords }, signal)
  return {
    songs: normalizeSongs(res.result?.songs).slice(0, 6),
    playlists: (res.result?.playlists ?? []).slice(0, 4).map(normalizePlaylist),
  }
}

type RawSearchResult = {
  songs?: Parameters<typeof normalizeSongs>[0]
  playlists?: Playlist[]
  albums?: Album[]
  albumCount?: number
  artists?: ArtistSummary[]
  mvs?: Mv[]
  videos?: VideoSearchItem[]
  userprofiles?: UserSummary[]
  userprofileCount?: number
  [key: string]: unknown
}

/** Resolve an artist by name for playlist creators that are artist accounts. */
export async function searchArtists(keywords: string, signal?: AbortSignal) {
  const result = await searchAll(
    { keywords, type: '100', limit: 5 },
    signal,
  )
  return result.artists ?? []
}

export async function searchAll(params: {
  keywords: string
  type: '1' | '10' | '100' | '1000' | '1002' | '1004' | '1014'
  limit?: number
  offset?: number
}, signal?: AbortSignal) {
  const res = await get<{ result?: RawSearchResult }>('/cloudsearch', {
    ...params,
    limit: params.limit ?? 30,
    offset: params.offset ?? 0,
    timestamp: Date.now(),
  }, signal)
  const result = res.result ?? {}
  return {
    ...result,
    songs: normalizeSongs(result.songs),
    playlists: (result.playlists ?? []).map(normalizePlaylist),
    albums: (result.albums ?? []).map((album) => ({
      ...album,
      picUrl: album.picUrl ?? album.blurPicUrl,
      artist: album.artist ?? album.artists?.[0],
    })),
    albumCount: result.albumCount ?? 0,
    artists: result.artists ?? [],
    mvs: (result.mvs ?? []).map(normalizeMv).map(videoFromMv),
    videos: (result.videos ?? [])
      .map(videoFromSearch)
      .filter((item): item is VideoItem => Boolean(item)),
    users: result.userprofiles ?? [],
    userCount: result.userprofileCount ?? 0,
  } as SearchResult
}

/* ------------------------------ deep search ------------------------------ */

export interface DeepSearchHit {
  song: Song
  albumId: number
  albumName: string
}

/**
 * NetEase's song index only contains licensed tracks, so a grey original is
 * missing from `/cloudsearch?type=1` even though its album still lists it.
 * Search albums instead, then scan their track lists — the same route a user
 * takes by browsing 歌手 / 专辑.
 */
const DEEP_SEARCH_ALBUM_LIMIT = 16
const DEEP_SEARCH_TTL = 5 * 60_000
const DEEP_SEARCH_GAP = 350
const DEEP_SEARCH_RETRY_DELAY = 600
const DEEP_SEARCH_RATE_LIMIT_COOLDOWN = 2_000

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))
const deepSearchCache = new Map<
  string,
  { at: number; hits: DeepSearchHit[] }
>()

let deepAlbumRequestAt = 0
let deepAlbumCooldownUntil = 0

/**
 * `/album` starts answering 405 when requests are fired in bursts. One shared
 * schedule keeps both workers below that threshold, and a 405 pauses every
 * worker instead of letting them retry into the same limiter.
 */
async function fetchDeepSearchAlbum(id: number, signal?: AbortSignal) {
  const wait = Math.max(
    deepAlbumCooldownUntil - Date.now(),
    deepAlbumRequestAt + DEEP_SEARCH_GAP - Date.now(),
    0,
  )
  if (wait > 0) await sleep(wait)
  if (signal?.aborted) return null
  deepAlbumRequestAt = Date.now()
  try {
    return await fetchAlbumDetail(id, signal)
  } catch (error) {
    if ((error as { status?: number }).status === 405) {
      deepAlbumCooldownUntil = Date.now() + DEEP_SEARCH_RATE_LIMIT_COOLDOWN
    }
    throw error
  }
}

function normalizeDeep(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_—·()（）[\]【】「」'"“”,，.。!！?？/]/g, '')
}

/**
 * Fuzzy containment for user typos: "爱情公寓3原生" must still match the album
 * "爱情公寓3原声大碟" (原生 vs 原声). A miss is retried without the last one or
 * two characters, which only loosens the tail — an unrelated text of the same
 * length still cannot match a real prefix.
 */
function looseTokenMatch(text: string, token: string) {
  if (!token) return false
  if (text.includes(token)) return true
  for (let cut = 1; cut <= 2; cut += 1) {
    const trimmed = token.slice(0, -cut)
    if (trimmed.length >= 4 && text.includes(trimmed)) return true
  }
  return false
}

/** Uploads that are a different recording of the same title. */
const DEEP_DECORATED =
  /(live|remix|dj|bootleg|cover|翻唱|翻跳|伴奏|纯音乐|instrumental|8d|nightcore|slowed|sped\s*up|08x|v\d|加速|降速|慢速|变速|升调|降调|说唱版|片段|剪辑|铃声|女声版|男声版|\d(?:\.\d)?x)/i

/** Decoration words the user did not ask for; a remix must not beat the原曲. */
const STRONG_DECORATION =
  /(慢速|变速|升调|降调|加速|降速|说唱版|remix|dj|live|伴奏|纯音乐|instrumental|8d|nightcore|slowed|sped\s*up|08x|v\d|翻跳|片段|剪辑|铃声|女声版|男声版|\d(?:\.\d)?x)/i

/**
 * Whether a decorated upload is still an acceptable answer. A cover is fine
 * only when it credits the requested artist (the user's own track may be one);
 * a slowed-down or rap version is never the original unless asked for.
 */
function decoratedAllowed(song: Song, tokens: string[]) {
  const name = normalizeDeep(song.name)
  const strong = name.match(STRONG_DECORATION)
  if (strong) {
    return tokens.some(
      (token) => token.includes(strong[0]) || strong[0].includes(token),
    )
  }
  if (/(cover|翻唱)/.test(name)) {
    const artists = song.ar.map((artist) => normalizeDeep(artist.name))
    return tokens.some((token) =>
      artists.some((artist) => artist === token || artist.includes(token)),
    )
  }
  return true
}

/**
 * A web hit must cover every query word somewhere, and the song title must
 * appear in the name. The album is part of the context on purpose: "爱的回归线
 * 爱情公寓" only matches because the album is 《爱情公寓3原声大碟》.
 */
function webHitMatches(song: Song, tokens: string[]) {
  const name = normalizeDeep(song.name)
  const artists = song.ar.map((artist) => normalizeDeep(artist.name)).join(' ')
  const album = normalizeDeep(song.al?.name ?? '')
  const context = `${name} ${artists} ${album}`
  if (tokens.length === 1) return looseTokenMatch(name, tokens[0])
  return (
    tokens.every((token) => looseTokenMatch(context, token)) &&
    tokens.some((token) => looseTokenMatch(name, token))
  )
}

function deepMatchScore(song: Song, albumName: string, tokens: string[]) {
  const name = normalizeDeep(song.name)
  const artistParts = song.ar.map((artist) => normalizeDeep(artist.name))
  const artists = artistParts.join(' ')
  const album = normalizeDeep(albumName)
  const haystack = `${name} ${artists} ${album}`

  // Every word must appear somewhere, and the title itself must cover at
  // least one of them — otherwise a compilation album drags in random tracks.
  if (!tokens.every((token) => looseTokenMatch(haystack, token))) return 0
  if (
    !tokens.some(
      (token) => looseTokenMatch(name, token) || looseTokenMatch(album, token),
    )
  ) {
    return 0
  }

  let score = 0
  for (const token of tokens) {
    if (looseTokenMatch(name, token)) score += 4
    if (looseTokenMatch(artists, token)) score += 3
    if (looseTokenMatch(album, token)) score += 2
  }

  // The credits matching the query is the strongest signal that this is the
  // original rather than a re-upload that merely mentions the artist.
  if (tokens.some((token) => artistParts.includes(token))) score += 8
  if (DEEP_DECORATED.test(song.name)) score -= 6
  return score
}

/**
 * Ask the local API for NetEase song ids found by a `site:music.163.com`
 * search. Unlicensed tracks are missing from the song index but their pages
 * are still indexed, so this usually resolves the id in one round-trip.
 */
export async function lookupSongIdsByWeb(
  keyword: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const res = await get<{ data?: { ids?: string[] } }>(
    '/web/song-ids',
    { keyword },
    signal,
  )
  return (res.data?.ids ?? [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
}

/**
 * NetEase album candidates guessed from QQ Music metadata. QQ keeps the
 * original release album of delisted tracks ("爱情公寓3 电视剧原声带"), which
 * the NetEase song index no longer returns; its album search still finds the
 * matching release.
 */
async function resolveQqAlbums(
  keyword: string,
  tokens: string[],
  signal?: AbortSignal,
) {
  let matches = await fetchQqSongMatches(keyword, signal).catch(() => [])
  if (!matches.length) {
    // QQ occasionally answers with an empty list while throttling; one retry
    // keeps a temporary failure from looking like "no such song".
    await sleep(DEEP_SEARCH_RETRY_DELAY)
    matches = await fetchQqSongMatches(keyword, signal).catch(() => [])
  }
  if (!matches.length) return [] as Array<{ id: number; name: string }>

  const scored: Array<{
    album: string
    albummid?: string
    singers: string
    score: number
  }> = []
  for (const match of matches) {
    if (!match.album) continue
    const name = normalizeDeep(match.name)
    // Only keep QQ rows that actually are the requested song.
    if (!tokens.some((token) => name.includes(token))) continue
    const singers = normalizeDeep(match.singers)
    const album = normalizeDeep(match.album)
    // A row whose singer or album echoes the query is far more likely to be
    // the release we want than the first cover that shares the title.
    const score =
      (tokens.some((token) => singers.includes(token)) ? 0 : 2) +
      (tokens.some((token) => album.includes(token)) ? 0 : 1)
    scored.push({
      album: match.album,
      albummid: match.albummid,
      singers: match.singers,
      score,
    })
  }
  const candidates: Array<{
    album: string
    albummid?: string
    singers: string
  }> = []
  for (const item of scored.sort((a, b) => a.score - b.score)) {
    // One release can appear as several rows (deluxe/edition titles differ by a
    // suffix); `albummid` collapses those, the name is only the fallback for
    // older rows that omit it.
    const duplicate = candidates.some((entry) =>
      item.albummid
        ? entry.albummid === item.albummid
        : entry.album === item.album,
    )
    if (duplicate) continue
    candidates.push(item)
    if (candidates.length >= 3) break
  }

  const albums: Array<{ id: number; name: string }> = []
  for (const candidate of candidates) {
    const head = normalizeDeep(candidate.album.split(/\s+/)[0] ?? '')
    const singer = candidate.singers.split(/[/;、]/)[0]?.trim() ?? ''
    const searchAlbums = async (keywords: string) => {
      const result = await get<{
        result?: {
          albums?: Array<{
            id: number
            name: string
            artist?: { name?: string }
          }>
        }
      }>(
        '/search',
        { keywords, type: 10, limit: 10, offset: 0, timestamp: Date.now() },
        signal,
      ).catch(() => null)
      return (result?.result?.albums ?? []).filter(
        (album) => album && album.id,
      )
    }

    // The album name alone ranks best for soundtracks ("爱情公寓3 …"), while
    // the singer is needed for generic titles where covers dominate
    // ("每当我"). Try the name first and add the singer only when no result
    // credits that artist.
    const singerNorm = normalizeDeep(singer)
    let list = await searchAlbums(candidate.album)
    if (
      singerNorm &&
      !list.some((album) =>
        normalizeDeep(album.artist?.name ?? '').includes(singerNorm),
      )
    ) {
      const extra = await searchAlbums(`${candidate.album} ${singer}`)
      const seen = new Set(list.map((album) => album.id))
      list = [...list, ...extra.filter((album) => !seen.has(album.id))]
    }
    const rank = (album: { name: string; artist?: { name?: string } }) => {
      const nameHit = head && normalizeDeep(album.name).includes(head) ? 0 : 2
      const artistHit =
        singerNorm && normalizeDeep(album.artist?.name ?? '').includes(singerNorm)
          ? 0
          : 1
      return nameHit + artistHit
    }
    const ordered = [...list].sort((a, b) => rank(a) - rank(b))
    for (const album of ordered.slice(0, 5)) albums.push(album)
  }
  return albums
}

/**
 * Songs of the albums belonging to the artist whose name the query spells.
 * `compact` is the normalized query ("newjeans"); only an exact name match
 * qualifies, so a song title never triggers an artist walk.
 */
async function collectArtistAlbumSongs(
  keyword: string,
  compact: string,
  signal?: AbortSignal,
): Promise<DeepSearchHit[]> {
  if (!compact || signal?.aborted) return []
  const artists = await searchArtists(keyword).catch(() => [])
  const artist = artists.find((item) => {
    const name = normalizeDeep(item.name)
    return name === compact || name.replace(/\s+/g, '') === compact
  })
  if (!artist?.id) return []

  const albums = await fetchArtistAlbums(artist.id, 24, 0, signal).catch(
    () => [],
  )
  const hits: DeepSearchHit[] = []
  const seen = new Set<number>()
  // Twelve newest albums reach back far enough for the records people normally
  // search for (a 2023 EP sat behind four 2024 remix records). Requests run in
  // batches of four so the fallback still finishes in well under a second.
  const chosen = albums.slice(0, 12)
  for (let index = 0; index < chosen.length; index += 4) {
    if (signal?.aborted) break
    const batch = chosen.slice(index, index + 4)
    const details = await Promise.all(
      batch.map((album) => fetchAlbumDetail(album.id).catch(() => null)),
    )
    details.forEach((detail, offset) => {
      if (!detail) return
      const album = batch[offset]
      for (const song of detail.songs) {
        if (seen.has(song.id)) continue
        // The section is titled "原曲", so instrumental cuts and remixes of
        // the same record would only bury the actual album tracks.
        if (DEEP_DECORATED.test(song.name)) continue
        seen.add(song.id)
        hits.push({ song, albumId: album.id, albumName: album.name })
      }
    })
  }
  return hits
}

/** How the words after the title are read; each mode walks its own index. */
export type DeepSearchMode = 'artist' | 'album'

const ALBUM_MODE_LIMIT = 14

/** `/search` (v1) album lookup: ranks original releases better than cloudsearch. */
async function searchAlbumsV1(
  keywords: string,
  signal?: AbortSignal,
  limit = 10,
): Promise<Array<{ id: number; name: string; size?: number }>> {
  const result = await get<{
    result?: { albums?: Array<{ id: number; name: string; size?: number }> }
  }>(
    '/search',
    { keywords, type: 10, limit, offset: 0, timestamp: Date.now() },
    signal,
  ).catch(() => null)
  return (result?.result?.albums ?? []).filter((album) => album && album.id)
}

/**
 * "歌名 + 专辑名" queries. The song index hides delisted originals, but a fuzzy
 * album search still finds the release and its track list names the song, so
 * scan album tracks and score them against the query words.
 */
async function deepSearchByAlbum(
  keyword: string,
  tokens: string[],
  signal?: AbortSignal,
): Promise<DeepSearchHit[]> {
  if (!tokens.length || signal?.aborted) return []

  // The full query first (album names often carry the trailing words), then
  // each word alone so a long title cannot hide the album entirely. Every
  // query runs: a title-heavy full query fills up with same-named cover
  // albums, and the real release only shows up under the album word.
  const albums = new Map<
    number,
    { id: number; name: string; size?: number }
  >()
  for (const query of [keyword, ...tokens]) {
    if (signal?.aborted) break
    const list = await searchAlbumsV1(query, signal)
    for (const album of list) {
      if (!albums.has(album.id)) albums.set(album.id, album)
    }
  }

  // The trailing word is the album the user named, so releases containing it
  // are scanned first — that is where the original soundtrack sits.
  const albumToken = tokens[tokens.length - 1] ?? ''
  const chosen = [...albums.values()]
    .sort((a, b) => {
      const hitA = albumToken && normalizeDeep(a.name).includes(albumToken) ? 0 : 1
      const hitB = albumToken && normalizeDeep(b.name).includes(albumToken) ? 0 : 1
      if (hitA !== hitB) return hitA - hitB
      // A real soundtrack has more tracks than a one-off single release that
      // merely names the drama in its title.
      const sizeOf = (album: { size?: number }) => Number(album.size) || 0
      return sizeOf(b) - sizeOf(a)
    })
    .slice(0, ALBUM_MODE_LIMIT)
  if (!chosen.length) return []

  // Tracks must match the *song* words; otherwise a soundtrack album would
  // contribute every instrumental cue it contains.
  const titleTokens = tokens.length > 1 ? tokens.slice(0, -1) : tokens

  // "Cookie" (bare) is the original title; "NewJeans Cookie" or
  // "NewJeans Y2K Kpop Type Beat \"Cookie\"" only quote it. The bare title is
  // ranked ahead of everything else, then the score separates the versions.
  const titlePhrase = titleTokens.join('')

  // Two sources, one score: album search finds the covers and soundtracks, the
  // artist page finds the official (delisted) release that album search hides.
  const candidates: Array<{
    song: Song
    albumId: number
    albumName: string
    albumIsFullRecord: boolean
  }> = []

  const artistHits = await collectArtistAlbumSongsByToken(albumToken, signal)
  for (const hit of artistHits) {
    candidates.push({
      song: hit.song,
      albumId: hit.albumId,
      albumName: hit.albumName,
      // Official releases are EPs or albums, not one-off singles.
      albumIsFullRecord: true,
    })
  }

  // One album at a time: `fetchDeepSearchAlbum` keeps a single 350ms schedule,
  // and four parallel calls slipped past it and were answered with 405, which
  // silently dropped most albums from the result. 14 requests now take ~5s but
  // every one of them lands.
  for (const album of chosen) {
    if (signal?.aborted) break
    const detail = await fetchDeepSearchAlbum(album.id, signal).catch(() => null)
    if (!detail) continue
    const albumName = detail.name || album.name
    // A release with several tracks is a soundtrack/album; a one-track entry
    // is usually a single that just repeats the drama name in its title.
    const albumIsFullRecord = (detail.songs?.length ?? 0) >= 4
    for (const song of detail.songs ?? []) {
      candidates.push({ song, albumId: album.id, albumName, albumIsFullRecord })
    }
  }

  const scored: Array<{ hit: DeepSearchHit; score: number; exact: boolean }> = []
  for (const candidate of candidates) {
    const { song, albumName, albumIsFullRecord } = candidate
    // Remixes and covers share the title but are not "the track on this
    // album"; they would drown out the original in a short list.
    if (DEEP_DECORATED.test(song.name)) continue
    const nameNorm = normalizeDeep(song.name)
    // The song part of the query has to be in the title, otherwise a
    // soundtrack album contributes every cue it holds.
    if (!titleTokens.some((token) => nameNorm.includes(token))) continue
    const albumNorm = normalizeDeep(albumName)
    const artistParts = song.ar.map((artist) => normalizeDeep(artist.name))
    const artistsNorm = artistParts.join(' ')
    const exact = Boolean(titlePhrase) && nameNorm === titlePhrase
    // "cookie newjeans": the credited artist matching the album word
    // ("NewJeans") is the original; a random uploader is not.
    const artistExact =
      Boolean(albumToken) && artistParts.some((artist) => artist === albumToken)
    let score = 0
    for (const token of tokens) {
      if (nameNorm.includes(token)) score += 4
      if (albumNorm.includes(token)) score += 3
      if (artistsNorm.includes(token)) score += 2
    }
    // The album word is what the user named; a release carrying it is far
    // more likely the original soundtrack than a same-named cover album.
    if (albumToken && albumNorm.includes(albumToken)) score += 4
    if (albumIsFullRecord) score += 6
    if (exact) score += 10
    if (artistExact) score += 8
    if (score <= 0) continue
    scored.push({
      hit: { song, albumId: candidate.albumId, albumName },
      score,
      exact,
    })
  }

  const seen = new Set<number>()
  return scored
    .sort(
      (a, b) =>
        // A title that *is* the queried song wins over one that merely quotes
        // it, regardless of how many keywords the longer title happens to hit.
        Number(b.exact) - Number(a.exact) ||
        b.score - a.score ||
        // Shorter titles are closer to the bare original ("爱的回归线" before
        // "爱的回归线 (剧情版)").
        a.hit.song.name.length - b.hit.song.name.length,
    )
    .filter((entry) => {
      if (seen.has(entry.hit.song.id)) return false
      seen.add(entry.hit.song.id)
      return true
    })
    .slice(0, 20)
    .map((entry) => entry.hit)
}

/**
 * Albums of the artist whose name exactly matches `token`. NetEase hides
 * delisted official releases from album *search* (the same way it hides gray
 * songs from song search), but the artist page still lists them — so this is
 * the only way back to a gray original.
 */
async function collectArtistAlbumSongsByToken(
  token: string,
  signal?: AbortSignal,
): Promise<DeepSearchHit[]> {
  if (!token || signal?.aborted) return []
  const artists = await searchArtists(token).catch(() => [])
  const artist = artists.find((item) => normalizeDeep(item.name) === token)
  if (!artist?.id) return []

  const albums = await fetchArtistAlbums(artist.id, 24, 0, signal).catch(
    () => [],
  )
  const hits: DeepSearchHit[] = []
  const seen = new Set<number>()
  // Walk the whole discography, not just the newest releases: the delisted
  // track people search for is often on an older EP that sits below the 2024
  // remix records. Four at a time keeps this at ~1s for a ten-album artist.
  const chosen = albums.slice(0, 24)
  for (let index = 0; index < chosen.length; index += 4) {
    if (signal?.aborted) break
    const batch = chosen.slice(index, index + 4)
    const details = await Promise.all(
      batch.map((album) => fetchAlbumDetail(album.id).catch(() => null)),
    )
    details.forEach((detail, offset) => {
      if (!detail) return
      const album = batch[offset]
      for (const song of detail.songs ?? []) {
        if (seen.has(song.id)) continue
        seen.add(song.id)
        hits.push({
          song,
          albumId: album.id,
          albumName: detail.name || album.name,
        })
      }
    })
  }
  return hits
}

/**
 * A bare song title ("彩色的黑") cannot be told apart from its covers by
 * NetEase alone — every upload is titled the same. QQ Music keeps the original
 * release high in its ranking, so read the singer off its first exact-title
 * rows and then search NetEase for "歌名 歌手": that surfaces the single or
 * self-titled album holding the gray original.
 */
async function resolveOriginalViaQq(
  keyword: string,
  signal?: AbortSignal,
): Promise<DeepSearchHit[]> {
  const target = normalizeDeep(keyword)
  if (!target) return []
  const matches = await fetchQqSongMatches(keyword, signal).catch(() => [])
  if (!matches.length) return []

  const singers = new Set<string>()
  for (const match of matches) {
    if (normalizeDeep(match.name) !== target) continue
    for (const raw of String(match.singers || '').split(/[/;、]/)) {
      const name = raw.trim()
      if (name) singers.add(name)
    }
    if (singers.size >= 3) break
  }
  if (!singers.size) return []

  const hits: DeepSearchHit[] = []
  const seen = new Set<number>()
  for (const singer of singers) {
    if (signal?.aborted) break
    const singerNorm = normalizeDeep(singer)
    const albums = await searchAlbumsV1(`${keyword} ${singer}`, signal).catch(
      () => [],
    )
    for (const album of albums.slice(0, 3)) {
      if (signal?.aborted) break
      const detail = await fetchDeepSearchAlbum(album.id, signal).catch(
        () => null,
      )
      if (!detail) continue
      for (const song of detail.songs ?? []) {
        if (seen.has(song.id)) continue
        if (!looseTokenMatch(normalizeDeep(song.name), target)) continue
        // The credits must be the singer QQ named; otherwise this is just
        // another upload with the same title.
        const creditHit = song.ar.some((artist) =>
          normalizeDeep(artist.name).includes(singerNorm),
        )
        if (!creditHit) continue
        seen.add(song.id)
        hits.push({
          song,
          albumId: album.id,
          albumName: detail.name || album.name,
        })
      }
    }
    // One singer with a real hit is enough; later QQ rows are usually live or
    // cover versions of the same title.
    if (hits.length) break
  }
  return hits
}

export async function deepSearchSongs(
  keyword: string,
  signal?: AbortSignal,
  mode: DeepSearchMode = 'artist',
): Promise<DeepSearchHit[]> {
  const tokens = keyword
    .trim()
    .split(/\s+/)
    .map(normalizeDeep)
    .filter(Boolean)
  if (!tokens.length) return []

  // The two modes read the query differently and return different rows, so the
  // cache key has to carry the mode.
  const cacheKey = `${mode}:${tokens.join(' ')}`
  const cached = deepSearchCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DEEP_SEARCH_TTL) {
    return cached.hits
  }

  // A bare title hides its original among same-titled covers. QQ's ranking
  // still knows which singer released it, so resolve the singer there and
  // search NetEase for "歌名 歌手" — the shortest reliable path for this case.
  if (tokens.length === 1) {
    const qqHits = await resolveOriginalViaQq(keyword, signal)
    if (qqHits.length) {
      deepSearchCache.set(cacheKey, { hits: qqHits, at: Date.now() })
      return qqHits
    }
  }

  // Album mode: the user said the trailing words name the release, so scan
  // album track lists first — that is the shortest path to a delisted original.
  if (mode === 'album') {
    const albumHits = await deepSearchByAlbum(keyword, tokens, signal)
    if (albumHits.length) {
      deepSearchCache.set(cacheKey, { hits: albumHits, at: Date.now() })
      return albumHits
    }
  }

  // Artist query first, but only for multi-word queries: a single word can be
  // both a song title and some cover account's name ("一路向北"), and walking
  // that account's albums would return a wall of covers instead of the
  // original. "歌名 歌手" / "New Jeans" style queries are the real artist case.
  if (tokens.length > 1) {
    const artistHits = await collectArtistAlbumSongs(
      keyword,
      tokens.join(''),
      signal,
    )
    if (artistHits.length) {
      deepSearchCache.set(cacheKey, { hits: artistHits, at: Date.now() })
      return artistHits
    }
  }

  // Fast path: a web search for the song's NetEase page usually returns the
  // exact id in ~200 ms. The whole query can be too specific ("爱的回归线
  // 爱情公寓" matches no page), so each word is retried on its own; hits are
  // still verified against title + artists + album, which keeps a drama/series
  // name in the query usable as context instead of a hard requirement.
  const webKeywords = [keyword]
  if (tokens.length > 1) {
    webKeywords.push(keyword.split(/\s+/)[0] ?? tokens[0], ...tokens.slice(0, 2))
  }
  for (const webKeyword of new Set(webKeywords)) {
    if (signal?.aborted) return []
    const webIds = await lookupSongIdsByWeb(webKeyword, signal).catch(() => [])
    if (!webIds.length) continue

    const verified: DeepSearchHit[] = []
    await Promise.all(
      webIds.slice(0, 4).map(async (id) => {
        const song = await fetchSongDetail(id).catch(() => null)
        if (!song || !webHitMatches(song, tokens)) return
        if (!decoratedAllowed(song, tokens)) return
        verified.push({
          song,
          albumId: song.al?.id ?? 0,
          albumName: song.al?.name ?? '',
        })
      }),
    )
    if (!verified.length) continue

    const sorted = verified.sort(
      (a, b) => a.song.name.length - b.song.name.length,
    )
    deepSearchCache.set(cacheKey, { at: Date.now(), hits: sorted })
    return sorted
  }

  // QQ Music still knows the original release album; add those albums to the
  // scan queue ahead of the keyword matches.
  const qqAlbums = await resolveQqAlbums(keyword, tokens, signal).catch(() => [])

  // `/search` (v1) ranks albums differently from `/cloudsearch`: the original
  // album of a grey track is typically only in the v1 list, while cloudsearch
  // returns the same user-uploaded compilations that dominate the song tab.
  const loadAlbums = () =>
    get<{
      result?: { albums?: Array<{ id: number; name: string }> }
    }>(
      '/search',
      {
        keywords: keyword,
        type: 10,
        limit: 30,
        offset: 0,
        timestamp: Date.now(),
      },
      signal,
    )
  let result = await loadAlbums().catch(() => null)
  if (!result?.result?.albums?.length) {
    // The album endpoint is rate limited too (and sometimes answers 200 with
    // an empty list while throttled); one short pause usually clears it, and a
    // failed lookup otherwise looks like "nothing found".
    await sleep(DEEP_SEARCH_RETRY_DELAY)
    result = (await loadAlbums().catch(() => null)) ?? result
  }
  const byId = new Map<number, { id: number; name: string }>()
  for (const album of [
    ...qqAlbums,
    ...(result?.result?.albums ?? []).filter((album) => album && album.id),
  ]) {
    if (!byId.has(album.id)) byId.set(album.id, album)
  }
  // A single word matches far too many albums; scanning a dozen of them just
  // adds latency, so keep the fallback short for title-only searches.
  const albumLimit =
    tokens.length === 1 ? 8 : DEEP_SEARCH_ALBUM_LIMIT
  const albums = [...byId.values()].slice(0, albumLimit)
  if (!albums.length) return []

  const hits = new Map<number, DeepSearchHit & { score: number }>()
  let cursor = 0
  const worker = async () => {
    while (cursor < albums.length) {
      const album = albums[cursor]
      cursor += 1
      if (signal?.aborted) return

      // `/album` answers 405 when it is hit in a burst, which would silently
      // turn a valid match into "nothing found"; retry once after the shared
      // cooldown, then move on without hammering the same limiter.
      let detail = null
      for (let attempt = 0; attempt < 2 && !detail; attempt += 1) {
        if (signal?.aborted) return
        try {
          detail = await fetchDeepSearchAlbum(album.id, signal)
        } catch {
          if (attempt === 0) await sleep(DEEP_SEARCH_RETRY_DELAY)
        }
      }
      if (!detail) continue

      const albumName = detail.name || album.name
      for (const song of detail.songs ?? []) {
        if (!decoratedAllowed(song, tokens)) continue
        const score = deepMatchScore(song, albumName, tokens)
        if (score <= 0) continue
        const existing = hits.get(song.id)
        if (existing && existing.score >= score) continue
        hits.set(song.id, {
          song,
          albumId: detail.id ?? album.id,
          albumName,
          score,
        })
      }
    }
  }
  await Promise.all([worker(), worker()])

  const sorted = [...hits.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ song, albumId, albumName }) => ({ song, albumId, albumName }))

  deepSearchCache.set(cacheKey, { at: Date.now(), hits: sorted })
  return sorted
}

/* --------------------------------- artist -------------------------------- */

export async function fetchArtistProfile(id: number | string, signal?: AbortSignal) {
  // `followed` sits next to the artist object, not inside it, but the page needs
  // it to seed the follow button, so fold it in here.
  const res = await get<{
    data?: { artist?: ArtistProfile; followed?: boolean }
  }>('/artist/detail', { id }, signal)
  const artist = res.data?.artist
  if (!artist) return null
  return { ...artist, followed: Boolean(res.data?.followed) }
}

/** Follow / unfollow an artist for the signed-in account (`t=1` / `t=0`). */
export async function subscribeArtist(
  id: number | string,
  subscribed: boolean,
) {
  const res = await get<{ code?: number }>('/artist/sub', {
    id,
    t: subscribed ? 1 : 0,
    timestamp: Date.now(),
  })
  return res.code === 200
}

/**
 * Artists followed by the signed-in account. Like `album/sublist`, the route is
 * keyed by the session cookie rather than a uid parameter.
 */
export async function fetchCollectedArtists(
  limit = 100,
  offset = 0,
  signal?: AbortSignal,
): Promise<ArtistSummary[]> {
  const res = await get<{
    data?: Array<{
      id?: number
      name?: string
      picUrl?: string
      img1v1Url?: string
      albumSize?: number
      mvSize?: number
    }>
  }>('/artist/sublist', { limit, offset, timestamp: Date.now() }, signal)
  return (res.data ?? [])
    .filter((item) => Number.isFinite(Number(item?.id)) && Boolean(item?.name))
    .map((item) => ({
      id: Number(item.id),
      name: String(item.name),
      picUrl: item.picUrl ?? item.img1v1Url ?? '',
      albumSize: Number(item.albumSize) || 0,
      mvSize: Number(item.mvSize) || 0,
    }))
}

export async function fetchArtistTopSongs(id: number | string, signal?: AbortSignal) {
  const res = await get<{ songs?: RawSong[] }>('/artist/top/song', { id }, signal)
  return normalizeSongs(res.songs).slice(0, 50)
}

export async function fetchArtistAlbums(
  id: number | string,
  limit = 30,
  offset = 0,
  signal?: AbortSignal,
) {
  const res = await get<{ hotAlbums?: ArtistAlbum[] }>(
    '/artist/album',
    {
      id,
      limit,
      offset,
    },
    signal,
  )
  return (res.hotAlbums ?? []).map((album) => ({
    ...album,
    picUrl: album.picUrl ?? album.blurPicUrl,
  }))
}

export async function fetchArtistMvs(
  id: number | string,
  limit = 12,
  offset = 0,
  signal?: AbortSignal,
) {
  const res = await get<{
    mvs?: Array<{
      id: number
      name: string
      imgurl?: string
      imgurl16v9?: string
      duration?: number
      playCount?: number
      publishTime?: string
      artistName?: string
    }>
  }>('/artist/mv', { id, limit, offset }, signal)
  return (res.mvs ?? []).map((mv) =>
    normalizeMv({
      id: mv.id,
      name: mv.name,
      cover: mv.imgurl16v9 ?? mv.imgurl,
      duration: mv.duration,
      playCount: mv.playCount,
      publishTime: mv.publishTime,
      artistName: mv.artistName,
    }),
  )
}

export async function fetchSimilarArtists(id: number | string, signal?: AbortSignal) {
  const res = await get<{ artists?: ArtistSummary[] }>('/simi/artist', { id }, signal)
  return res.artists ?? []
}

export async function fetchSimilarSongs(
  id: number | string,
  signal?: AbortSignal,
) {
  const res = await get<{
    songs?: Parameters<typeof normalizeSongs>[0]
  }>('/simi/song', { id }, signal)
  return normalizeSongs(res.songs)
}

export async function fetchIntelligenceList(params: {
  id: number
  pid: string
  sid?: number
  count?: number
}) {
  const res = await get<{
    code?: number
    message?: string
    data?: Array<{ songInfo?: RawSong }>
  }>('/playmode/intelligence/list', {
    id: params.id,
    pid: params.pid,
    sid: params.sid ?? params.id,
    count: params.count ?? 10,
  })
  if (res.code !== 200) {
    throw new Error(
      typeof res.message === 'string' && res.message
        ? res.message
        : '心动模式暂不可用，请确认已登录',
    )
  }
  return normalizeSongs(
    (res.data ?? [])
      .map((item) => item.songInfo)
      .filter((song): song is RawSong => Boolean(song)),
  )
}

export async function fetchPersonalFm(limit = 10) {
  const res = await get<{ data?: RawSong[] }>('/personal_fm', {
    limit,
    timestamp: Date.now(),
  })
  return normalizeSongs(res.data)
}

/* ---------------------------------- user --------------------------------- */

export async function fetchQrKey() {
  const res = await get<{ data?: { unikey: string } }>('/login/qr/key', {
    timestamp: Date.now(),
  })
  return res.data?.unikey ?? ''
}

export async function fetchQrImage(key: string) {
  const res = await get<{ data?: { qrimg: string } }>('/login/qr/create', {
    key,
    timestamp: Date.now(),
    qrimg: true,
  })
  return res.data?.qrimg ?? ''
}

export async function fetchQrStatus(key: string) {
  return get<{ code: number; message?: string; cookie?: string }>('/login/qr/check', {
    key,
    timestamp: Date.now(),
  })
}

export async function fetchLoginStatus() {
  return get<{
    data?: {
      code: number
      account?: {
        id: number
        type?: number
        anonimousUser?: boolean
      } | null
      profile?: UserProfile | null
    }
  }>('/login/status', { timestamp: Date.now() })
}

export async function fetchAccount() {
  return get<{
    account?: {
      id: number
      type?: number
      anonimousUser?: boolean
    } | null
    profile?: UserProfile | null
  }>('/user/account')
}

export async function fetchUserDetail(uid: number | string, signal?: AbortSignal) {
  return get<UserDetail>('/user/detail', { uid }, signal)
}

export async function fetchUserPlaylists(
  uid: number | string,
  signal?: AbortSignal,
) {
  const res = await get<{ playlist?: Playlist[] }>(
    '/user/playlist',
    { uid, limit: 1000 },
    signal,
  )
  return (res.playlist ?? []).map(normalizePlaylist)
}

/**
 * Albums saved by the signed-in account. NetEase's `album/sublist` is backed
 * by the session cookie rather than a `uid` query, so this is only meaningful
 * on the current user's own profile.
 */
export async function fetchCollectedAlbums(
  limit = 100,
  offset = 0,
  signal?: AbortSignal,
) {
  // The enhanced API answers with `data` (like `artist/sublist`); plain
  // NeteaseCloudMusicApi used `albums`. Accept both or the sidebar list is
  // always empty even though the request succeeds.
  const res = await get<{ albums?: Album[]; data?: Album[]; count?: number }>(
    '/album/sublist',
    { limit, offset, total: true, timestamp: Date.now() },
    signal,
  )
  const albums = (res.albums ?? res.data ?? []).map((album) => ({
    ...album,
    picUrl: album.picUrl ?? album.blurPicUrl,
    artist: album.artist ?? album.artists?.[0],
  }))
  return { albums, count: res.count ?? albums.length }
}

/**
 * Collect / uncollect an album for the signed-in account. NetEase's
 * `album/sub` takes `t=1` to collect and `t=0` to remove.
 */
export async function subscribeAlbum(
  id: number | string,
  subscribed: boolean,
) {
  const res = await get<{ code?: number }>('/album/sub', {
    id,
    t: subscribed ? 1 : 0,
    timestamp: Date.now(),
  })
  // Both the collection list and this album's `isSub` change with this call.
  if (res.code === 200) invalidateApiCache(['/album'])
  return res.code === 200
}

/** Follow / unfollow another account for the signed-in user (`t=1` / `t=0`). */
export async function subscribeUser(
  id: number | string,
  subscribed: boolean,
) {
  const res = await get<{ code?: number }>('/follow', {
    id,
    t: subscribed ? 1 : 0,
    timestamp: Date.now(),
  })
  return res.code === 200
}

/** Accounts followed by `uid` (the signed-in user's own id for the sidebar). */
export async function fetchFollowedUsers(
  uid: number | string,
  limit = 100,
  offset = 0,
  signal?: AbortSignal,
): Promise<UserProfile[]> {
  const res = await get<{
    follow?: Array<
      Partial<UserProfile> & { userId?: number; nickname?: string }
    >
  }>('/user/follows', { uid, limit, offset, timestamp: Date.now() }, signal)
  return (res.follow ?? [])
    .filter(
      (item) =>
        Number.isFinite(Number(item?.userId)) && Boolean(item?.nickname),
    )
    .map((item) => ({
      userId: Number(item.userId),
      nickname: String(item.nickname),
      avatarUrl: item.avatarUrl ?? '',
      signature: item.signature,
    }))
}

export async function fetchLikedIds(uid: number | string) {
  const res = await get<{ ids?: number[] }>('/likelist', { uid })
  return res.ids ?? []
}

export async function logout() {
  return get<ApiResponse>('/logout', { timestamp: Date.now() })
}

export async function signIn() {
  return get<ApiResponse>('/daily_signin', { timestamp: Date.now(), type: 1 })
}

export async function sendCaptcha(phone: string) {
  return get<ApiResponse>('/captcha/sent', { phone })
}

export async function loginByCellphone(phone: string, captcha: string) {
  return get<ApiResponse>('/login/cellphone', { phone, captcha })
}

export async function updateUserInfo(params: {
  nickname: string
  signature?: string
  gender?: number
  birthday?: number | string
  province?: number | string
  city?: number | string
}) {
  return get<ApiResponse>('/user/update', { ...params, timestamp: Date.now() })
}

export function updateUserAvatar(file: File, imgSize: number) {
  return uploadFile<{ code: number; data?: { url: string } }>('/avatar/upload', file, {
    timestamp: Date.now(),
    imgSize,
  })
}

export async function fetchAlbumDetail(
  id: number | string,
  signal?: AbortSignal,
): Promise<AlbumDetail | null> {
  // The album object arrives separately from its track list: /album returns
  // `{ album: {...}, songs: [...] }`, and album.songs is usually empty.
  const res = await get<{ album?: Omit<AlbumDetail, 'songs'>; songs?: Song[] }>(
    '/album',
    { id },
    signal,
  )
  const album = res.album
  if (!album) return null
  const cover = album.picUrl ?? album.blurPicUrl
  return {
    ...album,
    picUrl: cover,
    songs: (res.songs ?? []).map((song) => ({
      ...song,
      al: {
        ...song.al,
        picUrl: song.al?.picUrl ?? cover,
      },
    })),
  }
}
