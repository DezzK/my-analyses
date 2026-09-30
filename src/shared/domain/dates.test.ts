import { describe, expect, it } from 'vitest'
import { formatDateRu, isoFromDateRu } from './dates'

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
