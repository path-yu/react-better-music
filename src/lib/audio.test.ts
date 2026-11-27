import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  playheadTime,
  registerAudio,
  seekAudio,
  seekElement,
  setSeekInterceptor,
} from './audio'

function fakeAudio(currentTime = 10) {
  return { currentTime } as HTMLAudioElement
}

describe('seekElement', () => {
  afterEach(() => {
    setSeekInterceptor(null)
    registerAudio(null)
  })

  it('moves the playhead directly without an interceptor', () => {
    const audio = fakeAudio()
    seekElement(audio, 42)
    expect(audio.currentTime).toBe(42)
    seekElement(audio, -5)
    expect(audio.currentTime).toBe(0)
    seekElement(audio, Number.NaN)
    expect(audio.currentTime).toBe(0)
  })

  it('lets the interceptor take over and report its pending target', () => {
    const audio = fakeAudio()
    let pending: number | null = null
    const seek = vi.fn((_element: HTMLAudioElement, seconds: number) => {
      pending = seconds
      return true
    })
    setSeekInterceptor({ seek, pendingTarget: () => pending })
    registerAudio(audio)
    seekAudio(30)
    expect(seek).toHaveBeenCalledWith(audio, 30)
    // Not applied yet, but relative seeks chain from the target.
    expect(audio.currentTime).toBe(10)
    expect(playheadTime(audio)).toBe(30)
  })

  it('falls back to a direct seek when the interceptor declines', () => {
    const audio = fakeAudio()
    setSeekInterceptor({ seek: () => false, pendingTarget: () => null })
    seekElement(audio, 3)
    expect(audio.currentTime).toBe(3)
    expect(playheadTime(audio)).toBe(3)
  })
})
