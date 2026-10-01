import { useMemo, useState } from 'react'
import { Badge, Button, Card, Center, Chip, Group, Loader, Select, Stack } from '@mantine/core'
import { IconFileText, IconTable } from '@tabler/icons-react'
import { useNavigate, useParams } from '@tanstack/react-router'
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
import {
  LookSwitch,
  PeriodSwitch,
  ResultsView,
  useResultsLook,
  useResultsPeriod,
} from '../results/ResultsView'
import { collectedBetween, isPlottable } from '../results/shown'
import { useReportDraft, withAnalytes } from '../reports/draft'
import { ICON_SIZE } from '../theme'
import { periodStart } from './periods'

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
  const [look, setLook] = useResultsLook()
  const [period, setPeriod] = useResultsPeriod()
  const presentLabs = useMemo(() => [...new Set(data.rows.map((row) => row.labId))], [data.rows])
  const [hiddenLabs, setHiddenLabs] = useState<number[]>([])
  const [, setDraft] = useReportDraft()
  const navigate = useNavigate()

  const rows = collectedBetween(data.rows, periodStart(period)).filter(
    (row) => !hiddenLabs.includes(row.labId),
  )
  const plottable = isPlottable(rows)
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
        actions={
          <>
            <UnitSwitch data={data} units={units} />
            <Button
              variant="default"
              leftSection={<IconFileText size={ICON_SIZE.button} />}
              onClick={() => {
                setDraft((current) => withAnalytes(current, [analyte.id]))
                void navigate({ to: '/reports' })
              }}
            >
              В отчёт
            </Button>
          </>
        }
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
                <PeriodSwitch value={period} onChange={setPeriod} />
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
              <LookSwitch value={plottable ? look : 'table'} onChange={setLook} chartDisabled={!plottable} />
            </Group>
            <ResultsView
              rows={rows}
              look={look}
              unitId={data.unitId}
              labs={labs}
              units={units}
              empty="За выбранный период результатов нет."
            />
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
