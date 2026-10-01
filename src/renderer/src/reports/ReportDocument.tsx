import { Group, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import type { Patient, ReportBlock, ReportSpec } from '@shared/api'
import { formatDateRu, todayIso } from '@shared/domain/dates'
import { REPORT_CONTENT_WIDTH_MM } from '@shared/report'
import { formatAge } from '../format'
import { SEX_LABELS } from '../labels'
import { useAnalyteResults, useLabMap, useUnits } from '../queries'
import { unitText } from '../results/format'
import { collectedBetween, isPlottable } from '../results/shown'
import { ResultsChart } from '../results/ResultsChart'
import { ResultsTable } from '../results/ResultsTable'
import { TITLE_WEIGHT } from '../theme'
import { rowsOf } from './rows'

function periodText(spec: ReportSpec): string {
  if (spec.from && spec.to) return `${formatDateRu(spec.from)} – ${formatDateRu(spec.to)}`
  if (spec.from) return `с ${formatDateRu(spec.from)}`
  if (spec.to) return `по ${formatDateRu(spec.to)}`
  return 'всё время'
}

/**
 * The report as it goes on paper: who, which period, then each analyte as a table, a chart or
 * both. Laid out at the width of the page's content, on screen and in print alike.
 */
export function ReportDocument({ spec, patient }: { spec: ReportSpec; patient: Patient }) {
  return (
    <Stack gap="lg" className="report" style={{ width: `${REPORT_CONTENT_WIDTH_MM}mm` }}>
      <div>
        <Title order={2}>{patient.title}</Title>
        <Text size="sm">
          {SEX_LABELS[patient.sex]}, {formatAge(patient.birthDate)}, дата рождения{' '}
          {formatDateRu(patient.birthDate)}
        </Text>
        <Text size="sm" c="dimmed">
          Период: {periodText(spec)} · сформирован {formatDateRu(todayIso())}
        </Text>
      </div>
      {rowsOf(spec.blocks, spec.layout.chartsPerRow).map((row) => (
        <SimpleGrid
          key={row.map((b) => b.analyteId).join('-')}
          cols={row.length}
          className="report-row"
          style={{ breakAfter: row.at(-1)?.breakAfter ? 'page' : 'auto' }}
        >
          {row.map((block) => (
            <ReportBlockView key={block.analyteId} block={block} spec={spec} compact={row.length > 1} />
          ))}
        </SimpleGrid>
      ))}
    </Stack>
  )
}

const CHART_HEIGHT = { full: 300, compact: 220 }

function ReportBlockView({
  block,
  spec,
  compact,
}: {
  block: ReportBlock
  spec: ReportSpec
  compact: boolean
}) {
  const { data } = useAnalyteResults(block.analyteId, spec.patientId)
  const labs = useLabMap()
  const units = useUnits()
  if (!data) return null
  const rows = collectedBetween(data.rows, spec.from, spec.to)
  const unit = unitText(data.unitId, units)
  const plottable = isPlottable(rows)
  return (
    <section className="report-block">
      <Group gap="xs" mb="xs" align="baseline">
        <Text fw={TITLE_WEIGHT} size="lg">
          {data.analyte.name}
        </Text>
        {unit && (
          <Text size="sm" c="dimmed">
            {unit}
          </Text>
        )}
      </Group>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          За этот период результатов нет.
        </Text>
      ) : (
        <Stack gap="sm">
          {block.view !== 'table' && plottable && (
            <div className="report-chart">
              <ResultsChart
                rows={rows}
                labs={labs}
                unitLabel={unit}
                height={compact ? CHART_HEIGHT.compact : CHART_HEIGHT.full}
                interactive={false}
              />
            </div>
          )}
          {block.view !== 'chart' && <ResultsTable rows={rows} by="date" labs={labs} units={units} />}
        </Stack>
      )}
    </section>
  )
}
