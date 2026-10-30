export interface LyricWord {
  content: string
  startTime: number
  duration: number
}

export interface LyricLine {
  time: number
  content: string
  translate?: string
  words?: LyricWord[]
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseLrc(raw?: string): LyricLine[] {
  if (!raw) return []
  const result: LyricLine[] = []
  const lines = raw.split('\n')
  for (const line of lines) {
    const decoded = safeDecode(line)
    const timeReg = /\[\d*:\d*((\.|:)\d*)*\]/g
    const matches = decoded.match(timeReg)
    if (!matches) continue
    const content = decoded.replace(timeReg, '').trim()
    if (!content) continue
    for (const match of matches) {
      const minutePart = match.match(/\[\d*/)
      const minutes = minutePart ? Number(minutePart[0].slice(1)) : 0
      const secondMatch = match.match(/:(\d{2}\.\d*)/)
      const seconds = secondMatch ? Number(secondMatch[1]) : 0
      result.push({
        time: Math.round(minutes * 60 * 1000 + seconds * 1000),
        content,
      })
    }
  }
  return result.sort((a, b) => a.time - b.time)
}

export function parseYrc(raw?: string): LyricLine[] {
  if (!raw) return []
  const lines = raw.split('\n')
  const result: LyricLine[] = []
  for (const line of lines) {
    const lineMatch = line.match(/^\[(\d+),(\d+)\]/)
    if (!lineMatch) continue
    const start = Number(lineMatch[1])
    const body = line.slice(lineMatch[0].length)
    const wordRegex = /\((\d+),(\d+),\d+\)([^()\n]+)/g
    const words: LyricWord[] = []
    let wordMatch: RegExpExecArray | null
    while ((wordMatch = wordRegex.exec(body)) !== null) {
      words.push({
        content: wordMatch[3],
        startTime: Number(wordMatch[1]),
        duration: Number(wordMatch[2]),
      })
    }
    const content = words.length
      ? words.map((word) => word.content).join('')
      : body.replace(/\(\d+,\d+,\d+\)/g, '').trim()
    if (!content) continue
    result.push({
      time: start,
      content,
      words: words.length ? words : undefined,
    })
  }
  return result.sort((a, b) => a.time - b.time)
}

/**
 * Some `/lyric/new` responses begin with one JSON metadata object per line
 * ({"t":0,"c":[{"tx":"作词: "},...]}) before the plain LRC/yrc body. When the
 * body is JSON-only, parse those timed credit lines instead of returning [].
 */
export function parseJsonLyrics(raw?: string): LyricLine[] {
  if (!raw) return []
  const result: LyricLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue
    try {
      const payload = JSON.parse(trimmed) as {
        t?: unknown
        c?: Array<{ tx?: unknown }>
      }
      if (typeof payload.t !== 'number' || !Array.isArray(payload.c)) continue
      const content = payload.c
        .map((part) => (typeof part.tx === 'string' ? part.tx : ''))
        .join('')
        .trim()
      if (content) result.push({ time: payload.t, content })
    } catch {
      // Ignore malformed metadata lines.
    }
  }
  return result.sort((a, b) => a.time - b.time)
}

function hasYrcTiming(raw: string) {
  return /^\[\d+,\d+\]\(\d+,\d+,\d+\)/m.test(raw)
}

export function buildLyricLines(options: {
  lyric?: string
  tlyric?: string
  yrc?: string
}): LyricLine[] {
  const { lyric, tlyric, yrc } = options
  // `lrc` can occasionally carry yrc-formatted lines when the server omits
  // the separate yrc field; detect the word-timing syntax before falling back.
  const yrcSource = yrc || (lyric && hasYrcTiming(lyric) ? lyric : '')
  let base = yrcSource ? parseYrc(yrcSource) : parseLrc(lyric)
  if (!base.length) base = parseLrc(lyric)
  if (!base.length) base = parseJsonLyrics(lyric)
  if (!base.length) return []
  if (!tlyric) return base
  const translated = parseLrc(tlyric)
  if (!translated.length) return base
  return base.map((line, index) => {
    const translation = translated[index]?.content
    return translation && translation !== line.content
      ? { ...line, translate: translation }
      : line
  })
}

export function findLyricIndex(lines: LyricLine[], timeMs: number) {
  if (!lines.length) return -1
  let left = 0
  let right = lines.length - 1
  let result = -1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (lines[mid].time <= timeMs) {
      result = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  return result
}

export function isEmptyLyric(lyric?: string) {
  if (!lyric) return true
  return lyric.includes('纯音乐，请欣赏')
}
