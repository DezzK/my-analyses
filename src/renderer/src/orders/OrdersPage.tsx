import { useState } from 'react'
import { Accordion, Badge, Button, Center, Group, Loader, Stack, Text } from '@mantine/core'
import { IconFileTypePdf, IconFlask } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import type { Lab, OrderSummary, Unit } from '@shared/api'
import { api } from '../api'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { formatDate, plural } from '../format'
import { notifyError } from '../notify'
import { useCurrentPatient } from '../patients/current'
import { useLabMap, useOrder, useOrders, useUnits } from '../queries'
import { LabName, ResultsTable } from '../results/ResultsTable'
import { ICON_SIZE, TITLE_WEIGHT } from '../theme'

export function OrdersPage() {
  const { patient } = useCurrentPatient()
  const { data: orders = [], isLoading } = useOrders(patient?.id ?? null)
  const labs = useLabMap()
  const units = useUnits()
  const [open, setOpen] = useState<string | null>(null)

  if (isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }
  return (
    <>
      <PageHeader
        title="Заказы"
        subtitle={
          orders.length > 0
            ? `${orders.length} ${plural(orders.length, ['заказ', 'заказа', 'заказов'])}, новые сверху`
            : undefined
        }
      />
      {orders.length === 0 ? (
        <EmptyState
          icon={IconFlask}
          title="Заказов пока нет"
          description="Заказы появятся после синхронизации с личным кабинетом лаборатории."
        >
          <Button component={Link} to="/labs" mt="xs">
            Подключить лабораторию
          </Button>
        </EmptyState>
      ) : (
        <Accordion variant="separated" radius="lg" value={open} onChange={setOpen}>
          {orders.map((order) => (
            <Accordion.Item key={order.id} value={String(order.id)}>
              <Accordion.Control>
                <OrderLine order={order} lab={labs.get(order.labId)} />
              </Accordion.Control>
              <Accordion.Panel>
                {open === String(order.id) && <OrderResults order={order} labs={labs} units={units} />}
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </>
  )
}

/** An order in one line; `compact` leaves out what a narrow card has no room for. */
export function OrderLine({
  order,
  lab,
  compact = false,
}: {
  order: OrderSummary
  lab: Lab | undefined
  compact?: boolean
}) {
  const deviations = `${order.deviationCount} вне нормы`
  return (
    <Group justify="space-between" wrap="nowrap" pr={compact ? 0 : 'sm'}>
      <Group gap={compact ? 'sm' : 'lg'} wrap="nowrap">
        <Text fw={TITLE_WEIGHT} className="tabular">
          {formatDate(order.collectedOn)}
        </Text>
        <LabName lab={lab} />
      </Group>
      <Group gap="xs" wrap="nowrap">
        {!compact && order.source === 'manual' && (
          <Badge variant="light" color="gray">
            вручную
          </Badge>
        )}
        {order.deviationCount > 0 &&
          (compact ? (
            <Text size="sm" c="red.8" className="nowrap">
              {deviations}
            </Text>
          ) : (
            <Badge variant="light" color="red">
              {deviations}
            </Badge>
          ))}
        {!compact && (
          <Text size="sm" c="dimmed" className="tabular nowrap">
            {order.resultCount} {plural(order.resultCount, ['показатель', 'показателя', 'показателей'])}
          </Text>
        )}
      </Group>
    </Group>
  )
}

function OrderResults({
  order,
  labs,
  units,
}: {
  order: OrderSummary
  labs: ReadonlyMap<number, Lab>
  units: ReadonlyMap<number, Unit>
}) {
  const { data, isLoading } = useOrder(order.id)
  if (isLoading || !data) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    )
  }
  return (
    <Stack gap="sm">
      {(order.hasForm || order.note) && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {order.note}
          </Text>
          {order.hasForm && (
            <Button
              variant="light"
              size="xs"
              leftSection={<IconFileTypePdf size={ICON_SIZE.button} />}
              onClick={() => api.orders.openForm(order.id).catch(notifyError)}
            >
              Открыть бланк
            </Button>
          )}
        </Group>
      )}
      {data.results.length === 0 ? (
        <Text size="sm" c="dimmed">
          Лаборатория ещё не прислала результаты.
        </Text>
      ) : (
        <ResultsTable rows={data.results} by="analyte" labs={labs} units={units} />
      )}
    </Stack>
  )
}
