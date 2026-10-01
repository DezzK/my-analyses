import { describe, expect, it } from 'vitest'
import { DEFAULT_REPORT_LAYOUT } from '@shared/report'
import { withAnalytes, type ReportDraft } from './draft'

const draft = (...analyteIds: number[]): ReportDraft => ({
  blocks: analyteIds.map((analyteId) => ({ analyteId, view: 'both', breakAfter: false })),
  layout: DEFAULT_REPORT_LAYOUT,
  period: 'all',
})

describe('withAnalytes', () => {
  it('adds analytes at the end in their order, leaving ones already there where they are', () => {
    const before = {
      ...draft(1, 2),
      blocks: [{ analyteId: 1, view: 'table' as const, breakAfter: true }, ...draft(2).blocks],
    }
    expect(withAnalytes(before, [3, 1, 4, 3]).blocks).toEqual([...before.blocks, ...draft(3, 4).blocks])
    expect(withAnalytes(before, [2, 1])).toBe(before)
  })
})
