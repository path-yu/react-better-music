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
  /** True when the word timings were synthesized from plain LRC. */
  synthetic?: boolean
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

interface LrcEntry {
  time: number
  content: string
}

function parseLrcEntries(raw?: string, includeEmpty = false): LrcEntry[] {
  if (!raw) return []
  const result: LrcEntry[] = []
  const lines = raw.split('\n')
  for (const line of lines) {
    const decoded = safeDecode(line)
    const timeReg = /\[\d*:\d*((\.|:)\d*)*\]/g
    const matches = decoded.match(timeReg)
    if (!matches) continue
    const content = decoded.replace(timeReg, '').trim()
    // Empty timed lines are meaningful: they mark the end of the previous sung
    // line before an instrumental break. Keep them for duration synthesis, but
    // don't render them as lyrics.
    if (!content && !includeEmpty) continue
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

export function parseLrc(raw?: string): LyricLine[] {
  return parseLrcEntries(raw, false)
}

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/
const LATIN_CHAR = /[A-Za-z0-9]/
const WORD_JOINER = /['’-]/

/**
 * Split a lyric line into karaoke tokens while preserving the exact text:
 * CJK characters and emoji become single tokens, Latin/digit runs become one
 * token, and spaces/punctuation stay attached to the previous token so the
 * rendered line never loses characters.
 */
function tokenizeLyric(content: string): string[] {
  const tokens: string[] = []
  for (const char of Array.from(content)) {
    if (/\s/.test(char)) {
      if (tokens.length) tokens[tokens.length - 1] += char
      else tokens.push(char)
      continue
    }
    if (CJK_CHAR.test(char)) {
      tokens.push(char)
      continue
    }
    if (LATIN_CHAR.test(char) || WORD_JOINER.test(char)) {
      const last = tokens[tokens.length - 1]
      const lastChar = last ? Array.from(last).pop() ?? '' : ''
      if (last && (LATIN_CHAR.test(lastChar) || WORD_JOINER.test(lastChar))) {
        tokens[tokens.length - 1] += char
      } else {
        tokens.push(char)
      }
      continue
    }
    // Punctuation / other graphemes stay visually attached to the previous
    // token so the highlight does not create orphan punctuation.
    if (tokens.length) tokens[tokens.length - 1] += char
    else tokens.push(char)
  }
  return tokens
}

/** Relative weight for how long a token should stay highlighted. */
function tokenWeight(token: string): number {
  const cjk = (token.match(new RegExp(CJK_CHAR, 'g')) ?? []).length
  const latin = (token.match(/[A-Za-z0-9]/g) ?? []).length
  const punctuation = (token.match(/[，。！？、；：,.?!;:'"“”‘’（）()《》…—]/g) ?? []).length
  return Math.max(1, cjk + latin * 0.55 + punctuation * 0.2)
}

function sanitizeYrcText(value: string) {
  // The YRC grammar reserves parentheses/newlines for timing markers.
  return value.replace(/\(/g, '（').replace(/\)/g, '）').replace(/[\r\n]/g, ' ')
}

function synthesizeYrcLines(lines: LrcEntry[]): string {
  return lines
    .map((line, index) => {
      const tokens = tokenizeLyric(line.content)
      if (!tokens.length) return ''
      const next = lines[index + 1]
      const weights = tokens.map(tokenWeight)
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
      const natural = Math.min(9000, Math.max(900, totalWeight * 210 + 240))
      const gap = next ? next.time - line.time : Infinity
      let budget: number
      if (gap === Infinity) {
        // No following timestamp: fall back to the text-length estimate.
        budget = natural
      } else if (gap <= 8000) {
        // LRC only records line starts. Until the next line starts, this line is
        // still the current line, so stretch the karaoke across almost the whole
        // gap instead of stopping at a short text-length estimate. This is what
        // prevents the previous line finishing before the singer does.
        const tail = Math.round(Math.min(160, Math.max(60, gap * 0.03)))
        budget = Math.max(60, gap - tail)
      } else {
        // A very long gap is usually an instrumental break; don't animate one
        // line for 20 seconds.
        budget = Math.min(8000, Math.max(3500, Math.round(natural * 1.6)))
      }
      if (gap !== Infinity && gap < 260) budget = Math.max(40, gap - 20)
      // YRC timing fields are integers. Floats made `parseYrc` silently drop
      // whole lines, which looked like the lyrics stopped animating.
      budget = Math.max(Math.round(budget), tokens.length)

      // Allocate durations proportionally, with a floor so every token gets a
      // visible frame, then correct rounding against the exact line budget.
      const floor = Math.max(1, Math.min(45, Math.floor(budget / tokens.length)))
      const durations = weights.map((weight) =>
        Math.max(floor, Math.round((weight / totalWeight) * budget)),
      )
      let allocated = durations.reduce((sum, duration) => sum + duration, 0)
      while (allocated > budget) {
        const largest = durations.reduce(
          (best, duration, tokenIndex) =>
            duration > durations[best] ? tokenIndex : best,
          0,
        )
        if (durations[largest] <= 1) break
        durations[largest] -= 1
        allocated -= 1
      }
      durations[durations.length - 1] += budget - allocated

      let cursor = Math.round(line.time)
      const words = tokens.map((token, tokenIndex) => {
        const duration = Math.max(1, Math.round(durations[tokenIndex]))
        const word: LyricWord = {
          content: sanitizeYrcText(token),
          startTime: cursor,
          duration,
        }
        cursor += duration
        return word
      })
      return `[${line.time},${budget}]${words
        .map((word) => `(${word.startTime},${word.duration},0)${word.content}`)
        .join('')}`
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Convert ordinary LRC into a synthetic YRC body. There are no real word
 * timings in LRC, so the converter distributes each line's time over grapheme
 * tokens (CJK chars, Latin words), respecting the next line's timestamp and
 * adding a small breath gap before it. `parseYrc` turns the result into the
 * word timings consumed by `LyricsPanel`.
 */
export function convertLrcToYrc(raw?: string): string {
  const lines = parseLrcEntries(raw, true)
  if (!lines.some((line) => line.content)) return ''
  return synthesizeYrcLines(lines)
}

export function parseYrc(raw?: string): LyricLine[] {
  if (!raw) return []
  const lines = raw.split('\n')
  const result: LyricLine[] = []
  for (const line of lines) {
    const lineMatch = line.match(/^\[(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\]/)
    if (!lineMatch) continue
    const start = Math.round(Number(lineMatch[1]))
    const body = line.slice(lineMatch[0].length)
    const wordRegex = /\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),\d+\)([^()\n]+)/g
    const words: LyricWord[] = []
    let wordMatch: RegExpExecArray | null
    while ((wordMatch = wordRegex.exec(body)) !== null) {
      words.push({
        content: wordMatch[3],
        startTime: Math.round(Number(wordMatch[1])),
        duration: Math.max(1, Math.round(Number(wordMatch[2]))),
      })
    }
    const content = words.length
      ? words.map((word) => word.content).join('')
      : body.replace(/\(\d+(?:\.\d+)?,\d+(?:\.\d+)?,\d+\)/g, '').trim()
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
  let base: LyricLine[]
  if (yrcSource) {
    base = parseYrc(yrcSource)
  } else {
    const plain = parseLrc(lyric)
    // Use the timed entries (including empty markers) for timing, so a blank
    // LRC timestamp bounds the previous line instead of stretching it to the
    // next visible line across an instrumental break.
    const timed = parseLrcEntries(lyric, true)
    const synthesized = timed.length ? synthesizeYrcLines(timed) : ''
    base = synthesized
      ? parseYrc(synthesized).map((line) => ({ ...line, synthetic: true }))
      : plain.map((line) => ({ ...line, synthetic: true }))
  }
  if (!base.length && lyric) base = parseLrc(lyric)
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
