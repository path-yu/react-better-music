import type { Mv, VideoItem, VideoSearchItem } from '../types'

/** Minimal shape of one item from `/mlog/music/rcmd`. */
export interface RawRelatedVideoFeed {
  id?: string
  resource?: {
    mlogBaseData?: {
      id?: string
      /** 2 = user Mlog, 3 = official MV. */
      type?: number
      threadId?: string
      originalTitle?: string
      text?: string
      desc?: string
      coverUrl?: string
      coverWidth?: number
      coverHeight?: number
      coverDetail?: {
        horizontalCoverImage?: { imageUrl?: string }
        verticalCoverImage?: { imageUrl?: string }
      }
      duration?: number
      video?: {
        videoKey?: string
        width?: number
        height?: number
        playCount?: number | null
      }
      videos?: Array<{ width?: number; height?: number }>
    }
    mlogExtVO?: {
      playCount?: number
      song?: { artists?: Array<{ artistName?: string }> }
    }
    userProfile?: { nickname?: string }
    mvBaseData?: {
      id?: number
      name?: string
      cover?: string
      artistName?: string
      duration?: number
      playCount?: number
    }
  }
}

/** Search results label MVs and user videos differently; both play in the HUD. */
export function videoFromMv(mv: Mv): VideoItem {
  return {
    kind: 'mv',
    id: mv.id,
    title: mv.name,
    cover: mv.cover ?? mv.picUrl,
    artist: mv.artistName ?? mv.artists?.map((artist) => artist.name).join(' / '),
    duration: mv.duration,
    playCount: mv.playCount,
  }
}

export function videoFromSearch(raw: VideoSearchItem): VideoItem | null {
  if (!raw?.vid) return null
  return {
    kind: 'video',
    id: raw.vid,
    title: raw.title || '视频',
    cover: raw.coverUrl,
    artist: (raw.creator ?? [])
      .map((creator) => creator.userName)
      .filter(Boolean)
      .join(' / '),
    duration: raw.durationms,
    playCount: raw.playTime,
  }
}

/**
 * A song's "related videos" are mostly Mlogs (user clips) but the endpoint can
 * also return the song's official MV first when `mvid` is passed.
 */
export function relatedVideoFromFeed(feed: RawRelatedVideoFeed): VideoItem | null {
  const mv = feed?.resource?.mvBaseData
  if (mv?.id) {
    return {
      kind: 'mv',
      id: mv.id,
      title: mv.name || 'MV',
      cover: mv.cover,
      artist: mv.artistName,
      duration: mv.duration,
      playCount: mv.playCount,
    }
  }

  const mlog = feed?.resource?.mlogBaseData
  if (!mlog?.id) return null

  // Official MVs come back as mlog type 3 with `video: null` and a `videos`
  // rendition list; they must be played through `/mv/url`, not `/mlog/url`.
  const isMv = Number(mlog.type) === 3 || Boolean(mlog.threadId?.startsWith('R_MV_'))
  if (isMv) {
    const artist = (feed.resource?.mlogExtVO?.song?.artists ?? [])
      .map((entry) => entry.artistName)
      .filter(Boolean)
      .join(' / ')
    const rendition = mlog.videos?.[0]
    return {
      kind: 'mv',
      id: mlog.id,
      title: mlog.originalTitle || mlog.text || 'MV',
      cover:
        mlog.coverUrl ??
        mlog.coverDetail?.horizontalCoverImage?.imageUrl ??
        mlog.coverDetail?.verticalCoverImage?.imageUrl,
      artist,
      duration: mlog.duration,
      playCount: feed.resource?.mlogExtVO?.playCount,
      width: rendition?.width || mlog.coverWidth,
      height: rendition?.height || mlog.coverHeight,
    }
  }

  if (!mlog.video) return null
  return {
    kind: 'mlog',
    id: mlog.id,
    title: mlog.originalTitle || mlog.text || mlog.desc || '视频',
    cover:
      mlog.coverUrl ??
      mlog.coverDetail?.horizontalCoverImage?.imageUrl ??
      mlog.coverDetail?.verticalCoverImage?.imageUrl,
    artist: feed.resource?.userProfile?.nickname,
    duration: mlog.duration,
    playCount: mlog.video.playCount ?? undefined,
    width: mlog.video.width,
    height: mlog.video.height,
  }
}

/** True when a known source is taller than it is wide (mlog clips). */
export function isPortraitVideo(item: Pick<VideoItem, 'width' | 'height'>) {
  return Boolean(item.width && item.height && item.height > item.width)
}
