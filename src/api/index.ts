import type {
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
  PlayLevel,
} from '../types'
import { get, postForm, uploadFile } from '../lib/http'
import { normalizeMv, normalizePlaylist, normalizeSongs, type RawSong } from '../lib/songs'

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

export async function fetchPlaylistDetail(id: string | number) {
  const res = await get<{ playlist: Playlist }>('/playlist/detail', {
    id,
    timestamp: Date.now(),
  })
  return normalizePlaylist(res.playlist)
}

export async function fetchPlaylistTracks(id: string | number, limit = 300, offset = 0) {
  const res = await get<{ songs?: Parameters<typeof normalizeSongs>[0] }>(
    '/playlist/track/all',
    { id, limit, offset, timestamp: Date.now() },
  )
  return normalizeSongs(res.songs)
}

export async function fetchAllPlaylistTracks(id: string | number, trackCount: number) {
  const first = await fetchPlaylistTracks(id, 300, 0)
  if (trackCount <= 300) return first
  const requests: Array<Promise<Song[]>> = []
  const pages = Math.ceil((trackCount - 300) / 300)
  for (let index = 1; index <= pages; index += 1) {
    requests.push(fetchPlaylistTracks(id, 300, index * 300))
  }
  const rest = await Promise.allSettled(requests)
  const merged = [...first]
  rest.forEach((item) => {
    if (item.status === 'fulfilled') merged.push(...item.value)
  })
  return merged
}

export async function updatePlaylistInfo(params: {
  id: string | number
  name: string
  tags: string
  desc: string
}) {
  return get<ApiResponse>('/playlist/update', { ...params, timestamp: Date.now() })
}

export async function updatePlaylistTags(params: { id: number | string; tags: string }) {
  return get<ApiResponse>('/playlist/tags/update', { ...params, timestamp: Date.now() })
}

export function updatePlaylistCover(file: File, imgSize: number, id: string | number) {
  return uploadFile<{ code: number; data?: { url: string } }>('/playlist/cover/update', file, {
    timestamp: Date.now(),
    imgSize,
    id,
  })
}

export async function updatePlaylistSubscribe(params: { id: string | number; t: 1 | 2 }) {
  return get<ApiResponse>('/playlist/subscribe', { ...params, timestamp: Date.now() })
}

export async function updatePlaylistTracks(params: {
  tracks: number
  pid: number
  op: 'add' | 'del'
}) {
  return get<{ code: number; body?: { code: number; message?: string; count?: number } }>(
    '/playlist/tracks',
    { ...params, timestamp: Date.now() },
  )
}

export async function createPlaylist(params: { name: string; privacy?: string }) {
  return get<{ code: number; playlist?: Playlist }>('/playlist/create', {
    ...params,
    timestamp: Date.now(),
  })
}

export async function fetchSimilarPlaylists(id: string | number) {
  const res = await get<{ playlists?: Playlist[] }>('/simi/playlist', { id })
  return (res.playlists ?? []).map(normalizePlaylist)
}

export async function fetchSimilarSongs(id: string | number) {
  const res = await get<{ songs?: Parameters<typeof normalizeSongs>[0] }>('/simi/song', { id })
  return normalizeSongs(res.songs)
}

/* ---------------------------------- song --------------------------------- */

export async function fetchSongUrl(id: number | string, level: PlayLevel = 'exhigh') {
  const res = await get<{ data?: Array<{ url: string | null }> }>('/song/url/v1', {
    id,
    level,
  })
  return secureMediaUrl(res.data?.[0]?.url)
}

export async function checkMusicAvailable(id: number | string) {
  const res = await get<{ success?: boolean; musicSuccess?: boolean; message?: string }>(
    '/check/music',
    { id },
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

export function fetchMusicComments(params: CommentQuery) {
  return get<CommentResponse>('/comment/music', { ...params, timestamp: Date.now() })
}

export function fetchPlaylistComments(params: CommentQuery) {
  return get<CommentResponse>('/comment/playlist', { ...params, timestamp: Date.now() })
}

export function fetchMvComments(params: CommentQuery) {
  return get<CommentResponse>('/comment/mv', { ...params, timestamp: Date.now() })
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

export async function fetchMvList(options: {
  limit?: number
  offset?: number
  area?: string
  order?: string
  type?: string
}) {
  const res = await get<{ data?: Mv[]; count?: number }>('/mv/all', {
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    area: options.area ?? '全部',
    order: options.order ?? '最热',
    type: options.type ?? '全部',
  })
  return {
    list: (res.data ?? []).map(normalizeMv),
    count: res.count ?? 0,
  }
}

export async function fetchMvDetail(mvid: number | string) {
  const res = await get<{ data?: Mv }>('/mv/detail', { mvid })
  return res.data ? normalizeMv(res.data) : null
}

export async function fetchMvUrl(id: number | string) {
  const res = await get<{ data?: { url?: string } }>('/mv/url', { id })
  return secureMediaUrl(res.data?.url) ?? ''
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
  return res.data?.showKeyword ?? res.data?.realkeyword ?? ''
}

export async function fetchHotSearchList() {
  const res = await get<{
    data?: Array<{ searchWord: string; score: number; content?: string }>
  }>('/search/hot/detail')
  return res.data ?? []
}

export async function fetchSearchSuggest(keywords: string) {
  const res = await get<{
    result?: {
      songs?: Parameters<typeof normalizeSongs>[0]
      playlists?: Playlist[]
    }
  }>('/search/suggest', { keywords })
  return {
    songs: normalizeSongs(res.result?.songs).slice(0, 6),
    playlists: (res.result?.playlists ?? []).slice(0, 4).map(normalizePlaylist),
  }
}

export async function searchAll(params: {
  keywords: string
  type: '1' | '100' | '1000'
  limit?: number
  offset?: number
}) {
  const res = await get<{ result?: SearchResult }>('/cloudsearch', {
    ...params,
    limit: params.limit ?? 30,
    offset: params.offset ?? 0,
    timestamp: Date.now(),
  })
  const result = res.result ?? {}
  return {
    ...result,
    songs: normalizeSongs(result.songs),
    playlists: (result.playlists ?? []).map(normalizePlaylist),
    artists: result.artists ?? [],
  } as SearchResult
}

/* --------------------------------- artist -------------------------------- */

export async function fetchArtistProfile(id: number | string) {
  const res = await get<{ data?: { artist?: ArtistProfile } }>('/artist/detail', { id })
  return res.data?.artist ?? null
}

export async function fetchArtistTopSongs(id: number | string) {
  const res = await get<{ songs?: RawSong[] }>('/artist/top/song', { id })
  return normalizeSongs(res.songs).slice(0, 50)
}

export async function fetchArtistAlbums(
  id: number | string,
  limit = 30,
  offset = 0,
) {
  const res = await get<{ hotAlbums?: ArtistAlbum[] }>('/artist/album', {
    id,
    limit,
    offset,
  })
  return (res.hotAlbums ?? []).map((album) => ({
    ...album,
    picUrl: album.picUrl ?? album.blurPicUrl,
  }))
}

export async function fetchArtistMvs(id: number | string, limit = 12, offset = 0) {
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
  }>('/artist/mv', { id, limit, offset })
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

export async function fetchSimilarArtists(id: number | string) {
  const res = await get<{ artists?: ArtistSummary[] }>('/simi/artist', { id })
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
  ).filter((song) => song.fee !== 0)
}

export async function fetchPersonalFm(limit = 10) {
  const res = await get<{ data?: RawSong[] }>('/personal_fm', {
    limit,
    timestamp: Date.now(),
  })
  return normalizeSongs(res.data).filter((song) => song.fee !== 0)
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
      account?: { id: number } | null
      profile?: UserProfile | null
    }
  }>('/login/status', { timestamp: Date.now() })
}

export async function fetchAccount() {
  return get<{
    account?: { id: number } | null
    profile?: UserProfile | null
  }>('/user/account')
}

export async function fetchUserDetail(uid: number | string) {
  return get<UserDetail>('/user/detail', { uid })
}

export async function fetchUserPlaylists(uid: number | string) {
  const res = await get<{ playlist?: Playlist[] }>('/user/playlist', { uid })
  return (res.playlist ?? []).map(normalizePlaylist)
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

export async function fetchAlbumDetail(id: number | string) {
  const res = await get<{ album?: { picUrl?: string } }>('/album', { id })
  return res.album ?? null
}

/* --------------------------------- batch --------------------------------- */

export function batchRequest(data: Record<string, string>) {
  return postForm<Record<string, unknown>>('/batch', data)
}
