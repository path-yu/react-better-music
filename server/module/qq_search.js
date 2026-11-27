// QQ 音乐搜索，用作网易云搜索的辅助：给出「歌名 + 歌手」对应的专辑名。
//
// Mirrors the parameter set of qq-music-api's `client_search_cp` request
// (`ct`/`qqmusic_ver`/`remoteplace`/`platform`…), but keeps calling
// `search_for_qq_cp`: that one answers plain JSON without a browser session,
// while `client_search_cp` returns 500 when called with an empty cookie.
// Both endpoints were verified to return identical rankings for the same
// query, so there is no reason to pay for a session.
const axios = require('axios')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp'
// `c.y.qq.com` rejects requests whose Referer was stripped by a proxy; the
// second pass uses the public site, which the same endpoint also accepts.
const REFERERS = ['https://c.y.qq.com/', 'https://y.qq.com/']

const buildParams = (keyword, limit, page) => ({
  w: keyword,
  format: 'json',
  outCharset: 'utf-8',
  ct: 24,
  qqmusic_ver: 1298,
  remoteplace: 'txt.yqq.song',
  t: 0,
  aggr: 1,
  cr: 1,
  lossless: 0,
  flag_qc: 0,
  platform: 'yqq.json',
  catZhida: 1,
  n: limit,
  p: page,
})

async function requestOnce(keyword, limit, page, referer) {
  const response = await axios.get(SEARCH_URL, {
    params: buildParams(keyword, limit, page),
    headers: { 'User-Agent': UA, Referer: referer },
    timeout: 6000,
  })
  const list = response.data?.data?.song?.list
  return Array.isArray(list) ? list : null
}

module.exports = async (query) => {
  const keyword =
    typeof query.keyword === 'string' ? query.keyword.trim() : ''
  if (!keyword) {
    return { status: 400, body: { code: 400, msg: '缺少关键词', data: [] } }
  }

  let list = null
  let lastError = null
  for (const referer of REFERERS) {
    try {
      list = await requestOnce(keyword, 10, 1, referer)
    } catch (error) {
      // Keep the first failure for the response body, but still try the next
      // Referer: a 403/empty body is usually the only thing that differs.
      lastError = lastError ?? error
      list = null
    }
    if (list && list.length) break
  }

  if (!list) {
    return {
      status: 502,
      body: {
        code: 502,
        msg: lastError?.message ?? '搜索服务不可用',
        data: { songs: [] },
      },
    }
  }

  const songs = list.slice(0, 10).map((song) => ({
    name: song.songname || '',
    singers: (song.singer || [])
      .map((singer) => singer.name)
      .filter(Boolean)
      .join('/'),
    album: song.albumname || '',
    duration: Number(song.interval) || 0,
    // Extra metadata for album matching: `albummid` identifies one release even
    // when two rows name it slightly differently, and `pay` says whether the
    // row is the paid original rather than a free re-upload.
    songmid: song.songmid || '',
    albummid: song.albummid || '',
    pay: Number(song.pay) || 0,
  }))

  return { status: 200, body: { code: 200, data: { songs } } }
}
