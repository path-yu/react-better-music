import { describe, expect, it } from 'vitest'
import { classifySwipe, classifyWheel, stepTab } from './useSwipeNavigation'

describe('swipe navigation', () => {
  it('turns a quick horizontal swipe into a tab step', () => {
    expect(classifySwipe(-80, 10, 200)).toBe(1)
    expect(classifySwipe(80, -10, 200)).toBe(-1)
  })

  it('ignores short, slow or mostly vertical movement', () => {
    expect(classifySwipe(-40, 0, 200)).toBe(0)
    expect(classifySwipe(-120, 0, 1200)).toBe(0)
    expect(classifySwipe(-80, 70, 200)).toBe(0)
  })

  it('needs enough trackpad travel', () => {
    expect(classifyWheel(60)).toBe(0)
    expect(classifyWheel(120)).toBe(1)
    expect(classifyWheel(-120)).toBe(-1)
  })

  it('steps between neighbours and stops at both ends', () => {
    const order = ['song', 'lyrics', 'queue'] as const
    expect(stepTab(order, 'song', 1)).toBe('lyrics')
    expect(stepTab(order, 'lyrics', -1)).toBe('song')
    expect(stepTab(order, 'song', -1)).toBe('song')
    expect(stepTab(order, 'queue', 1)).toBe('queue')
  })
})
