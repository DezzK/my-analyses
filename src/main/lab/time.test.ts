import { describe, expect, it } from 'vitest'
import { moscowDate } from './time'

describe('moscowDate', () => {
  it('dates midnight in Moscow, which is still the previous day in UTC', () => {
    // 2026-07-14T21:00:00Z is 2026-07-15 00:00 in Moscow; KDL sends exactly this for 15.07.2026.
    expect(moscowDate(1784062800)).toBe('2026-07-15')
  })

  it('keeps an afternoon on its own day', () => {
    expect(moscowDate(Date.UTC(2026, 0, 15, 12) / 1000)).toBe('2026-01-15')
  })
})
