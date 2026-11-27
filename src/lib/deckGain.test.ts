import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckGainMixer } from './deckGain'

function fakeDeck() {
  return { volume: 1 } as HTMLAudioElement
}

describe('DeckGainMixer', () => {
  let a: HTMLAudioElement
  let b: HTMLAudioElement
  let mixer: DeckGainMixer

  beforeEach(() => {
    // The mixer samples ramps against performance.now().
    vi.useFakeTimers({
      toFake: [
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
        'performance',
      ],
    })
    a = fakeDeck()
    b = fakeDeck()
    mixer = new DeckGainMixer(() => [a, b])
  })

  afterEach(() => {
    mixer.destroy()
    vi.useRealTimers()
  })

  it('multiplies master, transport and deck gains', () => {
    mixer.setMaster(0.5, 0)
    mixer.setTransport(0.5)
    mixer.setDeck(a, 0.5)
    expect(a.volume).toBeCloseTo(0.125)
    expect(b.volume).toBeCloseTo(0.25)
  })

  it('keeps constant power through an equal-power crossfade', () => {
    mixer.setDeck(b, 0)
    mixer.rampDeck(a, 0, 1000, 'equal-power')
    mixer.rampDeck(b, 1, 1000, 'equal-power')
    for (let step = 0; step < 10; step += 1) {
      vi.advanceTimersByTime(100)
      expect(a.volume ** 2 + b.volume ** 2).toBeCloseTo(1, 2)
    }
    expect(a.volume).toBe(0)
    expect(b.volume).toBe(1)
  })

  it('starts and ends smooth fades with no jump', () => {
    mixer.rampDeck(a, 0, 200, 'smooth')
    vi.advanceTimersByTime(5)
    expect(1 - a.volume).toBeLessThan(0.01)
    vi.advanceTimersByTime(190)
    expect(a.volume).toBeLessThan(0.01)
    vi.advanceTimersByTime(10)
    expect(a.volume).toBe(0)
  })

  it('runs the callback once the fade has finished', () => {
    const done = vi.fn()
    mixer.rampTransport(0, 100, 'smooth', done)
    vi.advanceTimersByTime(95)
    expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10)
    expect(done).toHaveBeenCalledOnce()
    expect(mixer.transportGain).toBe(0)
  })

  it('drops the callback of a replaced or held fade', () => {
    const first = vi.fn()
    mixer.rampDeck(a, 0, 100, 'smooth', first)
    vi.advanceTimersByTime(50)
    mixer.rampDeck(a, 1, 100)
    vi.advanceTimersByTime(200)
    expect(first).not.toHaveBeenCalled()
    expect(a.volume).toBe(1)

    const held = vi.fn()
    mixer.rampTransport(0, 100, 'linear', held)
    vi.advanceTimersByTime(50)
    mixer.holdTransport()
    vi.advanceTimersByTime(200)
    expect(held).not.toHaveBeenCalled()
    expect(mixer.transportGain).toBeGreaterThan(0.3)
    expect(mixer.transportGain).toBeLessThan(0.7)
  })

  it('continues a fade from its current value', () => {
    mixer.rampTransport(0, 100, 'linear')
    vi.advanceTimersByTime(50)
    const level = mixer.transportGain
    mixer.rampTransport(1, 100, 'linear')
    expect(mixer.transportGain).toBeCloseTo(level)
  })

  it('finishes instantly when there is nothing to fade', () => {
    const done = vi.fn()
    mixer.rampDeck(a, 1, 500, 'smooth', done)
    expect(done).toHaveBeenCalledOnce()
    expect(mixer.busy).toBe(false)
  })
})
