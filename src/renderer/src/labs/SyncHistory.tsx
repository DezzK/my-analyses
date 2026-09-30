import { Badge, Center, Loader, Table, Text } from '@mantine/core'
import type { SyncRun } from '@shared/api'
import { formatDateTime } from '../format'
import { SYNC_STATUS_LABELS } from '../labels'
import { useSyncHistory } from '../queries'
import { describeStats, SYNC_STATUS_COLORS } from './sync-text'

function details(run: SyncRun): string {
  if (run.status === 'ok') return describeStats(run.stats)
  return run.error ?? ''
}

export function SyncHistory({ accountId }: { accountId: number }) {
  const { data: runs = [], isLoading } = useSyncHistory(accountId)
  if (isLoading) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    )
  }
  if (runs.length === 0) return <Text size="sm">Обновлений ещё не было.</Text>
  return (
    <Table.ScrollContainer minWidth={480} maxHeight={420}>
      <Table className="tabular" verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Когда</Table.Th>
            <Table.Th>Итог</Table.Th>
            <Table.Th>Подробности</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {runs.map((run) => (
            <Table.Tr key={run.id}>
              <Table.Td className="nowrap">{formatDateTime(run.startedAt)}</Table.Td>
              <Table.Td className="nowrap">
                {/* A clipped label would let the table squeeze the badge down to its padding. */}
                <Badge
                  variant="light"
                  color={SYNC_STATUS_COLORS[run.status]}
                  styles={{ label: { overflow: 'visible' } }}
                >
                  {SYNC_STATUS_LABELS[run.status]}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{details(run)}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
