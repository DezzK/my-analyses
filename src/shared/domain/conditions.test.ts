import { describe, expect, it } from 'vitest'
import { conditionsOn, trimesterCondition } from './conditions'

describe('trimesterCondition', () => {
  it.each([
    ['2026-03-31', 'pregnancy_t1'], // 12 weeks
    ['2026-04-08', 'pregnancy_t1'], // 13 weeks 6 days
    ['2026-04-09', 'pregnancy_t2'], // 14 weeks
    ['2026-07-15', 'pregnancy_t2'], // 27 weeks 6 days
    ['2026-07-16', 'pregnancy_t3'], // 28 weeks
  ])('on %s it is %s', (date, condition) => {
    expect(trimesterCondition('2026-01-01', date)).toBe(condition)
  })
})

describe('conditionsOn', () => {
  const pregnancy = { kind: 'pregnancy' as const, startDate: '2026-01-01', endDate: '2026-09-20' }
  const menopause = { kind: 'menopause' as const, startDate: '2030-01-01', endDate: null }

  it('takes the trimester from a pregnancy that covers the date', () => {
    expect(conditionsOn('2026-05-01', [pregnancy], null)).toEqual(new Set(['pregnancy_t2']))
    expect(conditionsOn('2026-10-01', [pregnancy], null)).toEqual(new Set())
  })

  it('adds postmenopause from its start on', () => {
    expect(conditionsOn('2029-12-31', [menopause], null)).toEqual(new Set())
    expect(conditionsOn('2031-01-01', [menopause], null)).toEqual(new Set(['postmenopause']))
  })

  it("adds the order's cycle phase", () => {
    expect(conditionsOn('2025-01-01', [], 'luteal')).toEqual(new Set(['phase_luteal']))
  })
})
