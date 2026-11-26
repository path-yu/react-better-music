// QQ 音乐搜索，用作网易云搜索的辅助：给出「歌名 + 歌手」对应的专辑名
const axios = require('axios')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

module.exports = async (query) => {
  const keyword =
    typeof query.keyword === 'string' ? query.keyword.trim() : ''
  if (!keyword) {
    return { status: 400, body: { code: 400, msg: '缺少关键词', data: [] } }
  }
  try {
    // The `client_search_cp` endpoint answers 500 without a browser session;
    // `search_for_qq_cp` still serves plain JSON.
    const response = await axios.get(
      'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp',
      {
        params: { w: keyword, format: 'json', n: 10, p: 1, cr: 1, t: 0 },
        headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
        timeout: 6000,
      },
    )
    const list = response.data?.data?.song?.list || []
    const songs = list.slice(0, 10).map((song) => ({
      name: song.songname || '',
      singers: (song.singer || [])
        .map((singer) => singer.name)
        .filter(Boolean)
        .join('/'),
      album: song.albumname || '',
      duration: Number(song.interval) || 0,
    }))
    return { status: 200, body: { code: 200, data: { songs } } }
  } catch (error) {
    return {
      status: 502,
      body: { code: 502, msg: error.message, data: { songs: [] } },
    }
  }
}
