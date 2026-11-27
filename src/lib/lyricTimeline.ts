import type { LyricLine, LyricWord } from './lyric'

/**
 * Pure timing model for the Apple Music style ("逐字 / syllable-synced")
 * lyric view. Everything that depends only on lyric data and the playhead
 * lives here so it can be unit-tested; `lyricEngine.ts` turns it into DOM
 * writes every frame.
 */

/** A gap at least this long between sung lines shows the "…" interlude dots. */
export const INTERLUDE_MIN_MS = 4000
/** A word held at least this long gets the per-letter glow/lift emphasis. */
export const EMPHASIS_MIN_MS = 1000

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/

export interface TimedWord {
  start: number
  end: number
  /** Long held word: letters scale up and glow while it is sung. */
  emphasize: boolean
  /** Last word of the line (its emphasis is stronger and lasts longer). */
  last: boolean
}

export interface TimedLine {
  start: number
  end: number
  /** Empty when the line is rendered as plain text (no word timings shown). */
  words: TimedWord[]
}

export interface TimedInterlude {
  start: number
  end: number
  /** The interlude is rendered right before this line. */
  beforeLine: number
}

export interface LyricTimeline {
  lines: TimedLine[]
  interludes: TimedInterlude[]
}

export interface LyricFrameState {
  /** Latest line whose start time has passed (-1 before the first line). */
  anchorLine: number
  /** Lines currently highlighted, ascending. Overlapping lines can share time. */
  activeLines: number[]
  /** Index into `timeline.interludes`, or -1. */
  interlude: number
}

function wordEnd(word: LyricWord) {
  return word.startTime + Math.max(1, word.duration)
}

/**
 * Apple Music only emphasises long held syllables. CJK tokens are a single
 * character, so duration alone decides; Latin words must also be short enough
 * that scaling every letter does not look like the whole line is wobbling.
 */
export function shouldEmphasize(content: string, duration: number) {
  if (duration < EMPHASIS_MIN_MS) return false
  const text = content.trim()
  if (!text) return false
  if (CJK.test(text)) return true
  const length = Array.from(text).length
  return length > 1 && length <= 7
}

/**
 * Whether a line is wiped syllable by syllable. Apple Music only does that
 * for lyrics with real syllable timings; line-synced lyrics (plain LRC, whose
 * word timings `buildLyricLines` only estimates) light the whole line at once.
 */
export function lineShowsWords(
  line: LyricLine,
  options: { wordByWord: boolean; translationOnly: boolean },
) {
  return (
    options.wordByWord &&
    !line.synthetic &&
    Boolean(line.words?.length) &&
    !(options.translationOnly && line.translate)
  )
}

export function buildLyricTimeline(
  lines: LyricLine[],
  options: {
    /** Whether this line renders word spans (word-by-word enabled, not translation-only). */
    showWords: (line: LyricLine) => boolean
  },
): LyricTimeline {
  const timed: TimedLine[] = lines.map((line, index) => {
    const source = options.showWords(line) && line.words?.length ? line.words : []
    const words = source.map((word, wordIndex) => {
      const start = word.startTime
      const end = wordEnd(word)
      return {
        start,
        end,
        // Synthesised LRC timings are guesses; never fake a held note.
        emphasize: !line.synthetic && shouldEmphasize(word.content, end - start),
        last: wordIndex === source.length - 1,
      }
    })
    const next = lines[index + 1]
    // Real word timings define when the singer stops, even when the words are
    // not displayed (translation mode / word-by-word off).
    const sungEnd = line.words?.length
      ? line.words.reduce((max, word) => Math.max(max, wordEnd(word)), line.time)
      : next
        ? next.time
        : line.time + 5000
    return { start: line.time, end: Math.max(line.time + 1, sungEnd), words }
  })

  const interludes: TimedInterlude[] = []
  let previousEnd = 0
  timed.forEach((line, index) => {
    if (line.start - previousEnd >= INTERLUDE_MIN_MS) {
      interludes.push({ start: previousEnd, end: line.start, beforeLine: index })
    }
    previousEnd = Math.max(previousEnd, line.end)
  })

  return { lines: timed, interludes }
}

function latestStartedLine(lines: TimedLine[], timeMs: number) {
  let left = 0
  let right = lines.length - 1
  let result = -1
  while (left <= right) {
    const mid = (left + right) >> 1
    if (lines[mid].start <= timeMs) {
      result = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  return result
}

/**
 * Which lines are lit at `timeMs`.
 *
 * - Every line whose [start, end) contains the playhead is lit, so a line the
 *   singer is still holding stays lit after the next one starts (duets,
 *   overlapping YRC lines).
 * - The latest started line stays lit until the next line starts, unless the
 *   gap is long enough for interlude dots; then the dots take over.
 */
export function resolveLyricFrame(
  timeline: LyricTimeline,
  timeMs: number,
): LyricFrameState {
  const { lines, interludes } = timeline
  const anchorLine = latestStartedLine(lines, timeMs)
  let interlude = -1
  for (let index = 0; index < interludes.length; index += 1) {
    const item = interludes[index]
    if (timeMs >= item.start && timeMs < item.end) {
      interlude = index
      break
    }
  }
  const activeLines: number[] = []
  // Overlaps only ever span a few lines; don't scan the whole song.
  for (let index = Math.max(0, anchorLine - 6); index <= anchorLine; index += 1) {
    if (timeMs < lines[index].end) activeLines.push(index)
  }
  if (interlude < 0 && anchorLine >= 0 && !activeLines.includes(anchorLine)) {
    activeLines.push(anchorLine)
  }
  return { anchorLine, activeLines, interlude }
}

export function clamp01(value: number) {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

/** Linear wipe position inside a word, 0…1. */
export function wordProgress(word: TimedWord, timeMs: number) {
  return clamp01((timeMs - word.start) / Math.max(1, word.end - word.start))
}

export function easeOutCubic(x: number) {
  const inverse = 1 - clamp01(x)
  return 1 - inverse * inverse * inverse
}

export function easeInOutSine(x: number) {
  return -(Math.cos(Math.PI * clamp01(x)) - 1) / 2
}

/** How far a word has floated up, 0…1. Short words still float for 1 s. */
export function wordLift(word: TimedWord, timeMs: number) {
  const span = Math.max(EMPHASIS_MIN_MS, word.end - word.start)
  return easeOutCubic((timeMs - word.start) / span)
}

/**
 * Emphasis strength (0…1.2) and the length of one letter's rise-and-fall.
 * Longer notes glow harder; the final word of a line gets an extra push, as
 * Apple Music does on the held note that closes a phrase.
 */
export function emphasisParams(duration: number, last: boolean) {
  const held = clamp01((duration - EMPHASIS_MIN_MS) / 2000)
  let strength = 0.4 + 0.6 * held ** 0.7
  let span = Math.max(EMPHASIS_MIN_MS, duration)
  if (last) {
    strength *= 1.2
    span *= 1.2
  }
  return { strength: Math.min(1.2, strength), span }
}

/**
 * Rise-and-fall curve for one letter of an emphasised word. Letters start
 * one after another (`index` / `count`), each peaking halfway through.
 */
export function emphasisCurve(
  word: TimedWord,
  timeMs: number,
  index: number,
  count: number,
) {
  const { span } = emphasisParams(word.end - word.start, word.last)
  const delay = (span / 2.5 / Math.max(1, count)) * index
  const x = (timeMs - word.start - delay) / span
  if (x <= 0 || x >= 1) return 0
  return x < 0.5 ? easeOutCubic(x / 0.5) : 1 - easeInOutSine((x - 0.5) / 0.5)
}

/**
 * Group word tokens into unbreakable chunks. YRC sometimes splits one Latin
 * word into syllables ("Hel", "lo "); the line may only wrap after a space or
 * a CJK character, never inside a word.
 */
export function groupWordChunks(words: Pick<LyricWord, 'content'>[]): number[][] {
  const chunks: number[][] = []
  let current: number[] = []
  words.forEach((word, index) => {
    current.push(index)
    const text = word.content
    const lastChar = Array.from(text).pop() ?? ''
    if (/\s/.test(lastChar) || CJK.test(text) || index === words.length - 1) {
      chunks.push(current)
      current = []
    }
  })
  if (current.length) chunks.push(current)
  return chunks
}
