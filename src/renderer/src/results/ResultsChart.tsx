import { useMemo } from 'react'
import { Alert, useComputedColorScheme, useMantineTheme } from '@mantine/core'
import type { Lab, ResultRow } from '@shared/api'
import { plural } from '../format'
import { EChart } from '../components/EChart'
import { buildChartOption, type ChartPalette } from './chart'

const CHART_HEIGHT = 360

export function ResultsChart({
  rows,
  labs,
  unitLabel,
}: {
  rows: ResultRow[]
  labs: ReadonlyMap<number, Lab>
  unitLabel: string
}) {
  const theme = useMantineTheme()
  const scheme = useComputedColorScheme('light')
  const palette: ChartPalette = useMemo(
    () =>
      scheme === 'dark'
        ? { text: theme.colors.dark[1], grid: theme.colors.dark[4], neutral: theme.colors.dark[2] }
        : { text: theme.colors.gray[7], grid: theme.colors.gray[2], neutral: theme.colors.gray[5] },
    [scheme, theme],
  )
  const option = useMemo(
    () => buildChartOption({ rows, labs, unitLabel, palette }),
    [rows, labs, unitLabel, palette],
  )
  const left = rows.filter((row) => row.read.value.number && !row.read.value.inTarget).length

  return (
    <>
      <EChart option={option} height={CHART_HEIGHT} />
      {left > 0 && (
        <Alert color="yellow" variant="light" mt="sm">
          {left} {plural(left, ['значение', 'значения', 'значений'])} в другой единице не{' '}
          {plural(left, ['показано', 'показаны', 'показаны'])} на графике: для пересчёта нужен коэффициент в
          справочнике.
        </Alert>
      )}
    </>
  )
}
