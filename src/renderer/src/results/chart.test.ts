import { describe, expect, it } from 'vitest'
import type { Lab, ResultRow } from '@shared/api'
import type { Comparator } from '@shared/domain/values'
import { buildChartOption, type ChartOption, type ChartPalette } from './chart'

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
  options: {
    lab?: Lab
    low?: number | null
    high?: number | null
    comparator?: Comparator
    unitId?: number
  } = {},
): ResultRow {
  const { lab = KDL, low = 3.9, high = 5.5, comparator = null, unitId = MMOL } = options
  const shown = (n: number) => ({ value: n, text: String(n).replace('.', ',') })
  const text = shown(value).text
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
        low: low === null ? null : shown(low),
        high: high === null ? null : shown(high),
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
  it('draws one pair of norm lines when every result shares the norm, saying which edge each is', () => {
    const { series } = build([row('2025-01-10', 5.1), row('2026-01-10', 5.6)])
    const references = series.filter((s) => s['markLine'])
    expect(references).toHaveLength(1)
    expect((references[0]?.['markLine'] as { data: unknown[] }).data).toEqual([
      { yAxis: 3.9, label: expect.objectContaining({ formatter: 'норма от 3,9' }) },
      { yAxis: 5.5, label: expect.objectContaining({ formatter: 'норма до 5,5' }) },
    ])
    // The axis reaches both edges, though every result lies between them.
    expect(references[0]?.['data']).toEqual([
      ['2025-01-10', 3.9],
      ['2025-01-10', 5.5],
    ])
    expect(series.some((s) => s['step'])).toBe(false)
  })

  it('draws no line at a lower bound of zero, which rules nothing out', () => {
    const { series } = build([
      row('2025-01-10', 60, { low: 0, high: 55 }),
      row('2026-01-10', 40, { low: null, high: 55 }),
    ])
    // "0–55" and "< 55" are one norm, not a changed one.
    expect(series.some((s) => s['step'])).toBe(false)
    const markLine = series.find((s) => s['markLine'])?.['markLine'] as { data: unknown[] }
    expect(markLine.data).toEqual([
      { yAxis: 55, label: expect.objectContaining({ formatter: 'норма до 55' }) },
    ])
  })

  it('names the edge a changed norm ends at', () => {
    const { series } = build([row('2025-01-10', 5.1), row('2026-01-10', 5.6, { high: 6.1 })])
    const labels = series
      .filter((s) => s['step'])
      .map((s) => (s['endLabel'] as { formatter: string }).formatter)
    expect(labels).toEqual(['норма от 3,9', 'норма до 6,1'])
  })

  it("steps each lab's own norm, labeled with the lab and the edge, when labs disagree", () => {
    const { series } = build([
      row('2025-01-10', 5.1),
      row('2025-07-01', 5.7, { lab: HELIX, low: 4.1, high: 5.9 }),
      row('2026-01-10', 5.6),
    ])
    const steps = series.filter((s) => s['step'])
    expect(steps).toHaveLength(4)
    const helixHigh = steps.find(
      (s) =>
        (s['endLabel'] as { formatter?: string } | undefined)?.formatter === 'Хеликс: до 5,9' &&
        (s['data'] as unknown[][])[0]?.[1] === 5.9,
    )
    // Helix's line starts at its own result and runs to the chart's last date.
    expect(helixHigh?.['data']).toEqual([
      ['2025-07-01', 5.9],
      ['2026-01-10', 5.9],
    ])
  })

  it('keeps room on the right only for labels ending stepped norm lines', () => {
    const right = (option: ChartOption) => (option.grid as { right: number }).right
    const plain = build([row('2025-01-10', 5.1), row('2026-01-10', 5.6)]).option
    const labeled = build([
      row('2025-01-10', 5.1),
      row('2025-07-01', 5.7, { lab: HELIX, low: 4.1, high: 5.9 }),
    ]).option
    expect(right(labeled)).toBeGreaterThan(right(plain))
  })

  it("titles the chart's tools in the theme's text color", () => {
    const { option } = build([row('2025-01-10', 5.1)])
    const tools = (option.toolbox as { feature: Record<string, { emphasis: unknown }> }).feature
    for (const tool of Object.values(tools)) {
      expect(tool.emphasis).toEqual({ iconStyle: { textFill: PALETTE.text } })
    }
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
