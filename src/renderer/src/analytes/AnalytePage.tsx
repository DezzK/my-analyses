import { useMemo, useState } from 'react'
import {
  Badge,
  Card,
  Center,
  Chip,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { IconChartLine, IconTable } from '@tabler/icons-react'
import { useParams } from '@tanstack/react-router'
import type { AnalyteResults, Lab, Unit } from '@shared/api'
import { api } from '../api'
import { EmptyState } from '../components/EmptyState'
import { LabMarker } from '../components/LabMarker'
import { PageHeader } from '../components/PageHeader'
import { SPECIMEN_LABELS } from '../labels'
import { notifyError } from '../notify'
import { useCurrentPatient } from '../patients/current'
import { useAnalyteResults, useLabMap, useUnits } from '../queries'
import { unitText } from '../results/format'
import { ResultsChart } from '../results/ResultsChart'
import { ResultsTable } from '../results/ResultsTable'
import { PERIOD_LABELS, periodStart, PERIODS, type Period } from './periods'
import { ICON_SIZE } from '../theme'

type View = 'table' | 'chart'
const VIEW_KEY = 'my-analyses:analyte-view'
const PERIOD_KEY = 'my-analyses:analyte-period'

export function AnalytePage() {
  const { analyteId } = useParams({ from: '/analytes/$analyteId' })
  const { patient } = useCurrentPatient()
  const { data, isLoading } = useAnalyteResults(Number(analyteId), patient?.id ?? null)
  const labs = useLabMap()
  const units = useUnits()

  if (isLoading || !data || !patient) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }
  return <AnalyteView data={data} labs={labs} units={units} patientName={patient.title} />
}

function AnalyteView({
  data,
  labs,
  units,
  patientName,
}: {
  data: AnalyteResults
  labs: ReadonlyMap<number, Lab>
  units: ReadonlyMap<number, Unit>
  patientName: string
}) {
  const [view, setView] = useLocalStorage<View>({ key: VIEW_KEY, defaultValue: 'table' })
  const [period, setPeriod] = useLocalStorage<Period>({ key: PERIOD_KEY, defaultValue: 'all' })
  const presentLabs = useMemo(() => [...new Set(data.rows.map((row) => row.labId))], [data.rows])
  const [hiddenLabs, setHiddenLabs] = useState<number[]>([])

  const start = periodStart(period)
  const rows = data.rows.filter(
    (row) => (start === null || row.collectedOn >= start) && !hiddenLabs.includes(row.labId),
  )
  const plottable = rows.some((row) => row.read.value.number !== null)
  const shownView: View = plottable ? view : 'table'
  const { analyte } = data

  return (
    <>
      <PageHeader
        title={
          <Group gap="sm">
            {analyte.name}
            {analyte.specimen && (
              <Badge variant="light" color="gray" size="lg">
                {SPECIMEN_LABELS[analyte.specimen]}
              </Badge>
            )}
            {!analyte.reviewed && (
              <Badge variant="light" color="yellow" size="lg">
                не проверен
              </Badge>
            )}
          </Group>
        }
        subtitle={<AliasLine data={data} labs={labs} />}
        actions={<UnitSwitch data={data} units={units} />}
      />
      {data.rows.length === 0 ? (
        <EmptyState
          icon={IconTable}
          title="Результатов пока нет"
          description={`У пациента «${patientName}» нет результатов по этому показателю.`}
        />
      ) : (
        <Card>
          <Stack gap="md">
            <Group justify="space-between">
              <Group gap="sm">
                <SegmentedControl
                  value={period}
                  onChange={(value) => setPeriod(value as Period)}
                  data={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
                />
                {presentLabs.length > 1 && (
                  <Chip.Group
                    multiple
                    value={presentLabs.filter((id) => !hiddenLabs.includes(id)).map(String)}
                    onChange={(shown) =>
                      setHiddenLabs(presentLabs.filter((id) => !shown.includes(String(id))))
                    }
                  >
                    <Group gap={6}>
                      {presentLabs.map((id) => {
                        const lab = labs.get(id)
                        return (
                          <Chip key={id} value={String(id)} size="sm" variant="outline">
                            <Group gap={6} wrap="nowrap">
                              {lab && <LabMarker color={lab.markerColor} shape={lab.markerShape} />}
                              {lab?.name}
                            </Group>
                          </Chip>
                        )
                      })}
                    </Group>
                  </Chip.Group>
                )}
              </Group>
              <SegmentedControl
                value={shownView}
                onChange={(value) => setView(value as View)}
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
                    disabled: !plottable,
                    label: (
                      <Group gap={6} wrap="nowrap">
                        <IconChartLine size={ICON_SIZE.button} />
                        График
                      </Group>
                    ),
                  },
                ]}
              />
            </Group>
            {rows.length === 0 ? (
              <Text c="dimmed" size="sm">
                За выбранный период результатов нет.
              </Text>
            ) : shownView === 'chart' ? (
              <ResultsChart rows={rows} labs={labs} unitLabel={unitText(data.unitId, units)} />
            ) : (
              <ResultsTable rows={rows} by="date" labs={labs} units={units} />
            )}
          </Stack>
        </Card>
      )}
    </>
  )
}

/** Other names of the analyte and the lab codes it is imported by. */
function AliasLine({ data, labs }: { data: AnalyteResults; labs: ReadonlyMap<number, Lab> }) {
  const { name, aliases } = data.analyte
  const synonyms = [...new Set(aliases.map((a) => a.alias).filter((alias) => alias !== name))]
  const codes = aliases.flatMap((a) =>
    a.labCode ? [`${labs.get(a.labId ?? -1)?.name ?? ''} ${a.labCode}`.trim()] : [],
  )
  const parts = [
    synonyms.length > 0 && `Синонимы: ${synonyms.join(', ')}`,
    codes.length > 0 && `Код: ${codes.join(', ')}`,
  ]
  const text = parts.filter(Boolean).join(' · ')
  return text || null
}

function UnitSwitch({ data, units }: { data: AnalyteResults; units: ReadonlyMap<number, Unit> }) {
  if (data.units.length < 2) return null
  return (
    <Select
      aria-label="Единица"
      w={200}
      allowDeselect={false}
      value={data.unitId === null ? null : String(data.unitId)}
      data={data.units.map((option) => ({
        value: String(option.id),
        label: `${unitText(option.id, units)}${option.convertible ? '' : ' (не все значения)'}`,
      }))}
      onChange={(value) => {
        if (value) api.analytes.setDisplayUnit(data.analyte.id, Number(value)).catch(notifyError)
      }}
    />
  )
}
