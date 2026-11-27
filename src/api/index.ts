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

/** Where a deep-search hit was found; the result section names its sources. */
export type DeepSearchSource = 'qq' | 'artist' | 'web' | 'album'

export interface DeepSearchHit {
  song: Song
  albumId: number
  albumName: string
  source: DeepSearchSource
}

/** How the words after the title are read; each mode walks its own index. */
export type DeepSearchMode = 'artist' | 'album'

/** What the fallback is doing right now, for the progress line. */
export interface DeepSearchProgress {
  stage: 'qq' | 'artist' | 'web' | 'albums'
  /** Albums read so far / planned, during album walks. */
  done?: number
  total?: number
  /** Artist whose discography is being read. */
  artist?: string
}

export interface DeepSearchOptions {
  onProgress?: (progress: DeepSearchProgress) => void
  /** Best hits so far, while a slow album walk is still running. */
  onPartial?: (hits: DeepSearchHit[]) => void
}

interface DeepReport {
  progress: (progress: DeepSearchProgress) => void
  partial: (hits: DeepSearchHit[]) => void
}

/*
 * NetEase's song index only contains licensed tracks, so a grey original is
 * missing from `/cloudsearch?type=1` even though its album still lists it.
 * The fallback asks other indexes (QQ Music, a web search, album search, the
 * artist page) and reads album track lists — the route a user takes by
 * browsing 歌手 / 专辑.
 *
 * Speed: the independent lookups (QQ, web, album search, artist search) start
 * together and every stage only awaits what it needs, in priority order. QQ
 * rows and album details are memoised across searches, and only real
 * `/album` requests are spaced out by the shared limiter.
 */
const DEEP_SEARCH_ALBUM_LIMIT = 16
const DEEP_SEARCH_TTL = 5 * 60_000
const DEEP_SEARCH_RETRY_DELAY = 600
const DEEP_SEARCH_RATE_LIMIT_COOLDOWN = 2_000
/** Spacing between real `/album` requests; wider for a minute after a 405. */
const DEEP_ALBUM_GAP = 200
const DEEP_ALBUM_GAP_THROTTLED = 450
const DEEP_ALBUM_THROTTLE_WINDOW = 60_000
const DEEP_ALBUM_WORKERS = 3
const DEEP_MEMO_LIMIT = 300
const DEEP_RESULT_LIMIT = 20
const ALBUM_MODE_LIMIT = 14
const ARTIST_CATALOGUE_ALBUMS = 12
const ARTIST_TITLE_ALBUMS = 24
/** How long a stage waits for QQ before carrying on without it. */
const QQ_FIRST_WAIT = 4_000
const QQ_HINT_WAIT = 1_200

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const deepSearchCache = new Map<string, { at: number; hits: DeepSearchHit[] }>()

/** Bounded LRU insert shared by the deep-search memos. */
function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key)
  map.set(key, value)
  if (map.size > DEEP_MEMO_LIMIT) {
    const oldest = map.keys().next()
    if (!oldest.done) map.delete(oldest.value)
  }
}

/** Resolve with `fallback` as soon as the search is aborted. */
function orAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  fallback: T,
): Promise<T> {
  if (!signal) return promise.catch(() => fallback)
  if (signal.aborted) return Promise.resolve(fallback)
  return new Promise<T>((resolve) => {
    const onAbort = () => resolve(fallback)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve(fallback)
      },
    )
  })
}

/** The value if `promise` settles within `ms`, otherwise `fallback`. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    sleep(ms).then(() => fallback),
  ])
}

/* ------------------------- shared `/album` access ------------------------ */

let deepAlbumNextSlot = 0
let deepAlbumThrottledUntil = 0
const deepAlbumMemo = new Map<
  number,
  { at: number; promise: Promise<AlbumDetail | null> }
>()

/**
 * Reserve the next request slot synchronously. Parallel callers each get
 * their own slot, so several workers still reach `/album` evenly spaced (the
 * old shared timestamp let concurrent callers fire together, which `/album`
 * answers with 405).
 */
async function deepAlbumSlot() {
  const now = Date.now()
  const gap =
    now < deepAlbumThrottledUntil ? DEEP_ALBUM_GAP_THROTTLED : DEEP_ALBUM_GAP
  const at = Math.max(now, deepAlbumNextSlot)
  deepAlbumNextSlot = at + gap
  if (at > now) await sleep(at - now)
}

async function requestDeepAlbum(id: number) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await deepAlbumSlot()
    try {
      return await fetchAlbumDetail(id)
    } catch (error) {
      if ((error as { status?: number }).status === 405) {
        // Pause every worker, and keep the wider spacing for a while.
        const now = Date.now()
        deepAlbumThrottledUntil = now + DEEP_ALBUM_THROTTLE_WINDOW
        deepAlbumNextSlot = Math.max(
          deepAlbumNextSlot,
          now + DEEP_SEARCH_RATE_LIMIT_COOLDOWN,
        )
      } else if (attempt === 0) {
        await sleep(DEEP_SEARCH_RETRY_DELAY)
      }
    }
  }
  return null
}

/**
 * Album detail through the limiter, memoised. Not tied to one search's abort
 * signal on purpose: a refined query ("一路向北" → "一路向北 周杰伦") reuses the
 * albums the previous run was already loading. Callers stop waiting on abort.
 */
function loadDeepAlbum(id: number): Promise<AlbumDetail | null> {
  const memo = deepAlbumMemo.get(id)
  if (memo && Date.now() - memo.at < DEEP_SEARCH_TTL) return memo.promise
  const promise: Promise<AlbumDetail | null> = requestDeepAlbum(id).then(
    (detail) => {
      if (!detail && deepAlbumMemo.get(id)?.promise === promise) {
        deepAlbumMemo.delete(id)
      }
      return detail
    },
  )
  remember(deepAlbumMemo, id, { at: Date.now(), promise })
  return promise
}

/**
 * Read album track lists with a few workers. `visit` returns true to stop
 * early (the exact original was found).
 */
async function scanDeepAlbums<A extends { id: number }>(
  albums: A[],
  signal: AbortSignal | undefined,
  visit: (detail: AlbumDetail, album: A) => boolean | void,
  onStep?: (done: number, total: number) => void,
) {
  let cursor = 0
  let done = 0
  let stop = false
  const worker = async () => {
    while (!stop && cursor < albums.length && !signal?.aborted) {
      const album = albums[cursor]
      cursor += 1
      const detail = await orAbort(loadDeepAlbum(album.id), signal, null)
      if (signal?.aborted) return
      done += 1
      if (detail && visit(detail, album)) stop = true
      onStep?.(done, albums.length)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DEEP_ALBUM_WORKERS, albums.length) }, worker),
  )
}

/* ------------------------------- QQ Music -------------------------------- */

const qqMatchMemo = new Map<
  string,
  { at: number; promise: Promise<QqSongMatch[]> }
>()

/** QQ rows for a query, shared by every stage and by repeated searches. */
function qqMatches(keyword: string): Promise<QqSongMatch[]> {
  const key = keyword.trim()
  const memo = qqMatchMemo.get(key)
  if (memo && Date.now() - memo.at < DEEP_SEARCH_TTL) return memo.promise
  const promise: Promise<QqSongMatch[]> = (async () => {
    const first = await fetchQqSongMatches(key).catch(() => [] as QqSongMatch[])
    if (first.length) return first
    // QQ occasionally answers with an empty list while throttling; one retry
    // keeps a temporary failure from looking like "no such song".
    await sleep(DEEP_SEARCH_RETRY_DELAY)
    return fetchQqSongMatches(key).catch(() => [] as QqSongMatch[])
  })()
  remember(qqMatchMemo, key, { at: Date.now(), promise })
  void promise.then((list) => {
    // An empty answer is usually throttling: let the next search ask again.
    if (!list.length && qqMatchMemo.get(key)?.promise === promise) {
      qqMatchMemo.delete(key)
    }
  })
  return promise
}

/* ------------------------------- matching -------------------------------- */

function normalizeDeep(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_—·()（）[\]【】「」'"“”,，.。!！?？/]/g, '')
}

function deepTokens(keyword: string) {
  return keyword.trim().split(/\s+/).map(normalizeDeep).filter(Boolean)
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

/*
 * Words marking a different recording of the same title. English words need
 * word boundaries: a substring test on the space-stripped title used to treat
 * "Alive", "Olivia", "Discover" or "Adjust" as live / cover / DJ versions.
 */
const DECORATION_CJK =
  /(翻唱|翻跳|伴奏|纯音乐|加速|降速|慢速|变速|升调|降调|说唱版|片段|剪辑|铃声|女声版|男声版)/
const DECORATION_EN =
  /(?<![a-z0-9])(live|remix|dj|bootleg|cover|instrumental|8d|nightcore|slowed|sped\s*up|v\d)(?![a-z0-9])/
const DECORATION_SPEED = /(?<![a-z0-9.])\d(?:\.\d+)?x(?![a-z0-9])/

interface Decoration {
  /** Normalised like a query token, so it can be compared with one. */
  word: string
  /** A cover: acceptable when it credits the requested artist. */
  cover: boolean
}

function decorationOf(title: string): Decoration | null {
  const text = String(title || '').normalize('NFKC').toLowerCase()
  const cjk = text.match(DECORATION_CJK)
  if (cjk) return { word: cjk[1], cover: cjk[1] === '翻唱' }
  const en = text.match(DECORATION_EN)
  if (en) {
    const word = en[1].replace(/\s+/g, '')
    return { word, cover: word === 'cover' || word === 'bootleg' }
  }
  const speed = text.match(DECORATION_SPEED)
  if (speed) return { word: speed[0].replace('.', ''), cover: false }
  return null
}

/** The query itself asks for this kind of version ("live", "伴奏", "cover"). */
function decorationRequested(decoration: Decoration, tokens: string[]) {
  return tokens.some(
    (token) =>
      token.includes(decoration.word) ||
      (token.length >= 2 && decoration.word.includes(token)),
  )
}

/** A different recording the query did not ask for (live, remix, sped up…). */
function unwantedVersion(song: Pick<Song, 'name'>, tokens: string[]) {
  const decoration = decorationOf(song.name)
  return Boolean(decoration && !decorationRequested(decoration, tokens))
}

/**
 * Whether a decorated upload is still an acceptable answer. A cover is fine
 * only when it credits the requested artist (the user's own track may be one);
 * a slowed-down or rap version is never the original unless asked for.
 */
function decoratedAllowed(song: Song, tokens: string[]) {
  const decoration = decorationOf(song.name)
  if (!decoration || decorationRequested(decoration, tokens)) return true
  if (!decoration.cover) return false
  const artists = song.ar.map((artist) => normalizeDeep(artist.name))
  return tokens.some((token) =>
    artists.some((artist) => artist === token || artist.includes(token)),
  )
}

/**
 * Lengths (ms) of the release QQ Music lists for the title; paid rows (the
 * licensed original, not a re-upload) first. Covers and DJ edits usually
 * differ by far more than a few seconds, which makes this the strongest
 * signal for picking the original among same-titled uploads.
 */
function durationRefs(
  matches: QqSongMatch[],
  titleTokens: string[],
  singer?: string,
) {
  const singerNorm = singer ? normalizeDeep(singer) : ''
  const refs: Array<{ ms: number; rank: number }> = []
  for (const match of matches) {
    const seconds = Number(match.duration)
    if (!(seconds > 0) || decorationOf(match.name)) continue
    const name = normalizeDeep(match.name)
    if (!titleTokens.length || !titleTokens.some((token) => name.includes(token))) {
      continue
    }
    if (singerNorm && !normalizeDeep(match.singers).includes(singerNorm)) continue
    refs.push({ ms: seconds * 1000, rank: match.pay ? 0 : 1 })
  }
  return refs
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((ref) => ref.ms)
}

function durationBonus(song: Pick<Song, 'dt'>, refs: number[]) {
  const length = Number(song.dt)
  if (!refs.length || !(length > 0)) return 0
  const diff = Math.min(...refs.map((ref) => Math.abs(length - ref)))
  if (diff <= 3_000) return 6
  if (diff <= 8_000) return 2
  if (diff >= 30_000) return -3
  return 0
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

function deepMatchScore(
  song: Song,
  albumName: string,
  tokens: string[],
  refs: number[],
) {
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
  if (unwantedVersion(song, tokens)) score -= 6
  score += durationBonus(song, refs)
  // Never let the length alone carry an unrelated row past zero.
  return Math.max(score, 0)
}

/* -------------------------------- lookups -------------------------------- */

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

/** Several songs in one `/song/detail` call, rights folded in. */
async function fetchSongsDetail(ids: number[], signal?: AbortSignal) {
  if (!ids.length) return [] as Song[]
  const res = await get<{ songs?: Song[]; privileges?: SongPrivilege[] }>(
    '/song/detail',
    { ids: ids.join(',') },
    signal,
  )
  const privileges = new Map(
    (res.privileges ?? []).map((privilege) => [Number(privilege.id), privilege]),
  )
  return (res.songs ?? []).map((song) => {
    const privilege = privileges.get(Number(song.id))
    return privilege ? { ...song, privilege } : song
  })
}

/**
 * Candidate songs from the web lookup. The whole query can be too specific
 * ("爱的回归线 爱情公寓" matches no page), so the first words alone are tried
 * too — all at once — and the ids are resolved in one detail request.
 * Verification against the query happens later, with the final tokens.
 */
async function webCandidates(keyword: string, signal?: AbortSignal) {
  const words = keyword.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return [] as Song[]
  const queries = [...new Set([words.join(' '), ...(words.length > 1 ? words.slice(0, 2) : [])])]
  const lists = await Promise.all(
    queries.map((query) => lookupSongIdsByWeb(query, signal).catch(() => [] as number[])),
  )
  const ids = [...new Set(lists.flat())].slice(0, 10)
  if (!ids.length || signal?.aborted) return [] as Song[]
  return fetchSongsDetail(ids, signal).catch(() => [] as Song[])
}

function rankWebHits(
  songs: Song[],
  tokens: string[],
  refs: number[],
  artist?: string,
): DeepSearchHit[] {
  return songs
    .filter((song) => webHitMatches(song, tokens) && decoratedAllowed(song, tokens))
    .map((song) => {
      const name = normalizeDeep(song.name)
      const credits = song.ar.map((item) => normalizeDeep(item.name))
      let score = durationBonus(song, refs)
      if (tokens.some((token) => token === name)) score += 10
      if (
        artist
          ? credits.includes(artist)
          : tokens.some((token) => credits.includes(token))
      ) {
        score += 8
      }
      return { song, score }
    })
    .sort((a, b) => b.score - a.score || a.song.name.length - b.song.name.length)
    .map(({ song }) => ({
      song,
      albumId: song.al?.id ?? 0,
      albumName: song.al?.name ?? '',
      source: 'web' as const,
    }))
}

/** `/search` (v1) album lookup: ranks original releases better than cloudsearch. */
async function searchAlbumsV1(
  keywords: string,
  signal?: AbortSignal,
  limit = 10,
): Promise<Array<{ id: number; name: string; size?: number; artist?: { name?: string } }>> {
  const result = await get<{
    result?: {
      albums?: Array<{ id: number; name: string; size?: number; artist?: { name?: string } }>
    }
  }>(
    '/search',
    { keywords, type: 10, limit, offset: 0, timestamp: Date.now() },
    signal,
  ).catch(() => null)
  return (result?.result?.albums ?? []).filter((album) => album && album.id)
}

/**
 * The album endpoint is rate limited too (and sometimes answers 200 with an
 * empty list while throttled); one short pause usually clears it.
 */
async function searchAlbumsWithRetry(keywords: string, signal?: AbortSignal, limit = 30) {
  const first = await searchAlbumsV1(keywords, signal, limit)
  if (first.length || signal?.aborted) return first
  await sleep(DEEP_SEARCH_RETRY_DELAY)
  return searchAlbumsV1(keywords, signal, limit)
}

/* ------------------------------ artist walks ----------------------------- */

interface QueryArtist {
  id: number
  name: string
  /** Normalised name, compared against query tokens and credits. */
  key: string
  /** The rest of the query: the title words. Empty for an artist query. */
  titleTokens: string[]
  /** The whole query names the artist ("New Jeans"). */
  whole: boolean
}

/**
 * Which part of the query is an artist. Handles "歌名 歌手", "歌手 歌名",
 * multi-word names ("love story taylor swift") and names written without a
 * space ("周杰伦一路向北"). Only exact name matches count, so a song title
 * never triggers an artist walk.
 */
async function detectQueryArtist(
  keyword: string,
  tokens: string[],
  signal?: AbortSignal,
): Promise<QueryArtist | null> {
  const words = keyword.trim().split(/\s+/).filter(Boolean)
  const compact = tokens.join('')
  if (!compact) return null

  if (tokens.length > 1) {
    const queries = [...new Set([words.join(' '), words[words.length - 1], words[0]])]
    const lists = await Promise.all(
      queries.map((query) => searchArtists(query, signal).catch(() => [])),
    )
    const artists = new Map<number, { id: number; name: string }>()
    for (const artist of lists.flat()) {
      if (artist?.id && !artists.has(artist.id)) artists.set(artist.id, artist)
    }
    const named = [...artists.values()].map((artist) => ({
      ...artist,
      key: normalizeDeep(artist.name),
    }))
    const whole = named.find((artist) => artist.key === compact)
    if (whole) return { ...whole, titleTokens: [], whole: true }
    // Longest suffix / prefix first: "taylor swift" beats "swift".
    for (let size = tokens.length - 1; size >= 1; size -= 1) {
      const suffix = tokens.slice(-size).join('')
      const prefix = tokens.slice(0, size).join('')
      const last = named.find((artist) => artist.key === suffix)
      if (last) return { ...last, titleTokens: tokens.slice(0, -size), whole: false }
      const first = named.find((artist) => artist.key === prefix)
      if (first) return { ...first, titleTokens: tokens.slice(size), whole: false }
    }
    return null
  }

  // One word: an artist name glued to the title ("周杰伦一路向北").
  const token = tokens[0]
  if (token.length < 4) return null
  const artists = (await searchArtists(keyword, signal).catch(() => [])).slice(0, 5)
  for (const artist of artists) {
    const key = normalizeDeep(artist.name)
    if (key.length < 2 || key === token || token.length - key.length < 2) continue
    if (token.startsWith(key)) {
      return { id: artist.id, name: artist.name, key, titleTokens: [token.slice(key.length)], whole: false }
    }
    if (token.endsWith(key)) {
      return { id: artist.id, name: artist.name, key, titleTokens: [token.slice(0, -key.length)], whole: false }
    }
  }
  return null
}

/** All songs of the artist's newest albums (an artist query, "New Jeans"). */
async function artistCatalogue(
  artist: QueryArtist,
  tokens: string[],
  signal: AbortSignal | undefined,
  report: DeepReport,
): Promise<DeepSearchHit[]> {
  const albums = (
    await fetchArtistAlbums(artist.id, 24, 0, signal).catch(() => [])
  ).slice(0, ARTIST_CATALOGUE_ALBUMS)
  const byAlbum = new Map<number, DeepSearchHit[]>()
  // Album order (newest first), whichever worker finished first.
  const collect = () => {
    const seen = new Set<number>()
    const hits: DeepSearchHit[] = []
    for (const album of albums) {
      for (const hit of byAlbum.get(album.id) ?? []) {
        if (seen.has(hit.song.id)) continue
        seen.add(hit.song.id)
        hits.push(hit)
      }
    }
    return hits
  }
  await scanDeepAlbums(
    albums,
    signal,
    (detail, album) => {
      byAlbum.set(
        album.id,
        (detail.songs ?? [])
          // The section is about originals: instrumental cuts and remixes of
          // the same record would only bury the actual album tracks.
          .filter((song) => !unwantedVersion(song, tokens))
          .map((song) => ({
            song,
            albumId: album.id,
            albumName: detail.name || album.name,
            source: 'artist' as const,
          })),
      )
      report.partial(collect())
    },
    (done, total) => report.progress({ stage: 'artist', artist: artist.name, done, total }),
  )
  return collect()
}

/**
 * "歌名 歌手": the original is on one of that artist's releases, which the
 * artist page lists even when the track is delisted. Stops as soon as the
 * exact title, credited to the artist, turns up.
 */
async function findTitleInArtist(
  artist: QueryArtist,
  tokens: string[],
  refs: number[],
  signal: AbortSignal | undefined,
  report: DeepReport,
): Promise<DeepSearchHit[]> {
  const titleTokens = artist.titleTokens
  const titlePhrase = titleTokens.join('')
  if (!titlePhrase) return []
  const albums = await fetchArtistAlbums(artist.id, ARTIST_TITLE_ALBUMS, 0, signal).catch(
    () => [],
  )
  const scored = new Map<number, { hit: DeepSearchHit; score: number; exact: boolean }>()
  const rank = () =>
    [...scored.values()]
      .sort(
        (a, b) =>
          Number(b.exact) - Number(a.exact) ||
          b.score - a.score ||
          a.hit.song.name.length - b.hit.song.name.length,
      )
      .slice(0, DEEP_RESULT_LIMIT)
      .map((entry) => entry.hit)

  await scanDeepAlbums(
    albums,
    signal,
    (detail, album) => {
      let found = false
      for (const song of detail.songs ?? []) {
        if (unwantedVersion(song, tokens)) continue
        const name = normalizeDeep(song.name)
        const matches =
          name.includes(titlePhrase) ||
          titleTokens.every((token) => looseTokenMatch(name, token))
        if (!matches) continue
        const exact = name === titlePhrase
        const credited = song.ar.some((item) => normalizeDeep(item.name) === artist.key)
        const bonus = durationBonus(song, refs)
        const score =
          (exact ? 10 : 0) + (name.startsWith(titlePhrase) ? 4 : 0) + (credited ? 8 : 0) + bonus
        const existing = scored.get(song.id)
        if (existing && existing.score >= score) continue
        scored.set(song.id, {
          hit: { song, albumId: album.id, albumName: detail.name || album.name, source: 'artist' },
          score,
          exact,
        })
        if (exact && credited && bonus >= 0) found = true
      }
      report.partial(rank())
      return found
    },
    (done, total) => report.progress({ stage: 'artist', artist: artist.name, done, total }),
  )
  return rank()
}

/* ------------------------------ album search ----------------------------- */

/**
 * NetEase album candidates guessed from QQ Music metadata. QQ keeps the
 * original release album of delisted tracks ("爱情公寓3 电视剧原声带"), which
 * the NetEase song index no longer returns; its album search still finds the
 * matching release.
 */
async function resolveQqAlbums(
  matches: QqSongMatch[],
  tokens: string[],
  signal?: AbortSignal,
) {
  if (!matches.length) return [] as Array<{ id: number; name: string }>

  const scored: Array<{ album: string; albummid?: string; singers: string; score: number }> = []
  for (const match of matches) {
    if (!match.album) continue
    const name = normalizeDeep(match.name)
    // Only keep QQ rows that actually are the requested song.
    if (!tokens.some((token) => name.includes(token))) continue
    const singers = normalizeDeep(match.singers)
    const album = normalizeDeep(match.album)
    // A row whose singer or album echoes the query is far more likely to be
    // the release we want than the first cover that shares the title; a paid
    // row is the licensed release rather than a re-upload.
    const score =
      (tokens.some((token) => singers.includes(token)) ? 0 : 2) +
      (tokens.some((token) => album.includes(token)) ? 0 : 1) +
      (match.pay ? 0 : 0.5)
    scored.push({ album: match.album, albummid: match.albummid, singers: match.singers, score })
  }
  const candidates: typeof scored = []
  for (const item of scored.sort((a, b) => a.score - b.score)) {
    // One release can appear as several rows (deluxe/edition titles differ by a
    // suffix); `albummid` collapses those, the name is only the fallback.
    const duplicate = candidates.some((entry) =>
      item.albummid ? entry.albummid === item.albummid : entry.album === item.album,
    )
    if (duplicate) continue
    candidates.push(item)
    if (candidates.length >= 3) break
  }

  const perCandidate = await Promise.all(
    candidates.map(async (candidate) => {
      const head = normalizeDeep(candidate.album.split(/\s+/)[0] ?? '')
      const singer = candidate.singers.split(/[/;、]/)[0]?.trim() ?? ''
      const singerNorm = normalizeDeep(singer)
      // The album name alone ranks best for soundtracks ("爱情公寓3 …"), while
      // the singer is needed for generic titles where covers dominate.
      let list = await searchAlbumsV1(candidate.album, signal)
      if (
        singerNorm &&
        !list.some((album) => normalizeDeep(album.artist?.name ?? '').includes(singerNorm))
      ) {
        const extra = await searchAlbumsV1(`${candidate.album} ${singer}`, signal)
        const seen = new Set(list.map((album) => album.id))
        list = [...list, ...extra.filter((album) => !seen.has(album.id))]
      }
      const rank = (album: { name: string; artist?: { name?: string } }) =>
        (head && normalizeDeep(album.name).includes(head) ? 0 : 2) +
        (singerNorm && normalizeDeep(album.artist?.name ?? '').includes(singerNorm) ? 0 : 1)
      return [...list].sort((a, b) => rank(a) - rank(b)).slice(0, 5)
    }),
  )
  return perCandidate.flat()
}

/**
 * A bare song title ("彩色的黑") cannot be told apart from its covers by
 * NetEase alone — every upload is titled the same. QQ Music keeps the original
 * release high in its ranking, so read the singer off its exact-title rows
 * (paid originals first) and search NetEase for "歌名 歌手": that surfaces the
 * single or album holding the gray original.
 */
async function resolveOriginalViaQq(
  keyword: string,
  target: string,
  matches: QqSongMatch[],
  signal: AbortSignal | undefined,
): Promise<DeepSearchHit[]> {
  if (!target || !matches.length) return []
  const rows = matches
    .filter((match) => normalizeDeep(match.name) === target)
    .sort((a, b) => Number(Boolean(b.pay)) - Number(Boolean(a.pay)))
  const singers: string[] = []
  for (const row of rows) {
    for (const raw of String(row.singers || '').split(/[/;、]/)) {
      const name = raw.trim()
      if (name && !singers.includes(name)) singers.push(name)
    }
    if (singers.length >= 3) break
  }
  if (!singers.length) return []

  // Every singer's album search at once; the albums are then read in order.
  const albumLists = await Promise.all(
    singers.slice(0, 3).map((singer) => searchAlbumsV1(`${keyword} ${singer}`, signal)),
  )
  for (let index = 0; index < albumLists.length; index += 1) {
    if (signal?.aborted) return []
    const singer = singers[index]
    const singerNorm = normalizeDeep(singer)
    const refs = durationRefs(matches, [target], singer)
    const found = new Map<number, { hit: DeepSearchHit; score: number }>()
    await scanDeepAlbums(albumLists[index].slice(0, 3), signal, (detail, album) => {
      for (const song of detail.songs ?? []) {
        const name = normalizeDeep(song.name)
        if (!looseTokenMatch(name, target)) continue
        // The credits must be the singer QQ named; otherwise this is just
        // another upload with the same title.
        if (!song.ar.some((artist) => normalizeDeep(artist.name).includes(singerNorm))) continue
        const score =
          (name === target ? 10 : 0) +
          durationBonus(song, refs) -
          (unwantedVersion(song, [target]) ? 6 : 0)
        const existing = found.get(song.id)
        if (existing && existing.score >= score) continue
        found.set(song.id, {
          hit: { song, albumId: album.id, albumName: detail.name || album.name, source: 'qq' },
          score,
        })
      }
    })
    // One singer with a real hit is enough; later QQ rows are usually live or
    // cover versions of the same title.
    if (found.size) {
      return [...found.values()]
        .sort((a, b) => b.score - a.score || a.hit.song.name.length - b.hit.song.name.length)
        .map((entry) => entry.hit)
    }
  }
  return []
}

/**
 * "歌名 + 专辑名" queries. The song index hides delisted originals, but a fuzzy
 * album search still finds the release and its track list names the song, so
 * scan album tracks and score them against the query words.
 */
async function deepSearchByAlbum(
  keyword: string,
  tokens: string[],
  refs: number[],
  signal: AbortSignal | undefined,
  report: DeepReport,
): Promise<DeepSearchHit[]> {
  if (!tokens.length || signal?.aborted) return []
  const words = keyword.trim().split(/\s+/).filter(Boolean)
  const albumToken = tokens[tokens.length - 1] ?? ''

  // The full query and each word alone, plus the artist named by the album
  // word — all at once. A title-heavy full query fills up with same-named
  // cover albums, and the real release only shows up under the album word.
  const [lists, artists] = await Promise.all([
    Promise.all([...new Set([words.join(' '), ...words])].map((query) => searchAlbumsV1(query, signal))),
    albumToken
      ? searchArtists(words[words.length - 1] ?? albumToken, signal).catch(() => [])
      : Promise.resolve([] as Awaited<ReturnType<typeof searchArtists>>),
  ])
  const albums = new Map<number, { id: number; name: string; size?: number }>()
  for (const album of lists.flat()) {
    if (!albums.has(album.id)) albums.set(album.id, album)
  }

  // Releases containing the album word first — that is where the original
  // soundtrack sits; a real soundtrack has more tracks than a one-off single.
  const chosen = [...albums.values()]
    .sort((a, b) => {
      const hitA = albumToken && normalizeDeep(a.name).includes(albumToken) ? 0 : 1
      const hitB = albumToken && normalizeDeep(b.name).includes(albumToken) ? 0 : 1
      if (hitA !== hitB) return hitA - hitB
      return (Number(b.size) || 0) - (Number(a.size) || 0)
    })
    .slice(0, ALBUM_MODE_LIMIT)

  // NetEase hides delisted official releases from album *search* the same way
  // it hides gray songs, but the artist page still lists them.
  const artist = artists.find((item) => normalizeDeep(item.name) === albumToken)
  const artistAlbums = artist
    ? (await fetchArtistAlbums(artist.id, 24, 0, signal).catch(() => [])).slice(0, 24)
    : []

  const queue: Array<{ id: number; name: string; fromArtist: boolean }> = []
  const queued = new Set<number>()
  for (const album of chosen) {
    queued.add(album.id)
    queue.push({ id: album.id, name: album.name, fromArtist: false })
  }
  for (const album of artistAlbums) {
    if (queued.has(album.id)) continue
    queued.add(album.id)
    queue.push({ id: album.id, name: album.name, fromArtist: true })
  }
  if (!queue.length) return []

  // Tracks must match the *song* words; otherwise a soundtrack album would
  // contribute every instrumental cue it contains.
  const titleTokens = tokens.length > 1 ? tokens.slice(0, -1) : tokens
  // "Cookie" (bare) is the original title; "NewJeans Cookie" or
  // "NewJeans Y2K Kpop Type Beat \"Cookie\"" only quote it.
  const titlePhrase = titleTokens.join('')

  const scored = new Map<number, { hit: DeepSearchHit; score: number; exact: boolean }>()
  const rank = () =>
    [...scored.values()]
      .sort(
        (a, b) =>
          // A title that *is* the queried song wins over one that merely quotes
          // it; shorter titles are closer to the bare original.
          Number(b.exact) - Number(a.exact) ||
          b.score - a.score ||
          a.hit.song.name.length - b.hit.song.name.length,
      )
      .slice(0, DEEP_RESULT_LIMIT)
      .map((entry) => entry.hit)

  await scanDeepAlbums(
    queue,
    signal,
    (detail, album) => {
      const albumName = detail.name || album.name
      // Official releases are EPs or albums; a one-track entry is usually a
      // single that just repeats the drama name in its title.
      const albumIsFullRecord = album.fromArtist || (detail.songs?.length ?? 0) >= 4
      for (const song of detail.songs ?? []) {
        // Remixes and covers share the title but are not "the track on this
        // album"; they would drown out the original in a short list.
        if (unwantedVersion(song, tokens)) continue
        const nameNorm = normalizeDeep(song.name)
        if (!titleTokens.some((token) => nameNorm.includes(token))) continue
        const albumNorm = normalizeDeep(albumName)
        const artistParts = song.ar.map((item) => normalizeDeep(item.name))
        const artistsNorm = artistParts.join(' ')
        const exact = Boolean(titlePhrase) && nameNorm === titlePhrase
        // "cookie newjeans": the credited artist matching the album word is
        // the original; a random uploader is not.
        const artistExact = Boolean(albumToken) && artistParts.includes(albumToken)
        let score = 0
        for (const token of tokens) {
          if (nameNorm.includes(token)) score += 4
          if (albumNorm.includes(token)) score += 3
          if (artistsNorm.includes(token)) score += 2
        }
        if (albumToken && albumNorm.includes(albumToken)) score += 4
        if (albumIsFullRecord) score += 6
        if (exact) score += 10
        if (artistExact) score += 8
        score += durationBonus(song, refs)
        if (score <= 0) continue
        const existing = scored.get(song.id)
        if (existing && existing.score >= score) continue
        scored.set(song.id, {
          hit: {
            song,
            albumId: album.id,
            albumName,
            source: album.fromArtist ? 'artist' : 'album',
          },
          score,
          exact,
        })
      }
      report.partial(rank())
    },
    (done, total) => report.progress({ stage: 'albums', done, total }),
  )
  return rank()
}

/* --------------------------------- entry --------------------------------- */

export async function deepSearchSongs(
  keyword: string,
  signal?: AbortSignal,
  mode: DeepSearchMode = 'artist',
  options: DeepSearchOptions = {},
): Promise<DeepSearchHit[]> {
  const tokens = deepTokens(keyword)
  if (!tokens.length) return []

  // The two modes read the query differently and return different rows, so the
  // cache key has to carry the mode.
  const cacheKey = `${mode}:${tokens.join(' ')}`
  const cached = deepSearchCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DEEP_SEARCH_TTL) return cached.hits

  const report: DeepReport = {
    progress: (progress) => {
      if (!signal?.aborted) options.onProgress?.(progress)
    },
    partial: (hits) => {
      if (!signal?.aborted && hits.length) options.onPartial?.(hits)
    },
  }
  const finish = (hits: DeepSearchHit[]) => {
    if (signal?.aborted) return []
    // Only real answers are cached: an empty list is often a throttled
    // provider, and caching it hid the song for five minutes.
    if (hits.length) remember(deepSearchCache, cacheKey, { at: Date.now(), hits })
    return hits
  }

  // Independent lookups start together; the stages below await them in the
  // same priority order as before, so a fast answer is never held up by a
  // slow provider it does not need.
  const qq = qqMatches(keyword)
  const web = webCandidates(keyword, signal).catch(() => [] as Song[])
  const artistGuess = detectQueryArtist(keyword, tokens, signal).catch(() => null)
  let albumSearch: Promise<Awaited<ReturnType<typeof searchAlbumsV1>>> | null = null
  const albumList = () => (albumSearch ??= searchAlbumsWithRetry(keyword, signal, 30))
  if (mode === 'artist') void albumList()

  // 1. A bare title: QQ's ranking still knows which singer released it.
  if (tokens.length === 1) {
    report.progress({ stage: 'qq' })
    const matches = await orAbort(within(qq, QQ_FIRST_WAIT, []), signal, [])
    const hits = await resolveOriginalViaQq(keyword, tokens[0], matches, signal)
    if (signal?.aborted) return []
    if (hits.length) return finish(hits)
  }

  // 2. Album mode: the trailing words name the release, so read track lists.
  if (mode === 'album') {
    report.progress({ stage: 'albums' })
    const refs = durationRefs(
      await orAbort(within(qq, QQ_HINT_WAIT, []), signal, []),
      tokens.length > 1 ? tokens.slice(0, -1) : tokens,
    )
    const hits = await deepSearchByAlbum(keyword, tokens, refs, signal, report)
    if (signal?.aborted) return []
    if (hits.length) return finish(hits)
  }

  // 3. The query names an artist.
  const guess = await orAbort(artistGuess, signal, null)
  // "周杰伦一路向北" is matched below as "一路向北 周杰伦".
  const effective = guess && !guess.whole ? [...guess.titleTokens, guess.key] : tokens
  const titleTokens = guess && !guess.whole ? guess.titleTokens : tokens
  if (guess?.whole) {
    report.progress({ stage: 'artist', artist: guess.name })
    const hits = await artistCatalogue(guess, tokens, signal, report)
    if (signal?.aborted) return []
    if (hits.length) return finish(hits)
  } else if (guess) {
    // The web lookup (already running) often names the original with the
    // right credits in one request; only walk the discography when it did not.
    report.progress({ stage: 'web' })
    const refs = durationRefs(await orAbort(within(qq, QQ_HINT_WAIT, []), signal, []), titleTokens)
    const webHits = rankWebHits(await orAbort(web, signal, []), effective, refs, guess.key)
    const titlePhrase = guess.titleTokens.join('')
    const credited = webHits.some(
      (hit) =>
        normalizeDeep(hit.song.name) === titlePhrase &&
        hit.song.ar.some((item) => normalizeDeep(item.name) === guess.key),
    )
    if (credited) return finish(webHits)
    report.progress({ stage: 'artist', artist: guess.name })
    const hits = await findTitleInArtist(guess, effective, refs, signal, report)
    if (signal?.aborted) return []
    if (hits.length) return finish(hits)
  }

  // 4. Web lookup, verified against title + artists + album.
  report.progress({ stage: 'web' })
  const qqNow = await orAbort(within(qq, QQ_HINT_WAIT, []), signal, [])
  const refs = durationRefs(qqNow, titleTokens)
  const webHits = rankWebHits(await orAbort(web, signal, []), effective, refs)
  if (signal?.aborted) return []
  if (webHits.length) return finish(webHits)

  // 5. Scan albums: QQ's release albums first, then NetEase's v1 album search
  // (which ranks the original album of a gray track higher than cloudsearch).
  report.progress({ stage: 'albums' })
  const [qqAll, v1] = await Promise.all([
    orAbort(qq, signal, []),
    orAbort(albumList(), signal, []),
  ])
  const qqAlbums = await resolveQqAlbums(qqAll, effective, signal).catch(() => [])
  if (signal?.aborted) return []
  const allRefs = durationRefs(qqAll, titleTokens)
  const byId = new Map<number, { id: number; name: string }>()
  for (const album of [...qqAlbums, ...v1]) {
    if (album?.id && !byId.has(album.id)) byId.set(album.id, album)
  }
  // A single word matches far too many albums; keep title-only scans short.
  const albums = [...byId.values()].slice(0, effective.length === 1 ? 8 : DEEP_SEARCH_ALBUM_LIMIT)
  if (!albums.length) return finish([])

  const hits = new Map<number, DeepSearchHit & { score: number }>()
  const rank = () =>
    [...hits.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, DEEP_RESULT_LIMIT)
      .map(({ song, albumId, albumName, source }) => ({ song, albumId, albumName, source }))
  await scanDeepAlbums(
    albums,
    signal,
    (detail, album) => {
      const albumName = detail.name || album.name
      for (const song of detail.songs ?? []) {
        if (!decoratedAllowed(song, effective)) continue
        const score = deepMatchScore(song, albumName, effective, allRefs)
        if (score <= 0) continue
        const existing = hits.get(song.id)
        if (existing && existing.score >= score) continue
        hits.set(song.id, {
          song,
          albumId: detail.id ?? album.id,
          albumName,
          source: 'album',
          score,
        })
      }
      report.partial(rank())
    },
    (done, total) => report.progress({ stage: 'albums', done, total }),
  )
  return finish(rank())
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
