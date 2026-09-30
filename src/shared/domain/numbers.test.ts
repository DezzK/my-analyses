import { describe, expect, it } from 'vitest'
import { formatDecimal, formatSignificant, parseDecimal, roundSignificant } from './numbers'

describe('parseDecimal', () => {
  it.each([
    ['5.40', { value: 5.4, decimals: 2, sigDigits: 3 }],
    ['5,4', { value: 5.4, decimals: 1, sigDigits: 2 }],
    ['0.050', { value: 0.05, decimals: 3, sigDigits: 2 }],
    ['120', { value: 120, decimals: 0, sigDigits: 3 }],
    ['-1.5', { value: -1.5, decimals: 1, sigDigits: 2 }],
    ['0', { value: 0, decimals: 0, sigDigits: 1 }],
    [' 7 ', { value: 7, decimals: 0, sigDigits: 1 }],
    ['2 000', { value: 2000, decimals: 0, sigDigits: 4 }],
    ['12\u00a0500,5', { value: 12500.5, decimals: 1, sigDigits: 6 }],
  ])('reads %s with its precision', (text, expected) => {
    expect(parseDecimal(text)).toEqual(expected)
  })

  it.each(['abc', '1.2.3', '', '5 мг', '1:160', '20 00', '2 0000', '5 10'])('rejects %s', (text) => {
    expect(parseDecimal(text)).toBeNull()
  })
})

describe('significant digits', () => {
  it('rounds to a number of significant digits', () => {
    expect(roundSignificant(97.2888, 2)).toBe(97)
    expect(roundSignificant(0.012345, 3)).toBe(0.0123)
    expect(roundSignificant(123456, 2)).toBe(120000)
  })

  it('prints a converted value with the precision of its source', () => {
    expect(formatSignificant(97.2888, 2)).toBe('97')
    expect(formatSignificant(0.0123456, 3)).toBe('0,0123')
    expect(formatSignificant(5.4, 3)).toBe('5,40')
  })

  it('prints fixed decimals with a comma and no grouping', () => {
    expect(formatDecimal(5.4, 2)).toBe('5,40')
    expect(formatDecimal(1234.5, 1)).toBe('1234,5')
  })
})
