import type { LineSeriesOption, ScatterSeriesOption } from 'echarts/charts'
import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  ToolboxComponentOption,
  TooltipComponentOption,
} from 'echarts/components'
import type { ComposeOption } from 'echarts/core'
import type { Lab, ResultRow } from '@shared/api'
import { todayIso } from '@shared/domain/dates'
import { formatNumber } from '@shared/domain/numbers'
import { isUpperBound } from '@shared/domain/values'
import { formatDate } from '../format'
import { referenceText, valueText } from './format'

export type ChartOption = ComposeOption<
  | LineSeriesOption
  | ScatterSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DataZoomComponentOption
  | ToolboxComponentOption
>

/** Colors that follow the light or dark theme; labs keep their own marker colors. */
export interface ChartPalette {
  text: string
  grid: string
  neutral: string
}

const MARKER_SIZE = 10
const ARROW_SIZE: [number, number] = [7, 8]
/** How far a censored value's arrow sits from its marker, in pixels. */
const ARROW_OFFSET = 11
const ARROW_DOWN_DEGREES = 180

/** A point the chart can place: a numeric value in the unit the chart is drawn in. */
function plotted(row: ResultRow): number | null {
  const { number, inTarget } = row.read.value
  return number && inTarget ? number.value : null
}

/** ECharts spells the hollow variant of a symbol `emptyCircle`, `emptyDiamond`, … */
function hollow(shape: string): string {
  return `empty${shape.charAt(0).toUpperCase()}${shape.slice(1)}`
}

function dateLabel(epochMs: number): string {
  return formatDate(todayIso(new Date(epochMs)))
}

interface Bounds {
  date: string
  low: number | null
  high: number | null
}

function boundsOf(row: ResultRow): Bounds | null {
  const reference = row.read.reference
  if (!reference?.inValueUnit || !row.read.value.inTarget) return null
  const low = reference.low?.value ?? null
  const high = reference.high?.value ?? null
  return low === null && high === null ? null : { date: row.collectedOn, low, high }
}

const sameBounds = (a: Bounds, b: Bounds) => a.low === b.low && a.high === b.high

/**
 * Reference lines: one pair of dashed lines when every result shares the same bounds; else a
 * stepped pair per lab, labeled with the lab's name, that changes where its reference changed.
 */
function referenceSeries(
  rows: readonly ResultRow[],
  labs: ReadonlyMap<number, Lab>,
  palette: ChartPalette,
  lastDate: string,
): LineSeriesOption[] {
  const bounds = rows.flatMap((row) => {
    const b = boundsOf(row)
    return b ? [{ row, b }] : []
  })
  const first = bounds[0]
  if (!first) return []
  const dashed = (color: string) => ({ type: 'dashed' as const, color, width: 1 })

  if (bounds.every(({ b }) => sameBounds(b, first.b))) {
    const lines = [first.b.low, first.b.high].filter((v): v is number => v !== null)
    return [
      {
        type: 'line',
        data: [],
        silent: true,
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: dashed(palette.neutral),
          data: lines.map((yAxis) => ({ yAxis })),
        },
      },
    ]
  }

  const byLab = Map.groupBy(bounds, ({ row }) => row.labId)
  const labeled = byLab.size > 1
  return [...byLab].flatMap(([labId, items]) => {
    const lab = labs.get(labId)
    const color = lab?.markerColor ?? palette.neutral
    const steps = items.map(({ b }) => b).sort((a, b) => a.date.localeCompare(b.date))
    const last = steps.at(-1)
    if (last && last.date < lastDate) steps.push({ ...last, date: lastDate })
    return (['low', 'high'] as const).flatMap((edge): LineSeriesOption[] => {
      if (steps.every((s) => s[edge] === null)) return []
      return [
        {
          type: 'line',
          step: 'end',
          silent: true,
          symbol: 'none',
          lineStyle: dashed(color),
          data: steps.map((s) => [s.date, s[edge]]),
          endLabel: labeled ? { show: true, formatter: lab?.name ?? '', color } : undefined,
        },
      ]
    })
  })
}

/**
 * The chart of one analyte over time: a point per numeric result in the lab's color and shape,
 * values reported as a bound ("<0,1") hollow with an arrow, a thin trend line and the
 * reference lines. Values not in the chart's unit are left out; the caller says so.
 */
export function buildChartOption(input: {
  rows: readonly ResultRow[]
  labs: ReadonlyMap<number, Lab>
  unitLabel: string
  palette: ChartPalette
}): ChartOption {
  const { labs, unitLabel, palette } = input
  const rows = input.rows
    .filter((row) => plotted(row) !== null)
    .sort((a, b) => a.collectedOn.localeCompare(b.collectedOn))
  const byId = new Map(rows.map((row) => [row.id, row]))
  const lastDate = rows.at(-1)?.collectedOn ?? ''

  const points: ScatterSeriesOption[] = [...Map.groupBy(rows, (row) => row.labId)].flatMap(
    ([labId, labRows]) => {
      const lab = labs.get(labId)
      const shape = lab?.markerShape ?? 'circle'
      const color = lab?.markerColor ?? palette.neutral
      const name = lab?.name ?? ''
      const censored = labRows.filter((row) => row.read.value.comparator !== null)
      const series: ScatterSeriesOption[] = [
        {
          type: 'scatter',
          name,
          // The series' own symbol is what the legend shows for the lab.
          symbol: shape,
          symbolSize: MARKER_SIZE,
          itemStyle: { color },
          z: 3,
          data: labRows.map((row) => ({
            value: [row.collectedOn, plotted(row)],
            symbol: row.read.value.comparator ? hollow(shape) : shape,
            id: String(row.id),
          })),
        },
      ]
      if (censored.length > 0) {
        series.push({
          type: 'scatter',
          name,
          silent: true,
          symbol: 'arrow',
          symbolSize: ARROW_SIZE,
          itemStyle: { color },
          z: 3,
          tooltip: { show: false },
          data: censored.map((row) => {
            const down = isUpperBound(row.read.value.comparator ?? '<')
            return {
              value: [row.collectedOn, plotted(row)],
              symbolRotate: down ? ARROW_DOWN_DEGREES : 0,
              symbolOffset: [0, down ? ARROW_OFFSET : -ARROW_OFFSET],
            }
          }),
        })
      }
      return series
    },
  )

  const trend: LineSeriesOption = {
    type: 'line',
    silent: true,
    symbol: 'none',
    z: 1,
    lineStyle: { color: palette.neutral, width: 1, opacity: 0.6 },
    data: rows.map((row) => [row.collectedOn, plotted(row)]),
  }

  return {
    animation: false,
    textStyle: { color: palette.text },
    grid: { left: 56, right: 96, top: 40, bottom: 56 },
    legend: {
      bottom: 0,
      textStyle: { color: palette.text },
      data: [...new Set(rows.map((row) => labs.get(row.labId)?.name ?? ''))],
    },
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params
        const row = byId.get(Number((item?.data as { id?: string } | undefined)?.id))
        if (!row) return ''
        const unit = unitLabel ? ` ${unitLabel}` : ''
        return [
          formatDate(row.collectedOn),
          `<b>${valueText(row)}${unit}</b>`,
          labs.get(row.labId)?.name ?? '',
          `Референс: ${referenceText(row.read.reference)}`,
        ].join('<br/>')
      },
    },
    xAxis: {
      type: 'time',
      axisLabel: { color: palette.text, formatter: (value: number) => dateLabel(value), hideOverlap: true },
      splitLine: { show: false },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: {
      type: 'value',
      name: unitLabel,
      scale: true,
      nameTextStyle: { color: palette.text },
      axisLabel: { color: palette.text, formatter: (value: number) => formatNumber(value) },
      splitLine: { lineStyle: { color: palette.grid } },
    },
    toolbox: {
      right: 8,
      iconStyle: { borderColor: palette.text },
      feature: {
        dataZoom: { yAxisIndex: 'none', title: { zoom: 'Выделить период', back: 'Назад' } },
        restore: { title: 'Сбросить' },
      },
    },
    dataZoom: [{ type: 'inside', filterMode: 'none' }],
    series: [trend, ...points, ...referenceSeries(rows, labs, palette, lastDate)],
  }
}
