// 解析指定视频（B 站 bvid / YouTube video id）的音频直链
const bilibili = require('../util/bilibili.js')
const youtube = require('../util/youtube.js')
const matchedMedia = require('../util/matchedMedia.js')
const logger = require('../util/logger.js')

module.exports = async (query) => {
  const source = query.source === 'youtube' ? 'youtube' : 'bilibili'
  const videoId = typeof query.vid === 'string' ? query.vid.trim() : ''
  if (!videoId) {
    return { status: 400, body: { code: 400, msg: '缺少视频 ID', data: [] } }
  }
  try {
    if (source === 'bilibili') {
      const audio = await bilibili.resolveAudio(videoId)
      if (!audio?.url) {
        return {
          status: 404,
          body: { code: 404, msg: '该视频没有可用音轨', data: [] },
        }
      }
      matchedMedia.remember(audio.url)
      return {
        status: 200,
        body: {
          code: 200,
          data: {
            url: audio.url,
            duration: audio.duration || 0,
            webUrl: `https://www.bilibili.com/video/${videoId}`,
          },
        },
      }
    }

    const url = await youtube.resolveStream(videoId)
    if (!url) {
      return {
        status: 404,
        body: { code: 404, msg: '该视频没有可用音轨', data: [] },
      }
    }
    matchedMedia.remember(url)
    return {
      status: 200,
      body: {
        code: 200,
        data: {
          url,
          duration: 0,
          webUrl: `https://www.youtube.com/watch?v=${videoId}`,
        },
      },
    }
  } catch (error) {
    if (error?.code === 'YT_DLP_MISSING') {
      return {
        status: 404,
        body: {
          code: 404,
          reason: 'yt-dlp-missing',
          msg: '未检测到 yt-dlp，请安装后重试',
          data: [],
        },
      }
    }
    logger.info('视频音频解析失败', source, videoId, error?.message)
    return {
      status: 500,
      body: { code: 500, msg: error?.message || '音频解析失败', data: [] },
    }
  }
}
