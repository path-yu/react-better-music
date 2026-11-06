import { describe, expect, it } from 'vitest'
import { mostRecentDailyReset, msUntilNextDailyReset } from './daily'

const at = (iso: string) => Date.parse(iso)

describe('daily recommendation reset', () => {
  it('rolls over at 06:00 Beijing time, not local midnight', () => {
    const before = mostRecentDailyReset(at('2026-11-05T05:59:00+08:00'))
    expect(new Date(before).toISOString()).toBe('2026-11-03T22:00:00.000Z')

    const atReset = mostRecentDailyReset(at('2026-11-05T06:00:00+08:00'))
    expect(new Date(atReset).toISOString()).toBe('2026-11-04T22:00:00.000Z')
  })

  it('counts down to 06:00 and then a full day', () => {
    expect(msUntilNextDailyReset(at('2026-11-05T05:59:00+08:00'))).toBe(
      60_000,
    )
    expect(msUntilNextDailyReset(at('2026-11-05T06:00:00+08:00'))).toBe(
      86_400_000,
    )
  })

  it('is independent of the host timezone', () => {
    // Same instant, expressed in UTC rather than +08:00.
    const instant = Date.UTC(2026, 10, 4, 21, 59, 0)
    expect(msUntilNextDailyReset(instant)).toBe(60_000)
  })
})
