// 网易云歌曲解灰(适配SPlayer的UNM-Server)
// 支持qq音乐、酷狗音乐、酷我音乐、咪咕音乐、第三方网易云API等等(来自GD音乐台)
// 额外支持 B 站（纯 HTTP）与 YouTube（依赖本机 yt-dlp）

const createOption = require('../util/option.js')
const logger = require('../util/logger.js')
const matchedMedia = require('../util/matchedMedia.js')
const bilibili = require('../util/bilibili.js')
const youtube = require('../util/youtube.js')

/** Song title / artists / duration used to search the video sites. */
async function loadSongMeta(query, request) {
  const fallback = { id: query.id, name: '', artist: '', durationMs: 0 }
  try {
    const res = await request(
      `/api/v3/song/detail`,
      { c: `[{"id":${Number(query.id)}}]` },
      createOption(query, 'weapi'),
    )
    const song = res?.body?.songs?.[0]
    if (!song) return fallback
    return {
      id: song.id,
      name: song.name || '',
      artist: (song.ar || [])
        .map((artist) => artist.name)
        .filter(Boolean)
        .join(' '),
      durationMs: Number(song.dt) || 0,
    }
  } catch {
    return fallback
  }
}

const matched = (url, source, title, webUrl) => ({
  status: 200,
  body: {
    code: 200,
    data: url,
    source,
    proxyUrl: '',
    title: title || '',
    // Page the audio was taken from, so the menu can link back to it.
    ...(webUrl ? { webUrl } : {}),
  },
})

/** Public video page for a matched bilibili / YouTube stream. */
function videoPageUrl(source, match) {
  if (source === 'bilibili' && match?.bvid) {
    return `https://www.bilibili.com/video/${match.bvid}`
  }
  if (source === 'youtube' && match?.id) {
    return `https://www.youtube.com/watch?v=${match.id}`
  }
  return ''
}

const notFound = (msg) => ({
  status: 404,
  body: { code: 404, msg, data: [] },
})

/**
 * Order used by "自动匹配". The upstream package also ships ddyr / msls / oi /
 * qijieya, but all four answered 500 on a real request (see the source menu,
 * where they were removed) and only added latency. Bilibili goes last: its
 * search is slower, but it finds the original audio when the relays have
 * nothing.
 */
const AUTO_SOURCES = ['unm', 'gdmusic', 'byfuns', 'bilibili']

async function matchAuto(query, request) {
  const { matchID } = require('@neteasecloudmusicapienhanced/unblockmusic-utils')
  for (const source of AUTO_SOURCES) {
    try {
      if (source === 'bilibili') {
        const meta = await loadSongMeta(query, request)
        const hit = await bilibili.matchSong(meta)
        if (hit?.url) {
          return {
            url: hit.url,
            source,
            webUrl: videoPageUrl(source, hit),
          }
        }
        continue
      }
      const result = await matchID(query.id, source)
      const url = result?.data?.url
      if (url) return { url, source }
    } catch {
      // A dead provider must not abort the fallback chain.
    }
  }
  return null
}

module.exports = async (query, request) => {
  try {
    // Video sites are separate sources: they need the track's title/artist,
    // which the unblocking modules do not expose.
    if (query.source === 'bilibili' || query.source === 'youtube') {
      const meta = await loadSongMeta(query, request)
      logger.info('视频站解灰', query.source, meta)
      try {
        const match =
          query.source === 'bilibili'
            ? await bilibili.matchSong(meta)
            : await youtube.matchSong(meta)
        if (!match?.url) {
          return notFound(
            query.source === 'bilibili'
              ? 'B 站未找到匹配的音频'
              : 'YouTube 未找到匹配的音频',
          )
        }
        // The proxy only streams URLs the matcher produced, and these hosts
        // require a bilibili/YouTube referer that the proxy adds.
        matchedMedia.remember(match.url)
        return matched(
          match.url,
          query.source,
          match.title,
          videoPageUrl(query.source, match),
        )
      } catch (error) {
        if (error?.code === 'YT_DLP_MISSING') {
          // `reason` lets the renderer open the install dialog instead of
          // showing a plain "switch failed" toast.
          return {
            status: 404,
            body: {
              code: 404,
              msg: '未检测到 yt-dlp，请安装后重试',
              reason: 'yt-dlp-missing',
              data: [],
            },
          }
        }
        throw error
      }
    }

    // No explicit source: curated chain instead of the package's own order.
    if (!query.source) {
      const hit = await matchAuto(query, request)
      if (!hit) return notFound('未找到可用音源')
      matchedMedia.remember(hit.url)
      return matched(hit.url, hit.source, hit.title, hit.webUrl)
    }

    const {
      matchID,
    } = require('@neteasecloudmusicapienhanced/unblockmusic-utils')
    const result = await matchID(query.id, query.source)
    const proxy = process.env.PROXY_URL
    logger.info('开始解灰', query.id, result)
    const url = result?.data?.url || ''
    if (!url) {
      // No provider matched; return a normal "not found" instead of crashing
      // on `result.data.url`.
      return {
        status: 404,
        body: {
          code: 404,
          msg: result?.message || '未找到可用音源',
          data: [],
        },
      }
    }
    const useProxy = process.env.ENABLE_PROXY || 'false'
    let proxyUrl = ''
    if (url.includes('kuwo')) {
      proxyUrl = useProxy === 'true' ? proxy + url : url
    }
    // The local audio proxy only accepts URLs the matcher produced, so the
    // renderer can download the track for the offline cache.
    matchedMedia.remember(url)
    return {
      status: 200,
      body: {
        code: 200,
        data: url,
        source: result?.data?.source || query.source || '',
        proxyUrl,
      },
    }
  } catch (e) {
    return {
      status: 500,
      body: {
        code: 500,
        msg: e.message || 'unblock error',
        data: [],
      },
    }
  }
}
