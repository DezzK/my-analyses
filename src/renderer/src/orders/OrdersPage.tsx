import { useState } from 'react'
import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  Select,
  Stack,
  Text,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconFileTypePdf, IconFlask, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import type { Lab, OrderDetails, OrderSummary, ResultRow, Unit } from '@shared/api'
import { api } from '../api'
import { EmptyState } from '../components/EmptyState'
import { ButtonLink } from '../components/links'
import { PageHeader } from '../components/PageHeader'
import { formatDate, plural } from '../format'
import { notifyError, notifyUndoable } from '../notify'
import { useCurrentPatient } from '../patients/current'
import { useLabMap, useOrder, useOrders, useUnits } from '../queries'
import { LabName, ResultsTable } from '../results/ResultsTable'
import { ICON_SIZE, TITLE_WEIGHT } from '../theme'
import { headerOf, OrderHeaderFields, orderInput, type HeaderValues } from './OrderHeaderFields'
import { ResultEditor, type ResultEdit } from './ResultEditor'

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
        actions={
          <ButtonLink to="/orders/new" leftSection={<IconPlus size={ICON_SIZE.button} />}>
            Новый заказ
          </ButtonLink>
        }
      />
      {orders.length === 0 ? (
        <EmptyState
          icon={IconFlask}
          title="Заказов пока нет"
          description="Заказы появятся после синхронизации с личным кабинетом лаборатории или после ручного ввода."
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
  const [edit, setEdit] = useState<ResultEdit | null>(null)
  const [editingHeader, setEditingHeader] = useState(false)
  if (isLoading || !data) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    )
  }
  const imported = order.source === 'import'
  const removeOrder = () =>
    modals.openConfirmModal({
      title: 'Удалить заказ?',
      children: (
        <Text size="sm">
          {imported
            ? 'Заказ из кабинета лаборатории вернётся при следующем обновлении, если он ещё там.'
            : 'Вместе с заказом удалятся его результаты.'}
        </Text>
      ),
      labels: { confirm: 'Удалить', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        api.orders
          .remove(order.id)
          .then((token) =>
            notifyUndoable({
              title: `Заказ от ${formatDate(order.collectedOn)} удалён`,
              undoLabel: 'Отменить удаление',
              undo: () => api.orders.undoRemove(token),
            }),
          )
          .catch(notifyError)
      },
    })
  const removeResult = (row: ResultRow) =>
    modals.openConfirmModal({
      title: `Удалить «${row.analyteName}»?`,
      children: <Text size="sm">Результат {row.rawValue} исчезнет из заказа.</Text>,
      labels: { confirm: 'Удалить', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        api.orders.removeResult(row.id).catch(notifyError)
      },
    })

  return (
    <Stack gap="sm">
      {order.note && (
        <Text size="sm" c="dimmed">
          {order.note}
        </Text>
      )}
      <Group justify="space-between">
        <Group gap="xs">
          <Button
            variant="default"
            size="xs"
            leftSection={<IconPencil size={ICON_SIZE.small} />}
            onClick={() => setEditingHeader(true)}
          >
            Изменить заказ
          </Button>
          <Button
            variant="default"
            size="xs"
            leftSection={<IconPlus size={ICON_SIZE.small} />}
            onClick={() => setEdit({ orderId: order.id, imported, row: null })}
          >
            Добавить результат
          </Button>
          <FormsButton orderId={order.id} count={order.formCount} />
        </Group>
        <Button
          variant="subtle"
          color="red"
          size="xs"
          leftSection={<IconTrash size={ICON_SIZE.small} />}
          onClick={removeOrder}
        >
          Удалить заказ
        </Button>
      </Group>
      {data.results.length === 0 ? (
        <Text size="sm" c="dimmed">
          {imported ? 'Лаборатория ещё не прислала результаты.' : 'Результатов нет.'}
        </Text>
      ) : (
        <ResultsTable
          rows={data.results}
          by="analyte"
          labs={labs}
          units={units}
          actions={(row) => (
            <Group gap={4} wrap="nowrap">
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Исправить «${row.analyteName}»`}
                onClick={() => setEdit({ orderId: order.id, imported, row })}
              >
                <IconPencil size={ICON_SIZE.button} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Удалить «${row.analyteName}»`}
                onClick={() => removeResult(row)}
              >
                <IconTrash size={ICON_SIZE.button} />
              </ActionIcon>
            </Group>
          )}
        />
      )}
      <ResultEditor edit={edit} onClose={() => setEdit(null)} />
      <OrderHeaderModal order={data} opened={editingHeader} onClose={() => setEditingHeader(false)} />
    </Stack>
  )
}

/** Corrects an order's own fields, down to whose it is. */
function OrderHeaderModal({
  order,
  opened,
  onClose,
}: {
  order: OrderDetails
  opened: boolean
  onClose: () => void
}) {
  const { patients } = useCurrentPatient()
  const [values, setValues] = useState<HeaderValues>(() => headerOf(order))
  const [patientId, setPatientId] = useState(String(order.patientId))
  const patient = patients.find((p) => String(p.id) === patientId)
  const save = () =>
    api.orders
      .update(order.id, orderInput(values, Number(patientId)))
      .then(onClose)
      .catch(notifyError)
  return (
    <Modal opened={opened} onClose={onClose} title={`Заказ от ${formatDate(order.collectedOn)}`} size="xl">
      <Stack>
        <Select
          label="Чей заказ"
          allowDeselect={false}
          data={patients.map((p) => ({ value: String(p.id), label: p.title }))}
          value={patientId}
          onChange={(value) => value && setPatientId(value)}
          w={320}
        />
        {patient && <OrderHeaderFields values={values} onChange={setValues} patient={patient} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void save()}>Сохранить</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

const openForm = (orderId: number, index: number) => api.orders.openForm(orderId, index).catch(notifyError)

/** The lab's original forms: one opens at once, several are picked from a menu. */
function FormsButton({ orderId, count }: { orderId: number; count: number }) {
  if (count === 0) return null
  const button = (
    <Button
      variant="light"
      size="xs"
      leftSection={<IconFileTypePdf size={ICON_SIZE.small} />}
      onClick={count === 1 ? () => void openForm(orderId, 0) : undefined}
    >
      {count === 1 ? 'Открыть бланк' : `Бланки · ${count}`}
    </Button>
  )
  if (count === 1) return button
  return (
    <Menu position="bottom-start">
      <Menu.Target>{button}</Menu.Target>
      <Menu.Dropdown>
        {Array.from({ length: count }, (_, index) => (
          <Menu.Item key={index} onClick={() => void openForm(orderId, index)}>
            Бланк {index + 1}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
