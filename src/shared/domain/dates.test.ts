import { describe, expect, it } from 'vitest'
import { formatDateRu, isoFromDateRu, isoFromLabDate } from './dates'

describe('isoFromDateRu', () => {
  it('reads back what formatDateRu writes, with or without a time after it', () => {
    expect(isoFromDateRu(formatDateRu('2026-07-15'))).toBe('2026-07-15')
    expect(isoFromDateRu(' 15.07.2026 09:41:12 ')).toBe('2026-07-15')
  })

  it('refuses what is not a real date written that way', () => {
    expect(isoFromDateRu('31.02.2026')).toBeNull()
    expect(isoFromDateRu('15.07.20261')).toBeNull()
    expect(isoFromDateRu('2026-07-15')).toBeNull()
    expect(isoFromDateRu('')).toBeNull()
  })
})

describe('isoFromLabDate', () => {
  it('reads a date written either way labs write them', () => {
    expect(isoFromLabDate('2015-03-01T00:00:00')).toBe('2015-03-01')
    expect(isoFromLabDate('2015-03-01')).toBe('2015-03-01')
    expect(isoFromLabDate('01.03.2015')).toBe('2015-03-01')
    expect(isoFromLabDate('2015-02-30')).toBeNull()
    expect(isoFromLabDate('1 марта 2015')).toBeNull()
  })
})
