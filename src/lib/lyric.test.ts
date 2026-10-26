import { describe, expect, it } from 'vitest'
import {
  buildLyricLines,
  findLyricIndex,
  isEmptyLyric,
  parseLrc,
  parseYrc,
} from './lyric'

describe('parseLrc', () => {
  it('parses timestamps, trims text and sorts lines', () => {
    const lines = parseLrc('[00:02.50]第二行\n[00:01.00]第一行')
    expect(lines.map((line) => line.content)).toEqual(['第一行', '第二行'])
    expect(lines.map((line) => line.time)).toEqual([1000, 2500])
  })

  it('expands multiple timestamps on one line', () => {
    const lines = parseLrc('[00:01.00][00:03.00]副歌')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ time: 1000, content: '副歌' })
    expect(lines[1]).toEqual({ time: 3000, content: '副歌' })
  })

  it('decodes percent-encoded lyrics', () => {
    expect(parseLrc('[00:01.00]%E4%BD%A0%E5%A5%BD')[0]?.content).toBe('你好')
  })

  it('ignores malformed and empty input', () => {
    expect(parseLrc()).toEqual([])
    expect(parseLrc('no timestamps here')).toEqual([])
    expect(parseLrc('[00:01.00]   ')).toEqual([])
    expect(parseLrc('[00:01.00]%E0%A4%A')).toHaveLength(1)
  })
})

describe('parseYrc', () => {
  it('parses word-level timings', () => {
    const lines = parseYrc('[1000,500](1000,200,0)你(1200,300,0)好')
    expect(lines).toHaveLength(1)
    expect(lines[0].time).toBe(1000)
    expect(lines[0].content).toBe('你好')
    expect(lines[0].words).toEqual([
      { content: '你', startTime: 1000, duration: 200 },
      { content: '好', startTime: 1200, duration: 300 },
    ])
  })

  it('falls back to plain text when no word timings exist', () => {
    const lines = parseYrc('[2000,400]纯文本歌词')
    expect(lines[0]).toEqual({ time: 2000, content: '纯文本歌词', words: undefined })
  })

  it('ignores lines without a leading timestamp', () => {
    expect(parseYrc('garbage\n[1000,500](1000,200,0)好')).toHaveLength(1)
  })
})

describe('buildLyricLines', () => {
  it('attaches translations by line index', () => {
    const lines = buildLyricLines({
      lyric: '[00:01.00]Hello\n[00:02.00]World',
      tlyric: '[00:01.00]你好\n[00:02.00]世界',
    })
    expect(lines.map((line) => line.translate)).toEqual(['你好', '世界'])
  })

  it('drops translations identical to the original line', () => {
    const lines = buildLyricLines({
      lyric: '[00:01.00]Hello',
      tlyric: '[00:01.00]Hello',
    })
    expect(lines[0].translate).toBeUndefined()
  })

  it('prefers word-level lyrics and falls back when they are invalid', () => {
    const yrcLines = buildLyricLines({
      lyric: '[00:01.00]plain',
      yrc: '[1000,500](1000,200,0)word',
    })
    expect(yrcLines[0].content).toBe('word')

    const fallback = buildLyricLines({
      lyric: '[00:01.00]plain',
      yrc: 'invalid',
    })
    expect(fallback[0].content).toBe('plain')
  })

  it('returns [] when no lyric source exists', () => {
    expect(buildLyricLines({})).toEqual([])
  })
})

describe('findLyricIndex', () => {
  const lines = [
    { time: 0, content: 'a' },
    { time: 1000, content: 'b' },
    { time: 2000, content: 'c' },
  ]

  it('finds the last line whose time is not after the playhead', () => {
    expect(findLyricIndex(lines, -1)).toBe(-1)
    expect(findLyricIndex(lines, 0)).toBe(0)
    expect(findLyricIndex(lines, 999)).toBe(0)
    expect(findLyricIndex(lines, 1000)).toBe(1)
    expect(findLyricIndex(lines, 2500)).toBe(2)
  })

  it('returns -1 for empty lyrics', () => {
    expect(findLyricIndex([], 1000)).toBe(-1)
  })
})

describe('isEmptyLyric', () => {
  it('detects missing and instrumental-only lyrics', () => {
    expect(isEmptyLyric()).toBe(true)
    expect(isEmptyLyric('')).toBe(true)
    expect(isEmptyLyric('[00:00.00]纯音乐，请欣赏')).toBe(true)
    expect(isEmptyLyric('[00:01.00]hello')).toBe(false)
  })
})
