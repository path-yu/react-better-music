import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.join(root, 'server')
const modulesDir = path.join(serverDir, 'module')
const entryPath = path.join(serverDir, 'desktop-api.cjs')
const bundlePath = path.join(serverDir, 'desktop-api.bundle.cjs')

const SPECIAL_ROUTES = {
  'daily_signin.js': '/daily_signin',
  'fm_trash.js': '/fm_trash',
  'personal_fm.js': '/personal_fm',
}

const moduleFiles = fs
  .readdirSync(modulesDir)
  .filter((file) => file.endsWith('.js'))
  .reverse()

/**
 * The desktop client only calls this exact subset of the upstream API. Keeping
 * the other ~385 route modules out of the child bundle avoids parsing and
 * retaining their code/dependencies for the lifetime of the app. Set
 * QIMIAO_API_ALL_ROUTES=1 when building a diagnostic bundle.
 */
const DESKTOP_MODULE_FILES = new Set([
  'album.js',
  'album_sublist.js',
  'artist_album.js',
  'artist_detail.js',
  'artist_mv.js',
  'artist_top_song.js',
  'artists.js',
  'avatar_upload.js',
  'banner.js',
  'captcha_sent.js',
  'check_music.js',
  'cloudsearch.js',
  'comment.js',
  'comment_like.js',
  'comment_music.js',
  'comment_mv.js',
  'comment_playlist.js',
  'daily_signin.js',
  'img_proxy.js',
  'like.js',
  'likelist.js',
  'login_cellphone.js',
  'login_qr_check.js',
  'login_qr_create.js',
  'login_qr_key.js',
  'login_refresh.js',
  'login_status.js',
  'logout.js',
  'lyric_new.js',
  'mlog_music_rcmd.js',
  'mlog_url.js',
  'mv_all.js',
  'mv_detail.js',
  'mv_first.js',
  'mv_url.js',
  'personal_fm.js',
  'personalized.js',
  'playlist_cover_update.js',
  'playlist_create.js',
  'playlist_detail.js',
  'playlist_highquality_tags.js',
  'playlist_subscribe.js',
  'playlist_track_all.js',
  'playlist_tracks.js',
  'playlist_update.js',
  'playmode_intelligence_list.js',
  'recommend_songs.js',
  'record_recent_song.js',
  'register_anonimous.js',
  'search_default.js',
  'search_hot.js',
  'search_hot_detail.js',
  'search_suggest.js',
  'scrobble.js',
  'scrobble_v1.js',
  'simi_artist.js',
  'simi_mv.js',
  'song_detail.js',
  'song_url_match.js',
  'song_url_v1.js',
  'top_playlist_highquality.js',
  'top_song.js',
  'toplist.js',
  'toplist_detail.js',
  'user_account.js',
  'user_detail.js',
  'user_playlist.js',
  'user_update.js',
  'video_url.js',
])

function routeForFile(file) {
  return (
    SPECIAL_ROUTES[file] ??
    `/${file.replace(/\.js$/i, '').replace(/_/g, '/')}`
  )
}

const routeToFile = new Map(
  moduleFiles.map((file) => [routeForFile(file), file]),
)
const sourceDir = path.join(root, 'src')
const sourceRoutes = new Map()

function collectSourceRoutes(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceRoutes(fullPath)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    const source = fs.readFileSync(fullPath, 'utf8')
    for (const match of source.matchAll(/(['"`])(\/[^'"`\s]{1,200})\1/g)) {
      const route = match[2].split('?')[0].replace(/\/+$/, '') || '/'
      if (routeToFile.has(route)) sourceRoutes.set(route, fullPath)
    }
  }
}

if (fs.existsSync(sourceDir)) collectSourceRoutes(sourceDir)

// Every endpoint called from the central API client must resolve to a server
// module (or an intentionally custom endpoint). This catches a new frontend API
// being added without a matching route before release packaging.
const API_INDEX = path.join(sourceDir, 'api', 'index.ts')
const CUSTOM_API_ROUTES = new Set([
  '/apple/playlist',
  '/audio/proxy',
  '/link/resolve',
  '/media/probe',
  '/qq/playlist',
  '/youtube/playlist',
])
const apiIndexSource = fs.existsSync(API_INDEX)
  ? fs.readFileSync(API_INDEX, 'utf8')
  : ''
const apiIndexRoutes = new Set(
  [...apiIndexSource.matchAll(/(['"`])(\/[^'"`\s]{1,200})\1/g)].map(
    (match) => match[2].split('?')[0].replace(/\/+$/, '') || '/',
  ),
)
const unresolvedApiRoutes = [...apiIndexRoutes].filter(
  (route) => !routeToFile.has(route) && !CUSTOM_API_ROUTES.has(route),
)
if (unresolvedApiRoutes.length) {
  console.error(
    `[electrobun] API routes have no packaged module: ${unresolvedApiRoutes.join(', ')}`,
  )
  process.exit(1)
}

const selectedSet = new Set(DESKTOP_MODULE_FILES)
for (const file of sourceRoutes.values()) selectedSet.add(file)
const selectedModuleFiles =
  process.env.QIMIAO_API_ALL_ROUTES === '1'
    ? moduleFiles
    : moduleFiles.filter((file) => selectedSet.has(file))

console.log(
  `[electrobun] API route discovery: ${apiIndexRoutes.size} source endpoints, ${sourceRoutes.size} modules auto-selected`,
)

const moduleDefs = selectedModuleFiles
  .map((file) => {
    const identifier = file.split('.').shift()
    const route = routeForFile(file)
    return `  { identifier: ${JSON.stringify(identifier)}, route: ${JSON.stringify(route)}, module: (query, request) => require('./module/${file}')(query, request) },`
  })
  .join('\n')

// The unblock matcher scans `modules/` on disk at runtime. Inside a single-file
// bundle that directory does not exist, so generate a static module map and
// bundle the modules instead.
const unblockModulesDir = path.join(
  root,
  'server/node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/modules',
)
const unblockModules = fs.existsSync(unblockModulesDir)
  ? fs
      .readdirSync(unblockModulesDir)
      .filter((file) => file.endsWith('.js'))
      .map((file) => file.replace(/\.js$/i, ''))
  : []

const unblockModuleImports = unblockModules
  .map(
    (name) =>
      '  ' +
      JSON.stringify(name) +
      ': require(' +
      JSON.stringify(path.join(unblockModulesDir, name + '.js')) +
      '),',
  )
  .join('\n')

const unblockMatchShim = `// Generated by scripts/prepare-electrobun-api.mjs. Do not edit.
const modules = {
${unblockModuleImports}
}

function pickModule(name) {
  const mod = modules[name]
  if (!mod) return null
  if (typeof mod === 'function') return mod
  if (typeof mod === 'object') {
    if (typeof mod[name] === 'function') return mod[name]
    for (const key of Object.keys(mod)) {
      if (typeof mod[key] === 'function') return mod[key]
    }
  }
  return null
}

async function matchID(id, source = null) {
  if (!id) return { code: 400, message: 'Missing id parameter', data: null }
  const names = source ? [source] : ${JSON.stringify(unblockModules)}
  for (const name of names) {
    const fn = pickModule(name)
    if (!fn) continue
    try {
      const url = await fn(id)
      if (url) return { code: 200, message: 'success', data: { url, source: name } }
    } catch (error) {
      console.error('[unblock] ' + name + ': ' + error.message)
    }
  }
  return { code: 500, message: 'No available source found', data: null }
}

module.exports = { matchID }
`

const entry = `// Generated by scripts/prepare-electrobun-api.mjs. Do not edit.
const fs = require('fs')
const os = require('os')
const path = require('path')

// request.js reads the anonymous token as soon as it is required.
const tokenPath = path.resolve(os.tmpdir(), 'anonymous_token')
if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8')

const { serveNcmApi } = require('./server')
const generateConfig = require('./generateConfig')

let appleToken = { value: '', at: 0 }

function externalFetch(url, options = {}, proxy = '') {
  if (proxy) return fetch(url, { ...options, proxy })
  return fetch(url, options)
}

async function getAppleToken(proxy = '') {
  if (appleToken.value && Date.now() - appleToken.at < 30 * 60_000) {
    return appleToken.value
  }
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
  const home = await externalFetch(
    'https://music.apple.com/cn',
    { headers: { 'User-Agent': ua } },
    proxy,
  )
  const html = await home.text()
  const asset = html.match(/\\/assets\\/index[^"'\\s]*\\.js/)?.[0]
  if (!asset) throw new Error('Apple Music JS bundle not found')
  const js = await (
    await externalFetch(
      'https://music.apple.com' + asset,
      { headers: { 'User-Agent': ua } },
      proxy,
    )
  ).text()
  const token = js.match(
    /eyJ[A-Za-z0-9_-]{40,}\\.[A-Za-z0-9_-]{40,}\\.[A-Za-z0-9_-]{40,}/,
  )?.[0]
  if (!token) throw new Error('Apple Music developer token not found')
  appleToken = { value: token, at: Date.now() }
  return token
}

function applePlaylistInfo(raw) {
  const target = new URL(raw)
  if (
    !/^https?:$/.test(target.protocol) ||
    !(
      target.hostname === 'music.apple.com' ||
      target.hostname.endsWith('.music.apple.com')
    )
  ) {
    throw new Error('Unsupported Apple Music link')
  }
  const parts = target.pathname.split('/').filter(Boolean)
  const locale = /^[a-z]{2}$/.test(parts[0] || '') ? parts[0] : 'cn'
  const playlistIndex = parts.indexOf('playlist')
  if (playlistIndex < 0) throw new Error('Not an Apple Music playlist link')
  const id = parts.find((part) => part.startsWith('pl.'))
  if (!id) throw new Error('Apple Music playlist id not found')
  return { id, locale }
}

async function fetchApplePlaylist(raw, proxy = '') {
  const { id, locale } = applePlaylistInfo(raw)
  const language = locale === 'cn' ? 'zh-CN' : locale
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
  const token = await getAppleToken(proxy)
  const headers = {
    Authorization: 'Bearer ' + token,
    'User-Agent': ua,
    Origin: 'https://music.apple.com',
  }
  const base =
    'https://amp-api.music.apple.com/v1/catalog/' +
    locale +
    '/playlists/' +
    id
  const metaResponse = await externalFetch(
    base + '?l=' + language,
    { headers },
    proxy,
  )
  if (!metaResponse.ok) {
    throw new Error(
      'Apple Music playlist request failed (' + metaResponse.status + ')',
    )
  }
  const meta = await metaResponse.json()
  const resource = meta.data?.[0]
  const title = resource?.attributes?.name || 'Apple Music 歌单'
  const artwork = resource?.attributes?.artwork?.url
  const coverUrl = artwork ? artwork.replace('{w}x{h}', '300x300') : ''
  const tracks = []
  let next = base + '/tracks?l=' + language + '&limit=100'
  while (next) {
    const response = await externalFetch(next, { headers }, proxy)
    if (!response.ok) {
      throw new Error(
        'Apple Music playlist request failed (' + response.status + ')',
      )
    }
    const payload = await response.json()
    for (const track of payload.data || []) {
      const attributes = track.attributes || {}
      if (!track.id || !attributes.name) continue
      tracks.push({
        id: track.id,
        name: attributes.name,
        artist: attributes.artistName || '',
        album: attributes.albumName || '',
        duration: attributes.durationInMillis || 0,
        artwork: attributes.artwork?.url
          ? attributes.artwork.url.replace('{w}x{h}', '200x200')
          : '',
      })
    }
    next = payload.next
      ? payload.next.startsWith('http')
        ? payload.next
        : 'https://amp-api.music.apple.com' + payload.next
      : ''
  }
  return { title, coverUrl, tracks }
}

async function fetchQqPlaylist(raw, proxy = '') {
  const target = new URL(raw)
  if (
    !(
      target.hostname === 'y.qq.com' ||
      target.hostname.endsWith('.y.qq.com')
    )
  ) {
    throw new Error('Unsupported QQ Music link')
  }
  const id = target.searchParams.get('id')
  if (!id || !/^\\d+$/.test(id)) throw new Error('QQ Music playlist id not found')
  const headers = {
    'User-Agent': 'QQMusic/14090508 (android 12)',
    Referer: 'https://y.qq.com/',
    Origin: 'https://y.qq.com',
    'Content-Type': 'application/json',
  }
  let title = 'QQ音乐歌单'
  let coverUrl = ''
  let total = 0
  const tracks = []
  let offset = 0
  while (offset < 10000) {
    const payload = {
      comm: { ct: 24, cv: 0 },
      diss: {
        module: 'music.srfDissInfo.aiDissInfo',
        method: 'uniform_get_Dissinfo',
        param: {
          disstid: Number(id),
          userinfo: 1,
          tag: 1,
          orderlist: 1,
          song_begin: offset,
          song_num: 500,
          onlysonglist: 0,
          enc_host_uin: '',
        },
      },
    }
    const response = await externalFetch(
      'https://u.y.qq.com/cgi-bin/musicu.fcg',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      proxy,
    )
    if (!response.ok) throw new Error('QQ Music playlist request failed (' + response.status + ')')
    const json = await response.json()
    const data = json.diss?.data
    if (!data) throw new Error('QQ Music playlist not found')
    if (offset === 0) {
      title = data.dirinfo?.title || title
      coverUrl = data.dirinfo?.picurl || ''
      total = data.total_song_num || data.songlist?.length || 0
    }
    const page = data.songlist || []
    for (const song of page) {
      tracks.push({
        id: String(song.mid || song.id || ''),
        name: song.name || song.title || '',
        artist: (song.singer || []).map((singer) => singer.name).join(' / '),
        album: song.album?.name || '',
        duration: (song.interval || 0) * 1000,
        artwork: song.album?.mid
          ? 'https://y.qq.com/music/photo_new/T002R300x300M000' +
            song.album.mid +
            '.jpg'
          : '',
      })
    }
    offset += page.length
    if (!page.length || (total > 0 && offset >= total)) break
  }
  return { title, coverUrl, tracks }
}

function collectYoutubeTracks(node, output) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectYoutubeTracks(item, output))
    return
  }
  if (!node || typeof node !== 'object') return
  if (node.musicResponsiveListItemRenderer) {
    output.push(node.musicResponsiveListItemRenderer)
  }
  Object.values(node).forEach((value) => collectYoutubeTracks(value, output))
}

function youtubeText(runs) {
  return Array.isArray(runs) ? runs.map((run) => run.text || '').join('') : ''
}

function youtubePlaylistFromData(data) {
  const rawTracks = []
  collectYoutubeTracks(data, rawTracks)
  const header =
    data?.header?.musicDetailHeaderRenderer ||
    data?.header?.musicEditablePlaylistDetailHeaderRenderer
  const title = youtubeText(header?.title?.runs) || 'YouTube Music 歌单'
  const coverUrl =
    header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]
      ?.url || ''
  const tracks = []
  for (const item of rawTracks) {
    const columns = item.flexColumns || []
    const name = youtubeText(
      columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs,
    )
    const artist = youtubeText(
      columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs,
    )
    const album = youtubeText(
      columns[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs,
    )
    const endpoint =
      item.overlay?.playButtonRenderer?.playNavigationEndpoint?.watchEndpoint ||
      item.navigationEndpoint?.watchEndpoint ||
      item.overlay?.playButtonRenderer?.playNavigationEndpoint
        ?.watchPlaylistEndpoint
    const id = endpoint?.videoId || ''
    if (!name || !id) continue
    tracks.push({ id, name, artist, album, duration: 0, artwork: '' })
  }
  return { title, coverUrl, tracks }
}

async function fetchYoutubePlaylist(raw, proxy = '') {
  const target = new URL(raw)
  if (target.hostname !== 'music.youtube.com') {
    throw new Error('Unsupported YouTube Music link')
  }
  const listId = target.searchParams.get('list')
  if (!listId) throw new Error('YouTube Music playlist id not found')
  let pageError = ''

  // The web page exposes ytInitialData when the consent cookie is present.
  try {
    const response = await externalFetch(
      'https://music.youtube.com/playlist?list=' +
        encodeURIComponent(listId) +
        '&hl=zh-CN',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Cookie: 'SOCS=CAI; CONSENT=YES+cb.20210328-17-p0.en+FX+410',
        },
      },
      proxy,
    )
    if (response.ok) {
      const html = await response.text()
      const marker = 'ytInitialData'
      const start = html.indexOf(marker)
      if (start >= 0) {
        const jsonStart = html.indexOf('{', start)
        const jsonEnd = html.indexOf(';</script>', jsonStart)
        if (jsonStart >= 0 && jsonEnd >= 0) {
          const data = JSON.parse(html.slice(jsonStart, jsonEnd))
          const parsed = youtubePlaylistFromData(data)
          if (parsed.tracks.length) return parsed
        }
      }
      pageError = 'YouTube Music initial data not found'
    } else {
      pageError = 'YouTube Music playlist request failed (' + response.status + ')'
    }
  } catch (error) {
    pageError = error?.message || 'YouTube Music page request failed'
  }

  // The page is often served as a consent shell to non-browser clients. The
  // same playlist is available through YouTube Music's public web browse API.
  try {
    const response = await externalFetch(
      'https://music.youtube.com/youtubei/v1/browse?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30&prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240731.01.00',
              hl: 'zh-CN',
              gl: 'US',
            },
          },
          browseId: 'VL' + listId,
        }),
      },
      proxy,
    )
    if (!response.ok) {
      throw new Error(
        'YouTube Music browse request failed (' + response.status + ')',
      )
    }
    const data = await response.json()
    const parsed = youtubePlaylistFromData(data)
    if (parsed.tracks.length) return parsed
    pageError = 'YouTube Music 歌单没有歌曲'
  } catch (error) {
    pageError = error?.message || pageError
  }
  throw new Error(pageError || 'YouTube Music playlist failed')
}

const moduleDefs = [
${moduleDefs}
]

async function startApiServer() {
  // Registering the anonymous token / xeapi key hits NetEase over the network.
  // The HTTP server does not need it to listen (request.js caches the token at
  // require time), so run it alongside the server instead of blocking startup.
  const configTask = generateConfig().catch((error) => {
    console.error('[desktop] API config bootstrap failed:', error)
  })
  const app = await serveNcmApi({
    checkVersion: false,
    moduleDefs,
    port: Number(process.env.QIMIAO_API_PORT || 13000),
    host: process.env.QIMIAO_API_HOST || '127.0.0.1',
  })
  // Readiness probe for the parent Bun process.
  app.get('/ping', (_req, res) => res.json({ code: 200 }))
  app.get('/apple/playlist', async (req, res) => {
    try {
      res.json({
        code: 200,
        ...(await fetchApplePlaylist(
          String(req.query.url || ''),
          String(req.query.proxy || ''),
        )),
      })
    } catch (error) {
      res.status(502).json({
        code: 502,
        msg: error?.message || 'Apple Music playlist failed',
      })
    }
  })
  app.get('/qq/playlist', async (req, res) => {
    try {
      res.json({
        code: 200,
        ...(await fetchQqPlaylist(
          String(req.query.url || ''),
          String(req.query.proxy || ''),
        )),
      })
    } catch (error) {
      res.status(502).json({
        code: 502,
        msg: error?.message || 'QQ Music playlist failed',
      })
    }
  })
  app.get('/youtube/playlist', async (req, res) => {
    try {
      res.json({
        code: 200,
        ...(await fetchYoutubePlaylist(
          String(req.query.url || ''),
          String(req.query.proxy || ''),
        )),
      })
    } catch (error) {
      res.status(502).json({
        code: 502,
        msg: error?.message || 'YouTube Music playlist failed',
      })
    }
  })
  app.get('/link/resolve', async (req, res) => {
    const raw = String(req.query.url || '').trim()
    let target
    try {
      target = new URL(raw)
    } catch {
      return res.status(400).json({ code: 400, msg: 'Invalid link' })
    }
    if (
      !/^https?:$/.test(target.protocol) ||
      !(target.hostname === '163cn.tv' || target.hostname.endsWith('.163cn.tv'))
    ) {
      return res.status(400).json({ code: 400, msg: 'Unsupported link' })
    }
    try {
      const response = await externalFetch(
        target,
        {
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
            Referer: 'https://music.163.com/',
          },
        },
        String(req.query.proxy || ''),
      )
      res.json({ code: 200, url: response.url })
    } catch (error) {
      res.status(502).json({ code: 502, msg: error?.message || 'Link resolve failed' })
    }
  })
  void configTask
}

module.exports = { startApiServer }

// Run as an independent Bun process (src/bun/index.ts spawns this file).
if (require.main === module) {
  const parentPid = Number(process.env.QIMIAO_API_PARENT_PID || 0)
  if (parentPid) {
    // Never leave an orphan when the app is killed without exit handlers.
    setInterval(() => {
      try {
        process.kill(parentPid, 0)
      } catch {
        process.exit(0)
      }
    }, 5000)
  }
  startApiServer().catch((error) => {
    console.error('[desktop] API server failed:', error)
    process.exit(1)
  })
}
`

fs.writeFileSync(entryPath, entry, 'utf-8')

await build({
  entryPoints: [entryPath],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  conditions: ['module-sync'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [
    {
      // Replace the library's runtime directory scan with the bundled map.
      name: 'bundle-unblock-modules',
      setup(build) {
        build.onLoad(
          { filter: /unblockmusic-utils[\\/]src[\\/]match\.js$/ },
          () => ({ contents: unblockMatchShim, loader: 'js' }),
        )
      },
    },
    {
      // Optional native/peer deps that are not needed for the routes we ship.
      name: 'stub-optional-deps',
      setup(build) {
        build.onResolve({ filter: /^(canvas|bufferutil|utf-8-validate)$/ }, (args) => ({
          path: args.path,
          namespace: 'empty-package',
        }))
        build.onLoad({ filter: /.*/, namespace: 'empty-package' }, () => ({
          contents: 'module.exports = {}',
          loader: 'js',
        }))
      },
    },
    {
      // jsdom's sync XHR worker is looked up with require.resolve, which does
      // not exist inside a single-file bundle. The server never uses sync XHR.
      name: 'patch-jsdom-sync-worker',
      setup(build) {
        build.onLoad(
          {
            filter:
              /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]xhr[\\/]XMLHttpRequest-impl\.js$/,
          },
          async (args) => {
            const contents = (
              await fs.promises.readFile(args.path, 'utf-8')
            ).replace(/require\.resolve\(["']\.\/xhr-sync-worker\.js["']\)/g, 'null')
            return { contents, loader: 'js' }
          },
        )
      },
    },
  ],
})

const size = fs.statSync(bundlePath).size
console.log(
  `[electrobun] prepared bundled API server (${selectedModuleFiles.length}/${moduleFiles.length} routes, ${(size / 1024 / 1024).toFixed(1)} MB) at ${path.relative(root, bundlePath)}`,
)
