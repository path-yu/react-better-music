/**
 * YouTube fallback source.
 *
 * `ytsearch1` alone takes whatever YouTube ranks first, which is regularly a
 * cover, a slowed edit or a one-hour loop. This module therefore searches a
 * handful of candidates, scores them the same way the Bilibili matcher does
 * (duration, title, channel), and only then resolves a stream URL.
 */
const { execFile } = require('child_process')
const ytdlp = require('./ytdlp.js')

const TIMEOUT = 30_000
const SEARCH_LIMIT = 8
const MIN_SCORE = 34

function runYtDlp(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: TIMEOUT, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const missing = error.code === 'ENOENT'
          const wrapped = new Error(
            missing ? 'yt-dlp not found' : stderr || error.message,
          )
          wrapped.code = missing ? 'YT_DLP_MISSING' : 'YT_DLP_FAILED'
          reject(wrapped)
          return
        }
        resolve(stdout.trim())
      },
    )
  })
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Title without `(Official Video)` / `[4K]` decorations. */
function coreTitle(title) {
  return normalize(title)
    .replace(
      /【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)|「[^」]*」|《[^》]*》/g,
      ' ',
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 0..1 coverage of the song name tokens inside the title. */
function nameSimilarity(name, title) {
  const normalized = normalize(name)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  if (!normalized) return 0
  const compactTitle = coreTitle(title).replace(/\s+/g, '')
  const compactName = normalized.replace(/\s+/g, '')
  if (!compactTitle) return 0
  if (compactName && compactTitle.includes(compactName)) return 1
  const tokens = normalized
    .split(' ')
    .filter((token) => token.length >= 2)
  if (!tokens.length) return 0
  const hit = tokens.filter((token) => compactTitle.includes(token)).length
  return hit / tokens.length
}

/** 0..1 coverage of artist words in the title or the channel name. */
function artistSimilarity(artist, title, channel) {
  const normalized = normalize(artist)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  if (!normalized) return 0
  const haystack = `${coreTitle(title)} ${normalize(channel)}`.replace(/\s+/g, '')
  const tokens = normalized
    .split(' ')
    .filter((token) => token.length >= 2)
  if (!tokens.length) return 0
  const hit = tokens.filter((token) => haystack.includes(token)).length
  if (hit > 0) return hit / tokens.length

  // Traditional vs simplified spellings differ per character (陳奕迅 vs
  // 陈奕迅), so fall back to character bigrams: 奕迅 still matches.
  const compact = normalized.replace(/\s+/g, '')
  if (compact.length < 2) return 0
  let bigramHits = 0
  let bigramTotal = 0
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigramTotal += 1
    if (haystack.includes(compact.slice(index, index + 2))) bigramHits += 1
  }
  return bigramTotal ? bigramHits / bigramTotal : 0
}

/** Uploads that are certainly not the requested track. */
const HARD_REJECT =
  /(伴奏|纯音乐|消音|翻自|翻唱|翻跳|remix|\bcover\b|\bdj\b|instrumental|karaoke|off\s*vocal|8d|nightcore|slowed|sped\s*up|reverb|1\s*hour|一小时|循环|reaction)/i
const SOFT_REJECT =
  /(live|演唱会|舞蹈|练[习xi]室|dance\s*(practice|cover|ver)|choreography|mirrored|教程|教学|切片|合集|串烧)/i
const GOOD_TITLE =
  /(官方|official|audio|lyrics?|mv|topic|原曲|完整版|高音质|hi-?res|lossless)/i
/** YouTube "Artist - Topic" channels are official label audio. */
const TOPIC_CHANNEL = /-\s*topic$/i

function durationScore(seconds, expected) {
  if (!expected || !seconds) return { score: 0, reject: false, diff: 0 }
  const diff = Math.abs(seconds - expected)
  // Same 4% / 6s band as the Bilibili matcher: an MV that is a few seconds
  // longer than the track must still beat a dance practice with an exact fit.
  const tolerance = Math.max(6, expected * 0.04)
  if (diff <= tolerance) return { score: 45, reject: false, diff }
  if (diff <= tolerance * 2) return { score: 25, reject: false, diff }
  if (diff <= tolerance * 3.5) return { score: 0, reject: false, diff }
  return { score: -100, reject: true, diff }
}

function scoreCandidate(entry, meta) {
  const title = entry.title || ''
  const channel = entry.channel || ''
  const expected = meta.durationMs ? meta.durationMs / 1000 : 0
  const duration = durationScore(entry.duration, expected)

  let score = duration.score
  const name = meta.name ? nameSimilarity(meta.name, title) : 0
  const artist = meta.artist ? artistSimilarity(meta.artist, title, channel) : 0
  score += name * 30
  score += artist * 18

  const officialHint =
    GOOD_TITLE.test(title) || TOPIC_CHANNEL.test(channel)
  const missingArtist = Boolean(meta.artist) && artist < 0.34
  if (missingArtist) score -= 30
  if (TOPIC_CHANNEL.test(channel)) score += 10
  if (GOOD_TITLE.test(title)) score += 8
  if (SOFT_REJECT.test(title)) score -= 25

  const views = Number(entry.views) || 0
  if (views > 0) score += Math.min(6, Math.log10(views) * 1.5)

  const reject =
    duration.reject ||
    HARD_REJECT.test(normalize(title)) ||
    (missingArtist && !officialHint)
  return { score, reject, seconds: entry.duration }
}

async function search(bin, keyword) {
  const output = await runYtDlp(bin, [
    '--no-warnings',
    '--no-check-certificates',
    '--flat-playlist',
    '-J',
    `ytsearch${SEARCH_LIMIT}:${keyword}`,
  ])
  const data = JSON.parse(output)
  return (data.entries ?? [])
    .filter((entry) => entry && entry.id)
    .map((entry) => ({
      id: entry.id,
      title: entry.title || '',
      duration: Number(entry.duration) || 0,
      channel: entry.channel || entry.uploader || '',
      views: Number(entry.view_count) || 0,
    }))
}

async function streamUrl(bin, id) {
  const output = await runYtDlp(bin, [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '-f',
    'bestaudio/best',
    '-g',
    `https://www.youtube.com/watch?v=${id}`,
  ])
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('http')) || null
  )
}

function keywordVariants(meta) {
  const name = (meta.name || '').trim()
  const artist = (meta.artist || '').trim()
  const variants = []
  if (name && artist) variants.push(`${name} ${artist}`)
  if (name && artist) variants.push(`${name} ${artist} audio`)
  if (name) variants.push(name)
  return [...new Set(variants)].slice(0, 3)
}

/**
 * @param {{ name?: string, artist?: string, durationMs?: number }} meta
 * @returns {Promise<{url: string, title: string, channel: string,
 *   duration: number, score: number} | null>}
 */
async function matchSong(meta) {
  const resolved = await ytdlp.resolveBinary()
  if (!resolved) {
    const missing = new Error('yt-dlp not found')
    missing.code = 'YT_DLP_MISSING'
    throw missing
  }

  for (const keyword of keywordVariants(meta)) {
    let entries = []
    try {
      entries = await search(resolved.path, keyword)
    } catch {
      continue
    }

    const ranked = entries
      .filter((entry) => entry.duration > 0)
      .map((entry) => ({ entry, ...scoreCandidate(entry, meta) }))
      .filter((item) => !item.reject && item.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    for (const item of ranked) {
      try {
        const url = await streamUrl(resolved.path, item.entry.id)
        if (!url) continue
        return {
          url,
          // Video id for the "open on YouTube" link in the source menu.
          id: item.entry.id,
          title: item.entry.title,
          channel: item.entry.channel,
          duration: item.entry.duration,
          score: Math.round(item.score),
        }
      } catch {
        // A single unplayable video must not abort the candidates.
      }
    }
  }
  return null
}

/** Ranked videos for the source picker: metadata only, no stream resolution. */
async function listCandidates(meta, limit = 10) {
  const resolved = await ytdlp.resolveBinary()
  if (!resolved) {
    const missing = new Error('yt-dlp not found')
    missing.code = 'YT_DLP_MISSING'
    throw missing
  }
  const keyword = [meta.name, meta.artist].filter(Boolean).join(' ').trim()
  if (!keyword) return []

  const entries = await search(resolved.path, keyword)
  return entries
    .filter((entry) => entry.duration > 0)
    .map((entry) => ({ entry, ...scoreCandidate(entry, meta) }))
    .filter((item) => !item.reject && item.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({
      id: item.entry.id,
      title: item.entry.title,
      author: item.entry.channel || '',
      cover: `https://i.ytimg.com/vi/${item.entry.id}/mqdefault.jpg`,
      duration: item.entry.duration || 0,
      views: item.entry.views || 0,
      score: Math.round(item.score),
      webUrl: `https://www.youtube.com/watch?v=${item.entry.id}`,
    }))
}

/** Resolve a specific video id (the picker already chose the candidate). */
async function resolveStream(videoId) {
  const resolved = await ytdlp.resolveBinary()
  if (!resolved) {
    const missing = new Error('yt-dlp not found')
    missing.code = 'YT_DLP_MISSING'
    throw missing
  }
  return streamUrl(resolved.path, videoId)
}

module.exports = {
  matchSong,
  listCandidates,
  resolveStream,
  // Exposed for the ranking tests; not used by the API.
  __test: { search },
}
