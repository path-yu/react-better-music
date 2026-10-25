// 专辑封面代理：返回 base64 data URL，供前端做 canvas 取色
// GET /img/proxy?url=<encoded image url>
const axios = require('axios')

const ALLOWED_HOST = /^https?:\/\/[^/]*music\.126\.net\//

module.exports = async (query) => {
  const raw = typeof query.url === 'string' ? decodeURIComponent(query.url) : ''
  if (!raw || !ALLOWED_HOST.test(raw)) {
    throw {
      status: 400,
      body: { code: 400, msg: 'Invalid image url', url: raw, queryUrl: query.url },
    }
  }

  const url = raw.includes('?') ? `${raw}&param=64y64` : `${raw}?param=64y64`
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      proxy: false,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://music.163.com/',
      },
    })
    const contentType = response.headers['content-type'] || 'image/jpeg'
    const base64 = Buffer.from(response.data).toString('base64')

    return {
      status: 200,
      body: {
        code: 200,
        data: `data:${contentType};base64,${base64}`,
      },
    }
  } catch (error) {
    throw {
      status: 502,
      body: {
        code: 502,
        msg: 'Image fetch failed',
        detail: error.message,
        url,
      },
    }
  }
}
