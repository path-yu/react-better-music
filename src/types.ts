export interface Artist {
  id: number
  name: string
}

export interface ArtistSummary {
  id: number
  name: string
  picUrl?: string
  alias?: string[]
  transNames?: string[]
  briefDesc?: string
  albumSize?: number
  musicSize?: number
  mvSize?: number
  fansCount?: number
}

export interface ArtistProfile extends ArtistSummary {
  cover?: string
  avatar?: string
  identities?: string[]
  rank?: { rank: number; type: number }
}

export interface ArtistAlbum {
  id: number
  name: string
  picUrl?: string
  blurPicUrl?: string
  publishTime?: number
  size?: number
  type?: string
  artist?: Artist
}

export interface Album {
  id: number
  name: string
  picUrl?: string
  blurPicUrl?: string
  artist?: Artist
  artists?: Artist[]
  publishTime?: number
  size?: number
}

export interface AlbumDetail extends ArtistAlbum {
  company?: string
  description?: string
  briefDesc?: string
  commentThreadId?: string
  tags?: string[]
  artists?: Artist[]
  songs: Song[]
}

export type PlayLevel = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'hires'

/** NetEase's own copyright hint attached to songs in list payloads. */
export interface NoCopyrightRcmd {
  type?: number
  /** User-facing text; empty when there is nothing to report. */
  typeDesc?: string
  typeDesc2?: string
}

export interface Song {
  id: number
  name: string
  ar: Artist[]
  al: Album
  dt: number
  fee?: number
  noCopyrightRcmd?: NoCopyrightRcmd | null
  mv?: number
  mvid?: number
  alia?: string[]
  tns?: string[]
  pc?: boolean
  /** enriched at runtime */
  url?: string
  urlFetchedAt?: number
  /** URL resolved by `/song/url/match` (third-party provider, not NetEase CDN). */
  unblocked?: boolean
  /** Provider module that produced the matched URL (e.g. `unm`, `gdmusic`). */
  matchedSource?: string
  /** Trial length in seconds when NetEase only returns a preview clip. */
  trialEnd?: number | null
  lyric?: string
  tlyric?: string
  yrc?: string
  isNotLyric?: boolean
  like?: boolean
}

export interface ToplistTrack {
  id?: number
  name?: string
  first?: string
  second?: string
  ar?: Artist[]
}

export interface Toplist {
  id: number
  name: string
  coverImgUrl: string
  updateFrequency?: string
  trackCount?: number
  playCount?: number
  description?: string
  tracks?: ToplistTrack[]
}

export interface Playlist {
  id: number
  name: string
  coverImgUrl: string
  picUrl?: string
  description?: string
  trackCount: number
  playCount: number
  subscribedCount?: number
  shareCount?: number
  subscribed?: boolean
  creator: {
    userId: number
    nickname: string
    avatarUrl?: string
    /** Present when the creator is an artist account, not a normal listener. */
    artistId?: number | string
    userType?: number
  }
  tags?: string[]
  createTime?: number
  updateTime?: number
  userId?: number
  isMyLike?: boolean
}

export interface Banner {
  imageUrl: string
  targetId?: number
  targetType?: number
  typeTitle?: string
  url?: string
  titleColor?: string
}

export interface Mv {
  id: number
  name: string
  cover?: string
  picUrl?: string
  artistName?: string
  artists?: Artist[]
  playCount?: number
  duration?: number
  publishTime?: string
  briefDesc?: string
  desc?: string
  artistId?: number
  subCount?: number
  shareCount?: number
  commentCount?: number
}

export interface CommentUser {
  userId: number
  nickname: string
  avatarUrl: string
}

export interface Comment {
  commentId: number
  content: string
  time: number
  liked: boolean
  likedCount: number
  user: CommentUser
  beReplied: Comment[]
  beRepliedUser?: CommentUser
}

export interface CommentResponse {
  total: number
  hotComments?: Comment[]
  comments: Comment[]
  more?: boolean
}

export interface UserProfile {
  userId: number
  nickname: string
  avatarUrl: string
  signature?: string
  description?: string
  detailDescription?: string
  backgroundUrl?: string
  gender?: number
  birthday?: number
  province?: number
  city?: number
  vipType?: number
  follows?: number
  followeds?: number
  eventCount?: number
  playlistCount?: number
  createTime?: number
}

export interface UserSummary {
  userId: number
  nickname: string
  avatarUrl?: string
  signature?: string
  gender?: number
  vipType?: number
  follows?: number
  followeds?: number
  playlistCount?: number
}

export interface UserDetail {
  code: number
  level: number
  listenSongs?: number
  profile: UserProfile
  pcSign?: boolean
}

/** A playable video from search, an MV, or a song-related mlog. */
export type VideoKind = 'mv' | 'video' | 'mlog'

export interface VideoItem {
  kind: VideoKind
  /** MVs use numeric ids; video/mlog ids are strings. */
  id: number | string
  title: string
  cover?: string
  artist?: string
  duration?: number
  playCount?: number
  /** Natural dimensions when the source exposes them (mlog feeds do). */
  width?: number
  height?: number
}

/** Raw shape returned by `/cloudsearch?type=1014`. */
export interface VideoSearchItem {
  vid: string
  title: string
  coverUrl?: string
  durationms?: number
  playTime?: number
  creator?: Array<{ userId: number; userName: string }>
}

export interface SearchResult {
  songs?: Song[]
  songCount?: number
  playlists?: Playlist[]
  playlistCount?: number
  albums?: Album[]
  albumCount?: number
  artists?: ArtistSummary[]
  artistCount?: number
  mvs?: VideoItem[]
  mvCount?: number
  videos?: VideoItem[]
  videoCount?: number
  users?: UserSummary[]
  userCount?: number
}

export interface ApiResponse<T = unknown> {
  code: number
  data?: T
  [key: string]: unknown
}
