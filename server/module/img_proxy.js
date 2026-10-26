// 专辑封面代理：返回 base64 data URL，供前端做 canvas 取色
// GET /img/proxy?url=<encoded image url>
const axios = require('axios')

const ALLOWED_HOST = /^https?:\/\/[^/]*(music\.126\.net|mzstatic\.com)\//

module.exports = async (query) => {
  // Express has already decoded the query value.
  const raw = typeof query.url === 'string' ? query.url : ''
  if (!raw || !ALLOWED_HOST.test(raw)) {
    throw {
      status: 400,
      body: { code: 400, msg: 'Invalid image url' },
    }
  }

  // `param=64y64` is a NetEase CDN resize hint; other CDNs may 404 on it.
  const url =
    !/music\.126\.net/.test(raw) || /([?&])param=/.test(raw)
      ? raw
      : `${raw}${raw.includes('?') ? '&' : '?'}param=64y64`
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
    // Keep the internal reason in the server log, not in the HTTP response.
    console.error('[img_proxy]', error.message)
    throw {
      status: 502,
      body: {
        code: 502,
        msg: 'Image fetch failed',
      },
    }
  }
}
