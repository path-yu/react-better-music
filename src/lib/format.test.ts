import { describe, expect, it } from 'vitest'
import {
  cn,
  formatArtists,
  formatDate,
  formatDuration,
  formatNumber,
  getArrLast,
  matchesKeyword,
} from './format'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
    expect(cn()).toBe('')
  })
})

describe('formatDuration', () => {
  it.each([
    [undefined, '00:00'],
    [0, '00:00'],
    [-1, '00:00'],
    [59_999, '00:59'],
    [61_000, '01:01'],
    [3_600_000, '60:00'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })
})

describe('formatNumber', () => {
  it.each([
    [undefined, '0'],
    [0, '0'],
    [9_999, '9999'],
    [99_998, '99998'],
    [99_999, '10万'],
    [100_000, '10万'],
    [99_999_999, '10000万'],
    [100_000_000, '1亿'],
    [250_000_000, '3亿'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatNumber(input)).toBe(expected)
  })
})

describe('formatDate', () => {
  it('formats local dates and ignores empty input', () => {
    const timestamp = new Date(2024, 0, 5, 8, 7).getTime()
    expect(formatDate(timestamp)).toBe('2024-01-05')
    expect(formatDate(timestamp, true)).toBe('2024-01-05 08:07')
    expect(formatDate()).toBe('')
    expect(formatDate(0)).toBe('')
    expect(formatDate('not-a-date')).toBe('')
  })
})

describe('formatArtists', () => {
  it('joins names and handles empty input', () => {
    expect(formatArtists()).toBe('')
    expect(formatArtists([])).toBe('')
    expect(formatArtists([{ name: 'A' }, { name: 'B' }])).toBe('A / B')
  })
})

describe('getArrLast', () => {
  it('returns the last item or undefined', () => {
    expect(getArrLast([1, 2, 3])).toBe(3)
    expect(getArrLast([])).toBeUndefined()
  })
})

describe('matchesKeyword', () => {
  it('treats an empty keyword as a match and ignores case otherwise', () => {
    expect(matchesKeyword('', 'anything')).toBe(true)
    expect(matchesKeyword('  ', 'anything')).toBe(true)
    expect(matchesKeyword(' hello ', 'Hello World')).toBe(true)
    expect(matchesKeyword('hello', 'goodbye', undefined, 'say HELLO')).toBe(true)
    expect(matchesKeyword('hello', 'goodbye')).toBe(false)
  })
})
