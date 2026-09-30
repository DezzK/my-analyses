import { Badge, Button, Card, Center, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconFlask, IconRefresh } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { OrderSummary } from '@shared/api'
import { isDeviation } from '@shared/domain/references'
import { api } from '../api'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { formatAge, formatDate, formatDateTime, plural } from '../format'
import { SEX_LABELS, SYNC_STATUS_LABELS } from '../labels'
import { describeProgress, SYNC_STATUS_COLORS } from '../labs/sync-text'
import { notifyError } from '../notify'
import { OrderLine } from '../orders/OrdersPage'
import { useCurrentPatient } from '../patients/current'
import { useLabAccounts, useLabMap, useOrder, useOrders, useSyncProgress, useUnits } from '../queries'
import { LabName, ResultsTable } from '../results/ResultsTable'
import { ICON_SIZE } from '../theme'

const RECENT_ORDERS = 6

export function OverviewPage() {
  const { patient } = useCurrentPatient()
  const { data: orders = [], isLoading } = useOrders(patient?.id ?? null)
  if (!patient) return null
  const last = orders[0]

  return (
    <>
      <PageHeader
        title={patient.title}
        subtitle={`${SEX_LABELS[patient.sex]}, ${formatAge(patient.birthDate)}, дата рождения ${formatDate(patient.birthDate)}`}
      />
      {isLoading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : !last ? (
        <EmptyState
          icon={IconFlask}
          title="Пока нет результатов"
          description="Подключите личный кабинет лаборатории — приложение заберёт всю историю анализов. Старые бланки можно внести вручную."
        >
          <Group mt="xs">
            <Button component={Link} to="/labs">
              Подключить лабораторию
            </Button>
            <Button component={Link} to="/orders/new" variant="default">
              Внести вручную
            </Button>
          </Group>
        </EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="lg">
          <LastOrderCard order={last} />
          <Stack gap="lg">
            <SyncCard />
            <RecentOrdersCard orders={orders.slice(0, RECENT_ORDERS)} />
          </Stack>
        </SimpleGrid>
      )}
    </>
  )
}

function LastOrderCard({ order }: { order: OrderSummary }) {
  const labs = useLabMap()
  const units = useUnits()
  const { data } = useOrder(order.id)
  const deviating = (data?.results ?? []).filter((row) => isDeviation(row.read.deviation))

  return (
    <Card style={{ gridColumn: 'span 2' }}>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={4}>Последний заказ</Title>
          <Group gap="sm" mt={4}>
            <Text c="dimmed" className="tabular">
              {formatDate(order.collectedOn)}
            </Text>
            <LabName lab={labs.get(order.labId)} />
          </Group>
        </div>
        <Button component={Link} to="/orders" variant="default" size="xs">
          Все заказы
        </Button>
      </Group>
      {!data ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : deviating.length === 0 ? (
        <Text>
          {order.resultCount > 0
            ? `Все ${order.resultCount} ${plural(order.resultCount, ['показатель', 'показателя', 'показателей'])} в норме.`
            : 'Лаборатория ещё не прислала результаты.'}
        </Text>
      ) : (
        <>
          <Text size="sm" c="dimmed" mb="xs">
            Вне нормы {deviating.length} из {order.resultCount}:
          </Text>
          <ResultsTable rows={deviating} by="analyte" labs={labs} units={units} />
        </>
      )}
    </Card>
  )
}

function SyncCard() {
  const { data: accounts = [] } = useLabAccounts()
  const { data: progress = [] } = useSyncProgress()
  const labs = useLabMap()
  const syncAll = useMutation({ mutationFn: () => api.sync.all(), onError: notifyError })

  return (
    <Card>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Лаборатории</Title>
        {accounts.length > 0 && (
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={ICON_SIZE.button} />}
            loading={syncAll.isPending || progress.length > 0}
            onClick={() => syncAll.mutate()}
          >
            Обновить всё
          </Button>
        )}
      </Group>
      {accounts.length === 0 ? (
        <Text size="sm" c="dimmed">
          Кабинеты не подключены.{' '}
          <Text component={Link} to="/labs" size="sm" c="teal">
            Подключить
          </Text>
        </Text>
      ) : (
        <Stack gap="xs">
          {accounts.map((account) => {
            const running = progress.find((p) => p.accountId === account.id)
            const run = account.lastRun
            return (
              <Group key={account.id} justify="space-between" wrap="nowrap">
                <LabName lab={labs.get(account.labId)} />
                {running ? (
                  <Text size="xs" c="dimmed">
                    {describeProgress(running)}
                  </Text>
                ) : run && run.status !== 'ok' ? (
                  <Badge variant="light" color={SYNC_STATUS_COLORS[run.status]}>
                    {SYNC_STATUS_LABELS[run.status]}
                  </Badge>
                ) : (
                  <Text size="xs" c="dimmed">
                    {account.lastSyncAt
                      ? `обновлено ${formatDateTime(account.lastSyncAt)}`
                      : 'ещё не обновлялся'}
                  </Text>
                )}
              </Group>
            )
          })}
        </Stack>
      )}
    </Card>
  )
}

function RecentOrdersCard({ orders }: { orders: OrderSummary[] }) {
  const labs = useLabMap()
  return (
    <Card>
      <Title order={4} mb="sm">
        Недавние заказы
      </Title>
      <Stack gap="xs">
        {orders.map((order) => (
          <OrderLine key={order.id} order={order} lab={labs.get(order.labId)} compact />
        ))}
      </Stack>
    </Card>
  )
}
