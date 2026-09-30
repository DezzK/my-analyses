import { describe, expect, it } from 'vitest'
import type { ReportBlock } from '@shared/api'
import { rowsOf } from './rows'

const chart = (analyteId: number, breakAfter = false): ReportBlock => ({
  analyteId,
  view: 'chart',
  breakAfter,
})
const table = (analyteId: number): ReportBlock => ({ analyteId, view: 'table', breakAfter: false })
const both = (analyteId: number): ReportBlock => ({ analyteId, view: 'both', breakAfter: false })
const ids = (rows: ReportBlock[][]) => rows.map((row) => row.map((block) => block.analyteId))

describe('report rows', () => {
  it('puts one block to a row when the layout has one chart to a row', () => {
    expect(ids(rowsOf([chart(1), chart(2)], 1))).toEqual([[1], [2]])
  })

  it('pairs consecutive charts, and nothing else', () => {
    expect(ids(rowsOf([chart(1), chart(2), chart(3)], 2))).toEqual([[1, 2], [3]])
    expect(ids(rowsOf([chart(1), table(2), chart(3), both(4), chart(5), chart(6)], 2))).toEqual([
      [1],
      [2],
      [3],
      [4],
      [5, 6],
    ])
  })

  it('ends a row at a page break', () => {
    expect(ids(rowsOf([chart(1, true), chart(2), chart(3)], 2))).toEqual([[1], [2, 3]])
  })
})
