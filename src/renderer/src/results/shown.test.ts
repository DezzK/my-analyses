import { describe, expect, it } from 'vitest'
import type { ResultRow } from '@shared/api'
import { collectedBetween, isPlottable } from './shown'

const on = (collectedOn: string) => ({ collectedOn })
const valued = (number: number | null) => ({ read: { value: { number } } }) as Pick<ResultRow, 'read'>

describe('collectedBetween', () => {
  it('keeps the results of the days between the two, both included, and is open where one is null', () => {
    const rows = [on('2026-01-01'), on('2026-02-01'), on('2026-03-01')]
    expect(collectedBetween(rows, '2026-02-01', '2026-03-01')).toEqual([on('2026-02-01'), on('2026-03-01')])
    expect(collectedBetween(rows, null, '2026-02-01')).toEqual([on('2026-01-01'), on('2026-02-01')])
    expect(collectedBetween(rows, '2026-02-02')).toEqual([on('2026-03-01')])
    expect(collectedBetween(rows, null)).toEqual(rows)
  })
})

describe('isPlottable', () => {
  it('needs one number among the results', () => {
    expect(isPlottable([valued(null), valued(5.4)])).toBe(true)
    expect(isPlottable([valued(null)])).toBe(false)
    expect(isPlottable([])).toBe(false)
  })
})
