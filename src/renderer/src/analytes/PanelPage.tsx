import { Button, Card, Center, Group, Loader, Stack, Text } from '@mantine/core'
import { IconFileText, IconListDetails } from '@tabler/icons-react'
import { useQueries } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { AnalyteResults, Lab, Panel, Patient, Unit } from '@shared/api'
import { EmptyState } from '../components/EmptyState'
import { AnchorLink } from '../components/links'
import { PageHeader } from '../components/PageHeader'
import { plural } from '../format'
import { ANALYTE_FORMS } from '../labels'
import { useCurrentPatient } from '../patients/current'
import { analyteResultsQuery, useLabMap, usePanels, useUnits } from '../queries'
import { unitText } from '../results/format'
import {
  LookSwitch,
  PeriodSwitch,
  ResultsView,
  useResultsLook,
  useResultsPeriod,
  type ResultsLook,
} from '../results/ResultsView'
import { collectedBetween } from '../results/shown'
import { useReportDraft, withAnalytes } from '../reports/draft'
import { ICON_SIZE, TITLE_WEIGHT } from '../theme'
import { periodStart } from './periods'

/** A panel's analytes one under another, each with its own table or chart, for the current patient. */
export function PanelPage() {
  const { panelId } = useParams({ from: '/panels/$panelId' })
  const { patient } = useCurrentPatient()
  const { data: panels, isLoading } = usePanels()
  const panel = panels?.find((p) => p.id === Number(panelId))

  if (isLoading || !patient) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }
  if (!panel) {
    return (
      <EmptyState icon={IconListDetails} title="Набора больше нет" description="Его удалили в справочнике." />
    )
  }
  return <PanelView panel={panel} patient={patient} />
}

function PanelView({ panel, patient }: { panel: Panel; patient: Patient }) {
  const results = useQueries({ queries: panel.analyteIds.map((id) => analyteResultsQuery(id, patient.id)) })
  const labs = useLabMap()
  const units = useUnits()
  const [look, setLook] = useResultsLook()
  const [period, setPeriod] = useResultsPeriod()
  const [, setDraft] = useReportDraft()
  const navigate = useNavigate()
  const from = periodStart(period)
  const count = panel.analyteIds.length

  return (
    <>
      <PageHeader
        title={panel.name}
        subtitle={`${count} ${plural(count, ANALYTE_FORMS)} · ${patient.title}`}
        actions={
          <Button
            variant="default"
            leftSection={<IconFileText size={ICON_SIZE.button} />}
            onClick={() => {
              setDraft((current) => withAnalytes(current, panel.analyteIds))
              void navigate({ to: '/reports' })
            }}
          >
            В отчёт
          </Button>
        }
      />
      <Stack gap="md">
        <Group justify="space-between">
          <PeriodSwitch value={period} onChange={setPeriod} />
          <LookSwitch value={look} onChange={setLook} />
        </Group>
        {panel.analyteIds.map((id, index) => {
          const data = results[index]?.data
          return (
            <Card key={id}>
              {data ? (
                <AnalyteSection data={data} from={from} look={look} labs={labs} units={units} />
              ) : (
                <Loader size="sm" />
              )}
            </Card>
          )
        })}
      </Stack>
    </>
  )
}

function AnalyteSection({
  data,
  from,
  look,
  labs,
  units,
}: {
  data: AnalyteResults
  from: string | null
  look: ResultsLook
  labs: ReadonlyMap<number, Lab>
  units: ReadonlyMap<number, Unit>
}) {
  const unit = unitText(data.unitId, units)
  return (
    <Stack gap="sm">
      <Group gap="xs" align="baseline">
        <AnchorLink
          to="/analytes/$analyteId"
          params={{ analyteId: String(data.analyte.id) }}
          fw={TITLE_WEIGHT}
          size="lg"
        >
          {data.analyte.name}
        </AnchorLink>
        {unit && (
          <Text size="sm" c="dimmed">
            {unit}
          </Text>
        )}
      </Group>
      <ResultsView
        rows={collectedBetween(data.rows, from)}
        look={look}
        unitId={data.unitId}
        labs={labs}
        units={units}
        empty={data.rows.length === 0 ? 'Результатов пока нет.' : 'За выбранный период результатов нет.'}
      />
    </Stack>
  )
}
