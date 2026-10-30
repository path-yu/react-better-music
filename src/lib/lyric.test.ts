import { describe, expect, it } from 'vitest'
import {
  buildLyricLines,
  convertLrcToYrc,
  findLyricIndex,
  isEmptyLyric,
  parseJsonLyrics,
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

describe('convertLrcToYrc', () => {
  const raw = '[00:01.00]你好世界\n[00:03.00]Hello world!'
  const lines = parseYrc(convertLrcToYrc(raw))

  it('keeps every line and text intact', () => {
    expect(lines).toHaveLength(2)
    expect(lines[0].content).toBe('你好世界')
    expect(lines[1].content).toBe('Hello world!')
  })

  it('splits CJK per character and Latin runs per word', () => {
    expect(lines[0].words?.map((word) => word.content)).toEqual(['你', '好', '世', '界'])
    expect(lines[1].words?.map((word) => word.content)).toEqual(['Hello ', 'world!'])
  })

  it('produces monotonic karaoke timings inside the line', () => {
    const words = lines[0].words ?? []
    expect(words[0].startTime).toBe(1000)
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index].startTime).toBeGreaterThanOrEqual(
        words[index - 1].startTime + words[index - 1].duration,
      )
      expect(words[index].duration).toBeGreaterThan(0)
    }
    const last = words[words.length - 1]
    expect(last.startTime + last.duration).toBeLessThanOrEqual(3000)
  })

  it('is used automatically when buildLyricLines receives plain LRC', () => {
    const built = buildLyricLines({ lyric: raw })
    expect(built[0].words).toHaveLength(4)
    expect(built[1].words).toHaveLength(2)
    expect(built[0].synthetic).toBe(true)
    expect(built[1].synthetic).toBe(true)
  })

  it('does not mark real YRC lines as synthetic', () => {
    const built = buildLyricLines({
      lyric: '[00:01.00]plain',
      yrc: '[1000,500](1000,200,0)word',
    })
    expect(built[0].synthetic).toBeUndefined()
  })

  it('stretches the line across the gap until the next LRC timestamp', () => {
    const built = parseYrc(
      convertLrcToYrc('[00:01.00]你好世界\n[00:06.00]下一句'),
    )
    const words = built[0].words ?? []
    const last = words[words.length - 1]
    const end = last.startTime + last.duration
    // Starts at 1000ms; the animation should still be running near 6s, not
    // finishing at a ~1s text-length estimate.
    expect(end).toBeGreaterThan(5000)
    expect(end).toBeLessThanOrEqual(6000)
  })

  it('uses an empty LRC timestamp as the end of the previous line', () => {
    const raw = '[00:01.00]你好世界\n[00:02.00]\n[00:06.00]下一句'
    const yrc = convertLrcToYrc(raw)
    // Timing fields must stay integers; decimals made parseYrc drop lines.
    expect(yrc).not.toMatch(/\(\d+\.\d+/)
    expect(yrc).not.toMatch(/^\[\d+,\d+\.\d+/m)
    const built = parseYrc(yrc)
    expect(built).toHaveLength(2)
    const words = built[0].words ?? []
    const last = words[words.length - 1]
    expect(last.startTime + last.duration).toBeLessThanOrEqual(2000)
  })

  it('returns an empty body for input without LRC timestamps', () => {
    expect(convertLrcToYrc('no timestamps')).toBe('')
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

  it('parses JSON metadata lines when no LRC body exists', () => {
    const json = [
      '{"t":0,"c":[{"tx":"作词: "},{"tx":"李荣浩"}]}',
      '{"t":1000,"c":[{"tx":"作曲: "},{"tx":"李荣浩"}]}',
    ].join('\n')
    expect(parseJsonLyrics(json)).toEqual([
      { time: 0, content: '作词: 李荣浩' },
      { time: 1000, content: '作曲: 李荣浩' },
    ])
    expect(buildLyricLines({ lyric: json })).toHaveLength(2)
  })

  it('detects yrc timing embedded in the lyric field', () => {
    const lines = buildLyricLines({
      lyric: '[1000,500](1000,200,0)你(1200,300,0)好',
    })
    expect(lines[0].words).toEqual([
      { content: '你', startTime: 1000, duration: 200 },
      { content: '好', startTime: 1200, duration: 300 },
    ])
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
