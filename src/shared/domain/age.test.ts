import { describe, expect, it } from 'vitest'
import { ageInYears, ageToDays, daysToAge } from './age'

describe('age', () => {
  it('counts completed years, turning a year older on the birthday', () => {
    expect(ageInYears('1990-05-14', '2026-05-13')).toBe(35)
    expect(ageInYears('1990-05-14', '2026-05-14')).toBe(36)
  })

  it('states rule limits in days and reads them back in the unit they were given in', () => {
    for (const [value, unit] of [
      [18, 'years'],
      [1, 'years'],
      [6, 'months'],
      [1, 'months'],
      [14, 'days'],
      [100, 'days'],
    ] as const) {
      expect(daysToAge(ageToDays(value, unit))).toEqual({ value, unit })
    }
  })
})
