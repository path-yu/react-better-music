import { describe, expect, it } from 'vitest'
import { resizedImageUrl } from './image'

describe('resizedImageUrl', () => {
  it('appends a CDN resize hint', () => {
    expect(resizedImageUrl('https://p1.music.126.net/a.jpg', '300y300')).toBe(
      'https://p1.music.126.net/a.jpg?param=300y300',
    )
  })

  it('appends with & when the URL already has a query', () => {
    expect(resizedImageUrl('https://p1.music.126.net/a.jpg?v=1', '300y300')).toBe(
      'https://p1.music.126.net/a.jpg?v=1&param=300y300',
    )
  })

  it('keeps an existing param and ignores non-CDN urls', () => {
    expect(
      resizedImageUrl('https://p1.music.126.net/a.jpg?param=64y64', '300y300'),
    ).toBe('https://p1.music.126.net/a.jpg?param=64y64')
    expect(resizedImageUrl('https://example.com/a.jpg', '300y300')).toBe(
      'https://example.com/a.jpg',
    )
    expect(resizedImageUrl('data:image/png;base64,xxx', '300y300')).toBe(
      'data:image/png;base64,xxx',
    )
  })

  it('returns empty values untouched', () => {
    expect(resizedImageUrl(null, '300y300')).toBeNull()
    expect(resizedImageUrl('https://p1.music.126.net/a.jpg')).toBe(
      'https://p1.music.126.net/a.jpg',
    )
  })

  it('upgrades CDN http urls to https', () => {
    expect(resizedImageUrl('http://p1.music.126.net/a.jpg', '300y300')).toBe(
      'https://p1.music.126.net/a.jpg?param=300y300',
    )
    expect(resizedImageUrl('http://p1.music.126.net/a.jpg')).toBe(
      'https://p1.music.126.net/a.jpg',
    )
  })
})
