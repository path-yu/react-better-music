import { describe, expect, it } from 'vitest'
import { isPortraitVideo, relatedVideoFromFeed, videoFromMv, videoFromSearch } from './video'
import { normalizeMv } from './songs'

describe('videoFromMv', () => {
  it('maps an MV into the shared video shape', () => {
    const mv = normalizeMv({
      id: 4909,
      name: '超级面对面访谈',
      cover: 'http://example.com/cover.jpg',
      artistName: '周杰伦',
      duration: 542060,
      playCount: 436413,
    })
    expect(videoFromMv(mv)).toEqual({
      kind: 'mv',
      id: 4909,
      title: '超级面对面访谈',
      cover: 'http://example.com/cover.jpg',
      artist: '周杰伦',
      duration: 542060,
      playCount: 436413,
    })
  })
})

describe('videoFromSearch', () => {
  it('normalises cloudsearch videos and joins creators', () => {
    expect(
      videoFromSearch({
        vid: '14484890',
        title: '孤勇者（日语女声MV）',
        coverUrl: 'http://example.com/v.jpg',
        durationms: 256000,
        playTime: 265875,
        creator: [
          { userId: 1, userName: '秋蒂' },
          { userId: 2, userName: '另一位' },
        ],
      }),
    ).toMatchObject({
      kind: 'video',
      id: '14484890',
      title: '孤勇者（日语女声MV）',
      artist: '秋蒂 / 另一位',
      duration: 256000,
      playCount: 265875,
    })
  })

  it('drops entries without a video id', () => {
    expect(videoFromSearch({ vid: '', title: 'x' })).toBeNull()
  })
})

describe('relatedVideoFromFeed', () => {
  it('parses a mlog feed with natural dimensions', () => {
    const item = relatedVideoFromFeed({
      id: 'a1PvyoDUbEJmk0',
      resource: {
        mlogBaseData: {
          id: 'a1PvyoDUbEJmk0',
          originalTitle: '20211128《起风了》live现场',
          duration: 30080,
          coverUrl: 'http://example.com/mlog.jpg',
          video: { videoKey: '12804843560', width: 960, height: 540 },
        },
        userProfile: { nickname: '上传者' },
      },
    })
    expect(item).toEqual({
      kind: 'mlog',
      id: 'a1PvyoDUbEJmk0',
      title: '20211128《起风了》live现场',
      cover: 'http://example.com/mlog.jpg',
      artist: '上传者',
      duration: 30080,
      playCount: undefined,
      width: 960,
      height: 540,
    })
    expect(item && isPortraitVideo(item)).toBe(false)
  })

  it('parses the official MV record (mlog type 3) with its renditions', () => {
    expect(
      relatedVideoFromFeed({
        id: '14686114',
        resource: {
          mlogBaseData: {
            id: '14686114',
            type: 3,
            threadId: 'R_MV_5_14686114',
            text: '孤勇者',
            coverUrl: 'http://example.com/mv.jpg',
            coverWidth: 426,
            coverHeight: 240,
            duration: 273000,
            videos: [{ width: 426, height: 240 }],
          },
          mlogExtVO: {
            playCount: 2384955,
            song: { artists: [{ artistName: '陈奕迅' }] },
          },
        },
      }),
    ).toMatchObject({
      kind: 'mv',
      id: '14686114',
      title: '孤勇者',
      artist: '陈奕迅',
      playCount: 2384955,
      width: 426,
      height: 240,
    })
  })

  it('parses a legacy mvBaseData feed', () => {
    expect(
      relatedVideoFromFeed({
        resource: {
          mvBaseData: {
            id: 123,
            name: '官方 MV',
            cover: 'http://example.com/mv.jpg',
            artistName: '歌手',
            duration: 200000,
          },
        },
      }),
    ).toMatchObject({ kind: 'mv', id: 123, title: '官方 MV', artist: '歌手' })
  })

  it('skips feeds without playable video data', () => {
    expect(
      relatedVideoFromFeed({
        resource: { mlogBaseData: { id: 'text-only', text: '图文动态' } },
      }),
    ).toBeNull()
  })

  it('detects portrait clips', () => {
    expect(isPortraitVideo({ width: 540, height: 960 })).toBe(true)
    expect(isPortraitVideo({ width: 960, height: 540 })).toBe(false)
    expect(isPortraitVideo({})).toBe(false)
  })
})
