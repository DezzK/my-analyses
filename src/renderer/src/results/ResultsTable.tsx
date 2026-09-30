import { Group, Table, Text, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconFlag } from '@tabler/icons-react'
import type { Lab, ResultRow, Unit } from '@shared/api'
import { isDeviation } from '@shared/domain/references'
import { AnchorLink } from '../components/links'
import { LabMarker } from '../components/LabMarker'
import { formatDate } from '../format'
import { LAB_FLAG_LABELS, REFERENCE_SOURCE_LABELS } from '../labels'
import { DEVIATION_MARKS, referenceText, unitText, valueText } from './format'
import { ICON_SIZE } from '../theme'

interface Lookups {
  labs: ReadonlyMap<number, Lab>
  units: ReadonlyMap<number, Unit>
}

/**
 * Results as the original spec lays them out: a value outside its norm is bold with (+) or (−),
 * the reference is the one applied to that very result, and every row is in one unit.
 * `by: 'date'` lists one analyte over time; `by: 'analyte'` lists the results of one order.
 */
export function ResultsTable({
  rows,
  by,
  ...lookups
}: { rows: ResultRow[]; by: 'date' | 'analyte' } & Lookups) {
  return (
    <Table.ScrollContainer minWidth={560}>
      <Table className="tabular" verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{by === 'date' ? 'Дата сдачи' : 'Показатель'}</Table.Th>
            <Table.Th>Результат</Table.Th>
            <Table.Th>Референс</Table.Th>
            <Table.Th>Единицы</Table.Th>
            {by === 'date' && <Table.Th>Лаборатория</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.id}>
              <Table.Td className="nowrap">
                {by === 'date' ? (
                  formatDate(row.collectedOn)
                ) : (
                  <AnchorLink to="/analytes/$analyteId" params={{ analyteId: String(row.analyteId) }}>
                    {row.analyteName}
                  </AnchorLink>
                )}
              </Table.Td>
              <Table.Td>
                <ValueCell row={row} units={lookups.units} />
              </Table.Td>
              <Table.Td className="nowrap">
                <ReferenceCell row={row} units={lookups.units} />
              </Table.Td>
              <Table.Td className="nowrap">{unitText(row.read.value.unitId, lookups.units)}</Table.Td>
              {by === 'date' && (
                <Table.Td className="nowrap">
                  <LabName lab={lookups.labs.get(row.labId)} />
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function ValueCell({ row, units }: { row: ResultRow; units: Lookups['units'] }) {
  const { value, deviation, labDisagrees } = row.read
  const deviates = isDeviation(deviation)
  const converted = value.unitId !== row.reportedUnitId
  const text = (
    <Text span fw={deviates ? 700 : undefined} c={deviates ? 'red.8' : undefined}>
      {valueText(row)}
      {deviation && DEVIATION_MARKS[deviation] ? ` ${DEVIATION_MARKS[deviation]}` : ''}
    </Text>
  )
  return (
    <Group gap={6} wrap="nowrap">
      {converted ? (
        <Tooltip label={`У лаборатории: ${row.rawValue} ${unitText(row.reportedUnitId, units)}`.trim()}>
          {text}
        </Tooltip>
      ) : (
        text
      )}
      {!value.inTarget && (
        <Tooltip label="Не пересчитано в выбранную единицу: для неё нет коэффициента">
          <IconAlertTriangle size={ICON_SIZE.small} color="var(--mantine-color-yellow-7)" />
        </Tooltip>
      )}
      {labDisagrees && row.labFlag && (
        <Tooltip label={`Лаборатория оценила иначе: ${LAB_FLAG_LABELS[row.labFlag]}`}>
          <IconFlag size={ICON_SIZE.small} color="var(--mantine-color-orange-7)" />
        </Tooltip>
      )}
    </Group>
  )
}

function ReferenceCell({ row, units }: { row: ResultRow; units: Lookups['units'] }) {
  const reference = row.read.reference
  if (!reference) {
    return (
      <Text span c="dimmed">
        {referenceText(null)}
      </Text>
    )
  }
  const ownUnit = reference.inValueUnit ? '' : ` ${unitText(reference.unitId, units)}`
  return (
    <Tooltip label={REFERENCE_SOURCE_LABELS[reference.source]}>
      <Text span>
        {referenceText(reference)}
        {ownUnit}
      </Text>
    </Tooltip>
  )
}

export function LabName({ lab }: { lab: Lab | undefined }) {
  if (!lab) return null
  return (
    <Group gap={6} wrap="nowrap">
      <LabMarker color={lab.markerColor} shape={lab.markerShape} />
      <Text span>{lab.name}</Text>
    </Group>
  )
}
