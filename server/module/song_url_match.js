// 网易云歌曲解灰(适配SPlayer的UNM-Server)
// 支持qq音乐、酷狗音乐、酷我音乐、咪咕音乐、第三方网易云API等等(来自GD音乐台)

const createOption = require('../util/option.js')
const logger = require('../util/logger.js')

module.exports = async (query, request) => {
  try {
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
