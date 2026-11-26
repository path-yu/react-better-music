const createOption = require('./option.js')

/**
 * Title / artists / duration of a NetEase track, used by the video-site
 * matchers. Failures degrade to an empty meta instead of throwing: an empty
 * meta means "no keyword", which the matchers turn into "not found".
 */
async function loadSongMeta(query, request) {
  const fallback = { id: query.id, name: '', artist: '', durationMs: 0 }
  try {
    const res = await request(
      '/api/v3/song/detail',
      { c: `[{"id":${Number(query.id)}}]` },
      createOption(query, 'weapi'),
    )
    const song = res?.body?.songs?.[0]
    if (!song) return fallback
    return {
      id: song.id,
      name: song.name || '',
      artist: (song.ar || [])
        .map((artist) => artist.name)
        .filter(Boolean)
        .join(' '),
      durationMs: Number(song.dt) || 0,
    }
  } catch {
    return fallback
  }
}

module.exports = { loadSongMeta }
