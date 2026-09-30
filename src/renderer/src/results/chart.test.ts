import { describe, expect, it } from 'vitest'
import type { Lab, ResultRow } from '@shared/api'
import type { Comparator } from '@shared/domain/values'
import { buildChartOption, type ChartPalette } from './chart'

const PALETTE: ChartPalette = { text: '#333', grid: '#eee', neutral: '#999' }
const MMOL = 1
const OTHER_UNIT = 2
const KDL: Lab = { id: 1, name: 'KDL', markerColor: '#0072B2', markerShape: 'circle', connectable: true }
const HELIX: Lab = {
  id: 2,
  name: 'Хеликс',
  markerColor: '#D55E00',
  markerShape: 'triangle',
  connectable: false,
}
const LABS = new Map([KDL, HELIX].map((lab) => [lab.id, lab]))

let nextId = 1
function row(
  collectedOn: string,
  value: number,
  options: { lab?: Lab; low?: number; high?: number; comparator?: Comparator; unitId?: number } = {},
): ResultRow {
  const { lab = KDL, low = 3.9, high = 5.5, comparator = null, unitId = MMOL } = options
  const text = String(value).replace('.', ',')
  return {
    id: nextId++,
    orderId: 1,
    analyteId: 1,
    analyteName: 'Глюкоза',
    labId: lab.id,
    collectedOn,
    collectedTime: null,
    rawValue: text,
    reportedUnitId: unitId,
    refRaw: null,
    labFlag: null,
    userEdited: false,
    note: null,
    read: {
      value: { number: { value, text }, comparator, qualitative: null, unitId, inTarget: unitId === MMOL },
      reference: {
        low: { value: low, text: String(low) },
        high: { value: high, text: String(high) },
        expected: null,
        source: 'lab',
        unitId,
        inValueUnit: true,
      },
      deviation: 'normal',
      labDisagrees: false,
    },
  }
}

function build(rows: ResultRow[]) {
  const option = buildChartOption({ rows, labs: LABS, unitLabel: 'ммоль/л', palette: PALETTE })
  const series = (option.series ?? []) as Record<string, unknown>[]
  return { option, series }
}

describe('buildChartOption', () => {
  it('draws one pair of reference lines when every result shares the same norm', () => {
    const { series } = build([row('2025-01-10', 5.1), row('2026-01-10', 5.6)])
    const references = series.filter((s) => s['markLine'])
    expect(references).toHaveLength(1)
    expect((references[0]?.['markLine'] as { data: unknown[] }).data).toEqual([
      { yAxis: 3.9 },
      { yAxis: 5.5 },
    ])
    expect(series.some((s) => s['step'])).toBe(false)
  })

  it("steps each lab's own norm, labeled with the lab, when labs disagree", () => {
    const { series } = build([
      row('2025-01-10', 5.1),
      row('2025-07-01', 5.7, { lab: HELIX, low: 4.1, high: 5.9 }),
      row('2026-01-10', 5.6),
    ])
    const steps = series.filter((s) => s['step'])
    expect(steps).toHaveLength(4)
    const helixHigh = steps.find(
      (s) =>
        (s['endLabel'] as { formatter?: string } | undefined)?.formatter === 'Хеликс' &&
        (s['data'] as unknown[][])[0]?.[1] === 5.9,
    )
    // Helix's line starts at its own result and runs to the chart's last date.
    expect(helixHigh?.['data']).toEqual([
      ['2025-07-01', 5.9],
      ['2026-01-10', 5.9],
    ])
  })

  it('draws a value reported as a bound hollow, with an arrow toward where it lies', () => {
    const { series } = build([row('2025-01-10', 5.1), row('2026-01-10', 0.1, { comparator: '<' })])
    const points = series.find((s) => s['type'] === 'scatter' && s['symbol'] === 'circle')
    expect((points?.['data'] as { symbol: string }[]).map((d) => d.symbol)).toEqual(['circle', 'emptyCircle'])
    const arrows = series.find((s) => s['symbol'] === 'arrow')
    expect(arrows?.['data']).toEqual([
      expect.objectContaining({ value: ['2026-01-10', 0.1], symbolRotate: 180 }),
    ])
  })

  it('leaves out values that could not be brought into the chart unit', () => {
    const { series } = build([row('2025-01-10', 5.1), row('2026-01-10', 31, { unitId: OTHER_UNIT })])
    const trend = series[0]
    expect(trend?.['data']).toEqual([['2025-01-10', 5.1]])
  })
})
