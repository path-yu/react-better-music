import { describe, expect, it } from 'vitest'
import { layoutSprites, stepRotations, type Rotations } from './appleBackdropMotion'

const zero: Rotations = [0, 0, 0, 0]

describe('apple backdrop motion', () => {
  it('spins each cover at Apple Music\'s rate', () => {
    expect(stepRotations(zero, 1, false)).toEqual([0.003, -0.008, -0.006, 0.004])
    // A 15 fps tick covers two 30 fps frames.
    const [a, b] = stepRotations(zero, 2, false)
    expect(a).toBeCloseTo(0.006)
    expect(b).toBeCloseTo(-0.016)
  })

  it('slows every cover to the same gentle drift with reduced motion', () => {
    expect(stepRotations(zero, 1, true)).toEqual([0.001, 0.001, 0.001, 0.001])
  })

  it('lays out a landscape canvas exactly like Apple (sizes from the width)', () => {
    const [big, mid, orbitA, orbitB] = layoutSprites(1600, 800, zero)
    expect(big).toEqual({ x: 800, y: 400, size: 2000, rotation: 0 })
    expect(mid).toMatchObject({ x: 640, y: 320, size: 1280 })
    expect(orbitA).toMatchObject({ x: 800 + 400, y: 400, size: 800 })
    expect(orbitB).toMatchObject({ x: 800 + 80 + 400, y: 400 + 80, size: 400 })
  })

  it('sizes a portrait canvas from its height so the covers fill it', () => {
    const [big] = layoutSprites(400, 900, zero)
    expect(big.size).toBeGreaterThanOrEqual(900)
  })
})
