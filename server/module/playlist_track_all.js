// 通过传过来的歌单id拿到所有歌曲数据
// 支持传递参数limit来限制获取歌曲的数据数量 例如: /playlist/track/all?id=7044354223&limit=10
//
// The upstream playlist-detail response is large (it includes up to 1000 full
// tracks) and every small page used to fetch it again. Keep its trackIds/tracks
// in memory, coalesce concurrent requests, and reuse the embedded track objects
// for pages that already fall inside them.
const createOption = require('../util/option.js')

const DETAIL_TTL = 5 * 60_000
const MAX_PLAYLISTS = 12
const detailCache = new Map()
const inFlight = new Map()

function getPlaylistDetail(id, query, request) {
  const key = String(id)
  const cached = detailCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached)

  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = request(
    `/api/v6/playlist/detail`,
    {
      id,
      n: 100000,
      s: query.s || 8,
    },
    createOption(query),
  )
    .then((response) => {
      const playlist = response.body?.playlist
      const trackIds = Array.isArray(playlist?.trackIds)
        ? playlist.trackIds
        : []
      const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : []
      const tracksById = new Map(
        tracks
          .filter((song) => song && song.id)
          .map((song) => [song.id, song]),
      )
      const entry = {
        trackIds,
        tracksById,
        cookie: response.cookie,
        expiresAt: Date.now() + DETAIL_TTL,
      }
      detailCache.set(key, entry)
      if (detailCache.size > MAX_PLAYLISTS) {
        detailCache.delete(detailCache.keys().next().value)
      }
      return entry
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, promise)
  return promise
}

module.exports = async (query, request) => {
  const detail = await getPlaylistDetail(query.id, query, request)
  const limit = parseInt(query.limit) || 1000
  const offset = parseInt(query.offset) || 0
  const requested = detail.trackIds.slice(offset, offset + limit)

  let missing = []
  const songs = []
  for (const item of requested) {
    const id = Number(item && item.id)
    if (!id) continue
    const cached = detail.tracksById.get(id)
    if (cached) {
      songs.push(cached)
    } else {
      missing.push({ id })
    }
  }

  let responseCookie = detail.cookie
  if (missing.length) {
    const response = await request(
      `/api/v3/song/detail`,
      {
        c:
          '[' +
          missing.map((item) => '{"id":' + item.id + '}').join(',') +
          ']',
      },
      createOption(query),
    )
    const fetched = Array.isArray(response.body?.songs)
      ? response.body.songs
      : []
    for (const song of fetched) {
      if (song && song.id) detail.tracksById.set(song.id, song)
    }
    responseCookie = response.cookie || responseCookie
  }

  // Preserve the requested order even when some tracks came from the playlist
  // detail cache and the rest came from the song-detail request.
  const ordered = requested
    .map((item) => detail.tracksById.get(Number(item && item.id)))
    .filter(Boolean)

  return {
    status: 200,
    body: { songs: ordered.length ? ordered : songs },
    cookie: responseCookie,
  }
}
