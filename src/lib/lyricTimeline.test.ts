import { describe, expect, it } from 'vitest'
import type { LyricLine } from './lyric'
import {
  INTERLUDE_MIN_MS,
  buildLyricTimeline,
  lineShowsWords,
  emphasisCurve,
  emphasisParams,
  groupWordChunks,
  resolveLyricFrame,
  shouldEmphasize,
  wordLift,
  wordProgress,
} from './lyricTimeline'

const showAll = { showWords: () => true }

function line(time: number, words: Array<[string, number, number]>): LyricLine {
  return {
    time,
    content: words.map(([content]) => content).join(''),
    words: words.map(([content, startTime, duration]) => ({ content, startTime, duration })),
  }
}

describe('shouldEmphasize', () => {
  it('needs a held note of at least one second', () => {
    expect(shouldEmphasize('爱', 999)).toBe(false)
    expect(shouldEmphasize('爱', 1000)).toBe(true)
  })

  it('limits Latin words to short ones', () => {
    expect(shouldEmphasize('love ', 1500)).toBe(true)
    expect(shouldEmphasize('a', 1500)).toBe(false)
    expect(shouldEmphasize('everything', 1500)).toBe(false)
    expect(shouldEmphasize('   ', 1500)).toBe(false)
  })
})

describe('lineShowsWords', () => {
  const real = line(0, [['你', 0, 200]])
  const options = { wordByWord: true, translationOnly: false }

  it('wipes lines with real syllable timings', () => {
    expect(lineShowsWords(real, options)).toBe(true)
  })

  it('lights line-synced LRC as a whole line', () => {
    expect(lineShowsWords({ ...real, synthetic: true }, options)).toBe(false)
    expect(lineShowsWords({ time: 0, content: '纯文本' }, options)).toBe(false)
  })

  it('respects the setting and translation-only mode', () => {
    expect(lineShowsWords(real, { ...options, wordByWord: false })).toBe(false)
    expect(
      lineShowsWords({ ...real, translate: 'hi' }, { ...options, translationOnly: true }),
    ).toBe(false)
    expect(lineShowsWords(real, { ...options, translationOnly: true })).toBe(true)
  })
})

describe('buildLyricTimeline', () => {
  it('ends a line when its last word ends', () => {
    const timeline = buildLyricTimeline(
      [line(1000, [['你', 1000, 200], ['好', 1200, 300]]), line(3000, [['啊', 3000, 400]])],
      showAll,
    )
    expect(timeline.lines[0]).toMatchObject({ start: 1000, end: 1500 })
    expect(timeline.lines[0].words.map((word) => word.last)).toEqual([false, true])
  })

  it('falls back to the next line for plain lines', () => {
    const timeline = buildLyricTimeline(
      [{ time: 0, content: 'a' }, { time: 2500, content: 'b' }],
      showAll,
    )
    expect(timeline.lines[0].end).toBe(2500)
    expect(timeline.lines[1].end).toBe(7500)
  })

  it('keeps real end times even when words are hidden', () => {
    const timeline = buildLyricTimeline([line(0, [['x', 0, 800]])], {
      showWords: () => false,
    })
    expect(timeline.lines[0]).toEqual({ start: 0, end: 800, words: [] })
  })

  it('never emphasises synthesised LRC timings', () => {
    const synthetic = { ...line(0, [['长', 0, 3000]]), synthetic: true }
    expect(buildLyricTimeline([synthetic], showAll).lines[0].words[0].emphasize).toBe(false)
    expect(buildLyricTimeline([line(0, [['长', 0, 3000]])], showAll).lines[0].words[0].emphasize).toBe(true)
  })

  it('adds interludes for the intro and long breaks only', () => {
    const timeline = buildLyricTimeline(
      [
        line(5000, [['a', 5000, 1000]]),
        line(7000, [['b', 7000, 1000]]),
        line(8000 + INTERLUDE_MIN_MS, [['c', 8000 + INTERLUDE_MIN_MS, 500]]),
      ],
      showAll,
    )
    expect(timeline.interludes).toEqual([
      { start: 0, end: 5000, beforeLine: 0 },
      { start: 8000, end: 8000 + INTERLUDE_MIN_MS, beforeLine: 2 },
    ])
  })
})

describe('resolveLyricFrame', () => {
  const timeline = buildLyricTimeline(
    [
      line(0, [['a', 0, 1000]]),
      // Still sung when the next line starts.
      line(1500, [['b', 1500, 2000]]),
      line(3000, [['c', 3000, 500]]),
      line(10_000, [['d', 10_000, 500]]),
    ],
    showAll,
  )

  it('keeps the latest line lit until the next one starts', () => {
    expect(resolveLyricFrame(timeline, 1200)).toEqual({
      anchorLine: 0,
      activeLines: [0],
      interlude: -1,
    })
  })

  it('lights overlapping lines together', () => {
    expect(resolveLyricFrame(timeline, 3200).activeLines).toEqual([1, 2])
  })

  it('hands long breaks to the interlude dots', () => {
    expect(resolveLyricFrame(timeline, 6000)).toEqual({
      anchorLine: 2,
      activeLines: [],
      interlude: 0,
    })
  })

  it('reports nothing before the first line', () => {
    expect(resolveLyricFrame({ lines: [], interludes: [] }, 0)).toEqual({
      anchorLine: -1,
      activeLines: [],
      interlude: -1,
    })
  })
})

describe('word motion', () => {
  const word = { start: 1000, end: 1400, emphasize: false, last: false }

  it('wipes linearly through the word', () => {
    expect(wordProgress(word, 900)).toBe(0)
    expect(wordProgress(word, 1200)).toBe(0.5)
    expect(wordProgress(word, 2000)).toBe(1)
  })

  it('floats short words for at least a second', () => {
    expect(wordLift(word, 1000)).toBe(0)
    expect(wordLift(word, 1400)).toBeLessThan(1)
    expect(wordLift(word, 2000)).toBe(1)
  })

  it('emphasises longer and final notes harder', () => {
    expect(emphasisParams(3000, false).strength).toBeGreaterThan(
      emphasisParams(1200, false).strength,
    )
    expect(emphasisParams(2000, true).strength).toBeGreaterThan(
      emphasisParams(2000, false).strength,
    )
    expect(emphasisParams(10_000, true).strength).toBeLessThanOrEqual(1.2)
  })

  it('rises and falls once per letter, letters staggered', () => {
    const held = { start: 0, end: 2000, emphasize: true, last: false }
    expect(emphasisCurve(held, 0, 0, 3)).toBe(0)
    expect(emphasisCurve(held, 1000, 0, 3)).toBeCloseTo(1)
    expect(emphasisCurve(held, 2000, 0, 3)).toBe(0)
    expect(emphasisCurve(held, 200, 2, 3)).toBe(0)
  })
})

describe('groupWordChunks', () => {
  it('keeps syllables of one Latin word together', () => {
    expect(
      groupWordChunks([{ content: 'Hel' }, { content: 'lo ' }, { content: 'world' }]),
    ).toEqual([[0, 1], [2]])
  })

  it('lets every CJK character wrap', () => {
    expect(groupWordChunks([{ content: '你' }, { content: '好' }])).toEqual([[0], [1]])
  })
})
