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
  artist?: Artist
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

export interface Song {
  id: number
  name: string
  ar: Artist[]
  al: Album
  dt: number
  fee?: number
  mv?: number
  mvid?: number
  alia?: string[]
  tns?: string[]
  pc?: boolean
  /** enriched at runtime */
  url?: string
  urlFetchedAt?: number
  /** Trial length in seconds when NetEase only returns a preview clip. */
  trialEnd?: number | null
  lyric?: string
  tlyric?: string
  yrc?: string
  isNotLyric?: boolean
  like?: boolean
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
  gender?: number
  birthday?: number
  province?: number
  city?: number
  vipType?: number
  follows?: number
  followeds?: number
  eventCount?: number
}

export interface UserDetail {
  code: number
  level: number
  profile: UserProfile
  pcSign?: boolean
}

export interface SearchResult {
  songs?: Song[]
  songCount?: number
  playlists?: Playlist[]
  playlistCount?: number
  artists?: ArtistSummary[]
  artistCount?: number
}

export interface ApiResponse<T = unknown> {
  code: number
  data?: T
  [key: string]: unknown
}
