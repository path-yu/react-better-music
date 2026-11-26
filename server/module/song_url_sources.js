// 列出某首歌在 B 站 / YouTube 的候选视频（只返回元数据，不解析音频）
const bilibili = require('../util/bilibili.js')
const youtube = require('../util/youtube.js')
const { loadSongMeta } = require('../util/songMeta.js')
const logger = require('../util/logger.js')

module.exports = async (query, request) => {
  const source = query.source === 'youtube' ? 'youtube' : 'bilibili'
  try {
    const meta = await loadSongMeta(query, request)
    if (!meta.name) {
      return {
        status: 404,
        body: { code: 404, msg: '未获取到歌曲信息', data: [] },
      }
    }
    const items =
      source === 'bilibili'
        ? await bilibili.listCandidates(meta, 12)
        : await youtube.listCandidates(meta, 12)
    if (!items.length) {
      return {
        status: 404,
        body: { code: 404, msg: '没有可用的视频源', data: [] },
      }
    }
    return { status: 200, body: { code: 200, data: { source, items } } }
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
    logger.info('视频源列表失败', query.id, source, error?.message)
    return {
      status: 500,
      body: { code: 500, msg: error?.message || '视频源列表失败', data: [] },
    }
  }
}
