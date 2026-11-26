/**
 * Bilibili fallback source.
 *
 * Search is keyword based, so the ranking has to do the real work:
 * title similarity, uploader identity, and — the strongest signal — duration.
 * Candidates that disagree with the NetEase track on length are rejected
 * outright, and the resolved DASH stream is verified once more before it is
 * accepted. Audio needs a bilibili referer, so playback goes through
 * `/audio/proxy`.
 */
const crypto = require('crypto')
const axios = require('axios')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }
const TIMEOUT = 15000

/** WBI shuffles the two nav keys through this fixed table. */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

let cachedMixinKey = { value: '', at: 0 }

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex')
}

async function getMixinKey() {
  if (cachedMixinKey.value && Date.now() - cachedMixinKey.at < 55 * 60_000) {
    return cachedMixinKey.value
  }
  const res = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
    headers: HEADERS,
    timeout: TIMEOUT,
  })
  const image = res.data?.data?.wbi_img?.img_url || ''
  const sub = res.data?.data?.wbi_img?.sub_url || ''
  const imageKey = image.split('/').pop().split('.')[0]
  const subKey = sub.split('/').pop().split('.')[0]
  if (!imageKey || !subKey) throw new Error('bilibili wbi keys unavailable')
  const raw = imageKey + subKey
  const value = MIXIN_KEY_ENC_TAB.map((index) => raw[index])
    .join('')
    .slice(0, 32)
  cachedMixinKey = { value, at: Date.now() }
  return value
}

/** `w_rid` signature: sorted, url-encoded params + the shuffled key. */
function signQuery(params, mixinKey) {
  const all = { ...params, wts: Math.floor(Date.now() / 1000) }
  const query = Object.keys(all)
    .sort()
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(
          String(all[key]).replace(/[!'()*]/g, ''),
        )}`,
    )
    .join('&')
  return `${query}&w_rid=${md5(query + mixinKey)}`
}

async function searchVideos(keyword, order) {
  const mixinKey = await getMixinKey()
  const query = signQuery(
    { search_type: 'video', keyword, page: 1, ...(order ? { order } : {}) },
    mixinKey,
  )
  const res = await axios.get(
    `https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`,
    { headers: HEADERS, timeout: TIMEOUT },
  )
  if (res.data?.code !== 0) return []
  return res.data?.data?.result ?? []
}

// ---------------------------------------------------------------- text utils

function decodeEntities(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/** NFKC folds fullwidth chars; lowercase keeps comparisons cheap. */
function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Title without decorations: `【4K】Artist - Song (Official MV)` becomes
 * `artist song`. Bracketed tags are where 4K/翻唱/伴奏 usually hide, so they
 * must not count as part of the title.
 */
function coreTitle(title) {
  return normalize(title)
    .replace(/【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)|「[^」]*」|《[^》]*》/g, ' ')
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

/** 0..1 coverage of artist words in the title or the uploader name. */
function artistSimilarity(artist, title, author) {
  const normalized = normalize(artist)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  if (!normalized) return 0
  const haystack = `${coreTitle(title)} ${normalize(author)}`.replace(/\s+/g, '')
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

/** Bilibili returns `MM:SS` or `H:MM:SS`. */
function durationToSeconds(value) {
  if (!value) return 0
  const parts = String(value)
    .split(':')
    .map((part) => Number(part))
  if (!parts.length || parts.some((part) => Number.isNaN(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

// --------------------------------------------------------------- scoring

/**
 * Versions that are definitely not the track the user asked for. These are
 * rejected outright even when the duration happens to line up (a 3-minute
 * remix of a 2:47 song is still the wrong audio).
 *
 * The user's own title can contain one of these words ("Cover Me"); in that
 * case the rule is skipped, otherwise such a song could never be matched.
 */
const HARD_REJECT =
  /(伴奏|纯音乐|消音|翻自|翻唱|翻跳|remix|\bcover\b|\bdj\b|instrumental|off\s*vocal|8d|nightcore|slowed|sped\s*up|1\s*hour|一小时|循环|铃声|短信音|简谱|动态谱|五线谱|乐谱|曲谱|sheet\s*music)/i
/** Softer hints; a matched duration can still outweigh them. */
const SOFT_REJECT =
  /(舞蹈|练[习xi]室|直拍|慢速|倍速|教程|教学|reaction|直播|切片|合集|串烧|钢琴|吉他|架子鼓|八音盒|remake|live\s*ver|演唱会)/i
const GOOD_TITLE =
  /(官方|official|mv|audio|原曲|无损|完整版|高音质|hi-?res)/i
/** Official / label channels. */
const OFFICIAL_AUTHOR = /(官方|official|vevo|records|music\b|entertainment|studio)/i

function isHardRejected(title, name) {
  const normalizedTitle = normalize(title)
  const match = normalizedTitle.match(HARD_REJECT)
  if (!match) return false
  // The requested song itself uses that word, so it is the real title.
  return !normalize(name).includes(match[0].toLowerCase())
}

/**
 * Duration is the strongest signal: covers and remixes almost never match the
 * original length. `>4× tolerance` is a hard reject.
 */
function durationScore(seconds, expected) {
  if (!expected || !seconds) return { score: 0, reject: false }
  const diff = Math.abs(seconds - expected)
  const tolerance = Math.max(6, expected * 0.04)
  if (diff <= tolerance) return { score: 45, reject: false }
  if (diff <= tolerance * 2) return { score: 20, reject: false }
  if (diff <= tolerance * 3.5) return { score: -10, reject: false }
  return { score: -100, reject: true }
}

function scoreCandidate(item, meta) {
  const title = decodeEntities(item.title)
  const seconds = durationToSeconds(item.duration)
  const expected = meta.durationMs ? meta.durationMs / 1000 : 0
  const duration = durationScore(seconds, expected)

  let score = duration.score
  const name = meta.name ? nameSimilarity(meta.name, title) : 0
  const artist = meta.artist
    ? artistSimilarity(meta.artist, title, item.author)
    : 0
  score += name * 30
  score += artist * 18

  // A 2:47 video that merely mentions the word "attention" is another song.
  // Without any artist evidence, only official/audio uploads are trusted.
  // A `feat. Ami` style credit counts as evidence: collab titles routinely
  // omit the main artist ("Cry For Me (feat. Ami)" for Michita).
  const featHint = /\b(?:feat|ft)\.?\s/i.test(title)
  const officialHint =
    GOOD_TITLE.test(title) || OFFICIAL_AUTHOR.test(normalize(item.author))
  const missingArtist = Boolean(meta.artist) && artist < 0.34 && !featHint
  if (missingArtist) score -= 30

  // Official channels / label uploads are a good sign but not decisive.
  if (meta.artist && artist >= 0.99 && !SOFT_REJECT.test(title)) score += 8
  if (GOOD_TITLE.test(title)) score += 12
  if (OFFICIAL_AUTHOR.test(normalize(item.author))) score += 6
  // `feat. Ami` with no main artist in the title is still the official credit
  // of a collaboration, not an unrelated upload.
  if (featHint && artist < 0.34) score += 8
  if (SOFT_REJECT.test(title)) score -= 45

  const views = Number(item.play) || 0
  if (views > 0) score += Math.min(12, Math.log10(views) * 2)

  const reject =
    duration.reject ||
    isHardRejected(title, meta.name) ||
    (missingArtist && !officialHint)
  return { score, reject, seconds }
}

// --------------------------------------------------------------- resolving

/** DASH audio URL plus the stream's real length (seconds). */
async function resolveAudio(bvid) {
  const pages = await axios.get(
    `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`,
    { headers: HEADERS, timeout: TIMEOUT },
  )
  const cid = pages.data?.data?.[0]?.cid
  if (!cid) return null

  const play = await axios.get(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fourk=1`,
    { headers: HEADERS, timeout: TIMEOUT },
  )
  const data = play.data?.data
  const audios = data?.dash?.audio ?? []
  if (!audios.length) return null
  const best = [...audios].sort((a, b) => b.bandwidth - a.bandwidth)[0]
  const url = best.baseUrl || best.base_url || null
  if (!url) return null
  const duration =
    Number(data?.dash?.duration) || (Number(data?.timelength) || 0) / 1000
  return { url, duration }
}

/** Keyword variants, most specific first; each one costs one search. */
function keywordVariants(meta) {
  const name = (meta.name || '').trim()
  const artist = (meta.artist || '').trim()
  const variants = []
  if (name && artist) variants.push(`${name} ${artist}`)
  if (name && artist) variants.push(`${name} ${artist} audio`)
  if (name && artist) variants.push(`${name} ${artist} MV`)
  if (name) variants.push(name)
  return [...new Set(variants)].slice(0, 4)
}

const MIN_SCORE = 32

/** Dedupe by bvid, drop rejected uploads, keep the best `take`. */
function rankCandidates(results, meta, take = 4) {
  const seen = new Set()
  const scored = []
  for (const item of results) {
    if (!item || !item.bvid || seen.has(item.bvid)) continue
    seen.add(item.bvid)
    const entry = { item, ...scoreCandidate(item, meta) }
    if (entry.reject || entry.score < MIN_SCORE) continue
    scored.push(entry)
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, take)
}

/**
 * Ranked uploads for the source picker: metadata only, no stream resolution.
 * Returned covers are already https so the renderer can use them directly.
 */
async function listCandidates(meta, limit = 10) {
  const keyword = [meta.name, meta.artist].filter(Boolean).join(' ').trim()
  if (!keyword) return []

  let results = await searchVideos(keyword)
  let ranked = rankCandidates(results, meta, limit)
  if ((Number(ranked[0]?.item.play) || 0) < 10_000) {
    try {
      const popular = await searchVideos(keyword, 'click')
      results = [...results, ...popular]
      ranked = rankCandidates(results, meta, limit)
    } catch {
      // Keep the relevance ranking.
    }
  }

  return ranked.map((entry) => ({
    id: entry.item.bvid,
    title: decodeEntities(entry.item.title),
    author: entry.item.author || '',
    cover: String(entry.item.pic || '').replace(/^\/\//, 'https://'),
    duration: entry.seconds || 0,
    views: Number(entry.item.play) || 0,
    score: Math.round(entry.score),
    webUrl: `https://www.bilibili.com/video/${entry.item.bvid}`,
  }))
}

/**
 * @param {{ name?: string, artist?: string, durationMs?: number }} meta
 * @returns {Promise<{url: string, title: string, bvid: string, score: number,
 *   duration: number} | null>}
 */
async function matchSong(meta) {
  const expected = meta.durationMs ? meta.durationMs / 1000 : 0
  let best = null

  for (const keyword of keywordVariants(meta)) {
    let results = []
    try {
      results = await searchVideos(keyword)
    } catch {
      continue
    }

    let ranked = rankCandidates(results, meta)

    // A low-view top hit usually means relevance surfaced a re-upload. Ask
    // for the most played uploads too and rank both sets together; the
    // original upload of a popular song has orders of magnitude more views.
    if ((Number(ranked[0]?.item.play) || 0) < 10_000) {
      try {
        const popular = await searchVideos(keyword, 'click')
        ranked = rankCandidates([...results, ...popular], meta)
      } catch {
        // Keep the relevance ranking when the second request fails.
      }
    }

    for (const entry of ranked) {
      try {
        const audio = await resolveAudio(entry.item.bvid)
        if (!audio?.url) continue
        // Verify the actual stream, not just the search snippet. Official
        // uploads are often a few seconds longer (intro/outro), so the
        // post-download check is looser than the ranking preference.
        if (
          expected &&
          audio.duration &&
          Math.abs(audio.duration - expected) > Math.max(20, expected * 0.12)
        ) {
          continue
        }
        const candidate = {
          url: audio.url,
          title: decodeEntities(entry.item.title),
          bvid: entry.item.bvid,
          score: Math.round(entry.score),
          duration: audio.duration || entry.seconds,
        }
        if (!best || candidate.score > best.score) best = candidate
        return candidate
      } catch {
        // A broken upload must not abort the remaining candidates.
      }
    }
  }
  return best
}

module.exports = {
  matchSong,
  listCandidates,
  resolveAudio,
  // Exposed for the ranking tests; not used by the API.
  __test: { searchVideos, scoreCandidate, resolveAudio, durationToSeconds },
}
