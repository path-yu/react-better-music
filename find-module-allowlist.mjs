import { existsSync, readdirSync } from 'node:fs'

const paths = [
  '/album',
  '/album/sublist',
  '/artist/album',
  '/artist/detail',
  '/artist/mv',
  '/artist/top/song',
  '/artists',
  '/avatar/upload',
  '/banner',
  '/captcha/sent',
  '/check/music',
  '/cloudsearch',
  '/comment',
  '/comment/like',
  '/comment/music',
  '/comment/mv',
  '/comment/playlist',
  '/daily_signin',
  '/like',
  '/likelist',
  '/login/cellphone',
  '/login/qr/check',
  '/login/qr/create',
  '/login/qr/key',
  '/login/refresh',
  '/login/status',
  '/logout',
  '/lyric/new',
  '/mlog/music/rcmd',
  '/mlog/url',
  '/mv/all',
  '/mv/detail',
  '/mv/first',
  '/mv/url',
  '/personal_fm',
  '/personalized',
  '/playlist/cover/update',
  '/playlist/detail',
  '/playlist/highquality/tags',
  '/playlist/subscribe',
  '/playlist/track/all',
  '/playlist/tracks',
  '/playlist/update',
  '/playmode/intelligence/list',
  '/recommend/songs',
  '/record/recent/song',
  '/register/anonimous',
  '/search/default',
  '/search/hot',
  '/search/hot/detail',
  '/search/suggest',
  '/simi/artist',
  '/simi/mv',
  '/song/url/match',
  '/song/url/v1',
  '/top/playlist/highquality',
  '/top/song',
  '/toplist',
  '/toplist/detail',
  '/user/account',
  '/user/detail',
  '/user/playlist',
  '/user/update',
  '/video/url',
  '/img/proxy',
]
const files = new Set(readdirSync('server/module').filter((f) => f.endsWith('.js')))
const matched = new Set()
const missing = []
for (const path of paths) {
  const candidate = `${path.slice(1).replaceAll('/', '_')}.js`
  if (files.has(candidate)) {
    matched.add(candidate)
  } else {
    const alternatives = [...files].filter((file) => {
      const route =
        '/' + file.replace(/\.js$/, '').replaceAll('_', '/')
      return route === path
    })
    if (alternatives.length) alternatives.forEach((file) => matched.add(file))
    else missing.push(path)
  }
}
console.log('matched', matched.size)
console.log([...matched].sort().join('\n'))
console.log('\nmissing', missing)
