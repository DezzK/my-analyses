import { Group, SegmentedControl, Text } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { IconChartLine, IconTable } from '@tabler/icons-react'
import type { Lab, ResultRow, Unit } from '@shared/api'
import { PERIOD_LABELS, PERIODS, type Period } from '../analytes/periods'
import { ICON_SIZE } from '../theme'
import { unitText } from './format'
import { ResultsChart } from './ResultsChart'
import { ResultsTable } from './ResultsTable'
import { isPlottable } from './shown'

/** How the results of a page are shown: one table or one chart per analyte. */
export type ResultsLook = 'table' | 'chart'

/** The look and the period last chosen, kept for every page of results. */
const LOOK_KEY = 'my-analyses:analyte-view'
const PERIOD_KEY = 'my-analyses:analyte-period'

export function useResultsLook() {
  return useLocalStorage<ResultsLook>({ key: LOOK_KEY, defaultValue: 'table' })
}

export function useResultsPeriod() {
  return useLocalStorage<Period>({ key: PERIOD_KEY, defaultValue: 'all' })
}

export function PeriodSwitch({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <SegmentedControl
      value={value}
      onChange={(period) => onChange(period as Period)}
      data={PERIODS.map((period) => ({ value: period, label: PERIOD_LABELS[period] }))}
    />
  )
}

export function LookSwitch({
  value,
  onChange,
  chartDisabled = false,
}: {
  value: ResultsLook
  onChange: (look: ResultsLook) => void
  chartDisabled?: boolean
}) {
  return (
    <SegmentedControl
      value={value}
      onChange={(look) => onChange(look as ResultsLook)}
      data={[
        {
          value: 'table',
          label: (
            <Group gap={6} wrap="nowrap">
              <IconTable size={ICON_SIZE.button} />
              Таблица
            </Group>
          ),
        },
        {
          value: 'chart',
          disabled: chartDisabled,
          label: (
            <Group gap={6} wrap="nowrap">
              <IconChartLine size={ICON_SIZE.button} />
              График
            </Group>
          ),
        },
      ]}
    />
  )
}

/**
 * An analyte's results as its chart or its table. Results with no numbers to plot keep to the
 * table whatever the look; none at all leave `empty` in their place.
 */
export function ResultsView({
  rows,
  look,
  unitId,
  labs,
  units,
  empty,
}: {
  rows: ResultRow[]
  look: ResultsLook
  unitId: number | null
  labs: ReadonlyMap<number, Lab>
  units: ReadonlyMap<number, Unit>
  empty: string
}) {
  if (rows.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {empty}
      </Text>
    )
  }
  return look === 'chart' && isPlottable(rows) ? (
    <ResultsChart rows={rows} labs={labs} unitLabel={unitText(unitId, units)} />
  ) : (
    <ResultsTable rows={rows} by="date" labs={labs} units={units} />
  )
}
