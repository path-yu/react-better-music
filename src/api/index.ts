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
  UserDetail,
  UserProfile,
  UserSummary,
  PlayLevel,
  VideoItem,
  VideoSearchItem,
} from '../types'
import { get, invalidateApiCache, uploadFile } from '../lib/http'
import { normalizeMv, normalizePlaylist, normalizeSongs, type RawSong } from '../lib/songs'
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

export async function fetchDailyRecommendSongs() {
  const res = await get<{ data?: { dailySongs?: Parameters<typeof normalizeSongs>[0] } }>(
    '/recommend/songs',
  )
  return normalizeSongs(res.data?.dailySongs).slice(0, 12)
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

export async function fetchPlaylistDetail(id: string | number, signal?: AbortSignal) {
  const res = await get<{ playlist: Playlist }>(
    '/playlist/detail',
    { id, timestamp: Date.now() },
    signal,
  )
  return normalizePlaylist(res.playlist)
}

/** Add a track to one of the signed-in user's playlists. */
export async function addSongToPlaylist(
  playlistId: number | string,
  trackId: number | string,
) {
  return get<{
    code?: number
    status?: number
    body?: { code?: number; message?: string }
  }>('/playlist/tracks', {
    op: 'add',
    pid: playlistId,
    tracks: String(trackId),
    timestamp: Date.now(),
  })
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

/**
 * Load the pages after the first one with bounded concurrency. A 5000-track
 * playlist used to fire 16 parallel requests at once, which the local API
 * rate-limits.
 */
export async function fetchRemainingPlaylistTracks(
  id: string | number,
  trackCount: number,
  signal?: AbortSignal,
) {
  const pages = Math.max(
    0,
    Math.ceil((trackCount - TRACK_PAGE_SIZE) / TRACK_PAGE_SIZE),
  )
  const songs: Song[] = []

  for (let start = 0; start < pages; start += TRACK_FETCH_CONCURRENCY) {
    if (signal?.aborted) break
    const batchSize = Math.min(TRACK_FETCH_CONCURRENCY, pages - start)
    const batch = Array.from({ length: batchSize }, (_, index) =>
      fetchPlaylistTracks(
        id,
        TRACK_PAGE_SIZE,
        (start + index + 1) * TRACK_PAGE_SIZE,
        signal,
      ),
    )
    const settled = await Promise.allSettled(batch)
    settled.forEach((result) => {
      if (result.status === 'fulfilled') songs.push(...result.value)
    })
  }

  return songs
}

const PLAYLIST_MUTATION_PREFIXES = ['/playlist/detail', '/playlist/track/all']

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

export async function fetchSongUrlInfo(id: number | string, level: PlayLevel = 'exhigh') {
  const res = await get<{
    data?: Array<{
      url: string | null
      freeTrialInfo?: { start?: number; end?: number } | null
    }>
  }>('/song/url/v1', { id, level })
  const item = res.data?.[0]
  return {
    url: secureMediaUrl(item?.url),
    /** Seconds of the trial clip; null when the full track is available. */
    trialEnd: item?.freeTrialInfo?.end ?? null,
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
  const res = await get<{ code?: number; data?: unknown; proxyUrl?: string; msg?: string }>(
    '/song/url/match',
    source ? { id, source } : { id },
  )
  return { url: matchedUrl(res.data) || res.proxyUrl || '' }
}

/**
 * Availability verdict for an *undecided* gray track (`fee === 0` with no
 * `noCopyrightRcmd` hint). Normal tracks never need it. `br` defaults to
 * 999000 (highest bitrate) server-side.
 */
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
  return secureMediaUrl(res.data?.url) ?? ''
}

/** User-uploaded videos from `/cloudsearch?type=1014`. */
export async function fetchVideoUrl(id: number | string, signal?: AbortSignal) {
  const res = await get<{
    urls?: Array<{ url?: string }>
    data?: { url?: string }
  }>('/video/url', { id }, signal)
  const direct = secureMediaUrl(res.urls?.[0]?.url ?? res.data?.url)
  if (direct) return direct

  // The cloud-search video list also contains MV ids (type 0). For those,
  // `/video/url` returns `{ urls: [] }`; the same id resolves through
  // `/mv/url`. Without this fallback the detail page shows “暂无视频播放地址”.
  try {
    const mv = await get<{ data?: { url?: string } }>('/mv/url', { id }, signal)
    return secureMediaUrl(mv.data?.url) ?? ''
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

/** Videos attached to a song (Mlog clips, optionally its MV first). */
export async function fetchRelatedVideos(
  songId: number | string,
  mvid?: number | string,
  limit = 12,
  signal?: AbortSignal,
) {
  const res = await get<{ data?: { feeds?: RawRelatedVideoFeed[] } }>(
    '/mlog/music/rcmd',
    // A zero `mv` means "no MV"; sending it makes the endpoint skip the list.
    { songid: songId, mvid: mvid && Number(mvid) > 0 ? mvid : undefined, limit },
    signal,
  )
  return (res.data?.feeds ?? [])
    .map(relatedVideoFromFeed)
    .filter((item): item is VideoItem => Boolean(item))
}

export async function fetchSimilarMv(mvid: number | string) {
  const res = await get<{ mvs?: Mv[] }>('/simi/mv', { mvid })
  return (res.mvs ?? []).map(normalizeMv)
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

/* --------------------------------- artist -------------------------------- */

export async function fetchArtistProfile(id: number | string, signal?: AbortSignal) {
  const res = await get<{ data?: { artist?: ArtistProfile } }>(
    '/artist/detail',
    { id },
    signal,
  )
  return res.data?.artist ?? null
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
  const res = await get<{ albums?: Album[]; count?: number }>(
    '/album/sublist',
    { limit, offset, total: true, timestamp: Date.now() },
    signal,
  )
  const albums = (res.albums ?? []).map((album) => ({
    ...album,
    picUrl: album.picUrl ?? album.blurPicUrl,
    artist: album.artist ?? album.artists?.[0],
  }))
  return { albums, count: res.count ?? albums.length }
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

export async function fetchAlbumDetail(id: number | string): Promise<AlbumDetail | null> {
  // The album object arrives separately from its track list: /album returns
  // `{ album: {...}, songs: [...] }`, and album.songs is usually empty.
  const res = await get<{ album?: Omit<AlbumDetail, 'songs'>; songs?: Song[] }>('/album', { id })
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
