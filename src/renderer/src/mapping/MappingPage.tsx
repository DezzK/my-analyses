import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Popover,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
} from '@mantine/core'
import { IconChecks } from '@tabler/icons-react'
import type { MappingQueue, OrderSummary, UnknownUnit, UnreviewedAnalyte } from '@shared/api'
import { CYCLE_PHASES, type CyclePhase } from '@shared/domain/enums'
import { api } from '../api'
import { AnchorLink } from '../components/links'
import { PageHeader } from '../components/PageHeader'
import { formatDate, plural } from '../format'
import { CYCLE_PHASE_LABELS, LAB_FLAG_LABELS } from '../labels'
import { notifyError, notifyUndoable } from '../notify'
import { useCurrentPatient } from '../patients/current'
import { useLabMap, useMappingQueue, useSuggestions, useUnits } from '../queries'
import { referenceText, unitText, valueText } from '../results/format'
import { LabName } from '../results/ResultsTable'
import { ICON_SIZE, TITLE_WEIGHT } from '../theme'

/** How many things wait in the queue, for the navigation badge. */
export function pendingCount(queue: MappingQueue | undefined): number {
  return queue ? queue.analytes.length + queue.units.length + queue.phaseOrders.length : 0
}

export function MappingPage() {
  const { patient } = useCurrentPatient()
  const { data: queue, isLoading } = useMappingQueue(patient?.id ?? null)
  if (isLoading || !queue || !patient) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }
  const tab = (label: string, n: number) => (
    <Group gap={6} wrap="nowrap">
      {label}
      {n > 0 && (
        <Badge size="sm" variant="light" circle={n < 10}>
          {n}
        </Badge>
      )}
    </Group>
  )
  return (
    <>
      <PageHeader title="Сопоставление" subtitle="Что после импорта стоит проверить или уточнить" />
      <Tabs defaultValue="analytes" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="analytes">{tab('Новые показатели', queue.analytes.length)}</Tabs.Tab>
          <Tabs.Tab value="units">{tab('Единицы', queue.units.length)}</Tabs.Tab>
          <Tabs.Tab value="phases">{tab('Фаза цикла', queue.phaseOrders.length)}</Tabs.Tab>
          <Tabs.Tab value="disagreements">{tab('Расхождения', queue.disagreements.length)}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="analytes">
          <NewAnalytes analytes={queue.analytes} />
        </Tabs.Panel>
        <Tabs.Panel value="units">
          <UnknownUnits units={queue.units} />
        </Tabs.Panel>
        <Tabs.Panel value="phases">
          <PhaseOrders orders={queue.phaseOrders} />
        </Tabs.Panel>
        <Tabs.Panel value="disagreements">
          <Disagreements queue={queue} patientName={patient.title} />
        </Tabs.Panel>
      </Tabs>
    </>
  )
}

function Nothing({ children }: { children: string }) {
  return (
    <Card>
      <Group gap="xs">
        <IconChecks size={ICON_SIZE.button} color="var(--mantine-color-teal-6)" />
        <Text size="sm">{children}</Text>
      </Group>
    </Card>
  )
}

function NewAnalytes({ analytes }: { analytes: UnreviewedAnalyte[] }) {
  const labs = useLabMap()
  const units = useUnits()
  if (analytes.length === 0) return <Nothing>Все показатели проверены.</Nothing>
  const ids = analytes.map((a) => a.id)
  const acceptAll = () =>
    api.mapping
      .setReviewed(ids, true)
      .then(() =>
        notifyUndoable({
          title: `${ids.length} ${plural(ids.length, ['показатель принят', 'показателя приняты', 'показателей принято'])}`,
          undoLabel: 'Вернуть в очередь',
          undo: () => api.mapping.setReviewed(ids, false),
        }),
      )
      .catch(notifyError)
  return (
    <Card>
      <Group justify="space-between" mb="md" wrap="nowrap">
        <Text size="sm" c="dimmed">
          Импорт сам заводит показатель для каждого нового кода лаборатории. Показатели первой лаборатории
          можно принять разом; показатель другой лаборатории лучше объединить с уже знакомым.
        </Text>
        <Button variant="light" onClick={() => void acceptAll()} style={{ flex: 'none' }}>
          Принять все ({analytes.length})
        </Button>
      </Group>
      <Table.ScrollContainer minWidth={720} maxHeight={600}>
        <Table verticalSpacing={6} stickyHeader highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Показатель</Table.Th>
              <Table.Th>Код</Table.Th>
              <Table.Th>Единица</Table.Th>
              <Table.Th ta="right">Результатов</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {analytes.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>
                  <AnchorLink to="/catalog/$analyteId" params={{ analyteId: String(a.id) }}>
                    {a.name}
                  </AnchorLink>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {a.codes.map((c) => `${labs.get(c.labId ?? -1)?.name ?? ''} ${c.code}`.trim()).join(', ')}
                  </Text>
                </Table.Td>
                <Table.Td className="nowrap">{unitText(a.unitId, units)}</Table.Td>
                <Table.Td ta="right" className="tabular">
                  {a.resultCount}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <SuggestionsButton analyte={a} />
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => api.mapping.setReviewed([a.id], true).catch(notifyError)}
                    >
                      Принять
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  )
}

/** Existing analytes this one may be, each a click away from a merge. */
function SuggestionsButton({ analyte }: { analyte: UnreviewedAnalyte }) {
  const [opened, setOpened] = useState(false)
  const { data: suggestions, isLoading } = useSuggestions(opened ? analyte.id : null)
  const units = useUnits()
  const merge = (targetId: number, targetName: string) =>
    api.analytes
      .merge(analyte.id, targetId)
      .then((mergeId) => {
        setOpened(false)
        notifyUndoable({
          title: `«${analyte.name}» объединён с «${targetName}»`,
          undoLabel: 'Отменить объединение',
          undo: () => api.analytes.unmerge(mergeId),
        })
      })
      .catch(notifyError)
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={360} shadow="md">
      <Popover.Target>
        <Button size="xs" variant="subtle" color="gray" onClick={() => setOpened((o) => !o)}>
          Похожие
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        {isLoading ? (
          <Center py="xs">
            <Loader size="xs" />
          </Center>
        ) : !suggestions?.length ? (
          <Text size="sm" c="dimmed">
            Похожих показателей не нашлось.
          </Text>
        ) : (
          <Stack gap={6}>
            <Text size="xs" c="dimmed">
              Объединить «{analyte.name}» с:
            </Text>
            {suggestions.map((s) => (
              <Group key={s.id} justify="space-between" wrap="nowrap">
                <Text size="sm">
                  {s.name}{' '}
                  <Text span size="xs" c="dimmed">
                    {unitText(s.unitId, units)}
                  </Text>
                </Text>
                <Button size="xs" variant="light" onClick={() => void merge(s.id, s.name)}>
                  Объединить
                </Button>
              </Group>
            ))}
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  )
}

function UnknownUnits({ units: unknown }: { units: UnknownUnit[] }) {
  if (unknown.length === 0) return <Nothing>Все единицы знакомы.</Nothing>
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Этих написаний нет в словаре единиц. Если это известная единица, сопоставьте её: результаты
        пересчитаются, а следующий импорт узнает написание сам.
      </Text>
      {unknown.map((u) => (
        <UnknownUnitCard key={u.id} unit={u} />
      ))}
    </Stack>
  )
}

function UnknownUnitCard({ unit }: { unit: UnknownUnit }) {
  const units = useUnits()
  const [target, setTarget] = useState<string | null>(null)
  const choices = [...units.values()]
    .filter((u) => u.reviewed && u.id !== unit.id)
    .map((u) => ({ value: String(u.id), label: u.display }))
  return (
    <Card>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={TITLE_WEIGHT}>«{unit.display}»</Text>
          <Text size="sm" c="dimmed">
            {unit.resultCount} {plural(unit.resultCount, ['результат', 'результата', 'результатов'])}
            {unit.analyteNames.length > 0 && ` · ${unit.analyteNames.join(', ')}`}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          <Select
            placeholder="Это единица…"
            searchable
            data={choices}
            value={target}
            onChange={setTarget}
            w={200}
          />
          <Button
            disabled={!target}
            onClick={() => target && api.units.map(unit.id, Number(target)).catch(notifyError)}
          >
            Сопоставить
          </Button>
          <Button variant="default" onClick={() => api.units.accept(unit.id).catch(notifyError)}>
            Оставить как есть
          </Button>
        </Group>
      </Group>
    </Card>
  )
}

function PhaseOrders({ orders }: { orders: OrderSummary[] }) {
  const labs = useLabMap()
  if (orders.length === 0) return <Nothing>Уточнять фазу цикла не нужно.</Nothing>
  return (
    <Card>
      <Text size="sm" c="dimmed" mb="md">
        Для показателей этих заказов в справочнике есть нормы по фазам цикла. Лаборатория фазу не передаёт —
        укажите её, и результаты оценятся по нужной норме.
      </Text>
      <Stack gap="xs">
        {orders.map((order) => (
          <Group key={order.id} justify="space-between" wrap="nowrap">
            <Group gap="lg" wrap="nowrap">
              <Text className="tabular" fw={TITLE_WEIGHT}>
                {formatDate(order.collectedOn)}
              </Text>
              <LabName lab={labs.get(order.labId)} />
            </Group>
            <Select
              placeholder="Фаза цикла"
              w={240}
              data={CYCLE_PHASES.map((p) => ({ value: p, label: CYCLE_PHASE_LABELS[p] }))}
              onChange={(phase) =>
                phase && api.orders.setCyclePhase(order.id, phase as CyclePhase).catch(notifyError)
              }
            />
          </Group>
        ))}
      </Stack>
    </Card>
  )
}

function Disagreements({ queue, patientName }: { queue: MappingQueue; patientName: string }) {
  const labs = useLabMap()
  const units = useUnits()
  const rows = queue.disagreements
  if (rows.length === 0)
    return <Nothing>{`Оценки приложения и лабораторий у пациента «${patientName}» совпадают.`}</Nothing>
  return (
    <Card>
      <Alert variant="light" color="orange" mb="md">
        Лаборатория оценила эти результаты иначе, чем приложение. Обычно причина — референс, которого нет в
        бланке, или правило справочника, которое стоит поправить.
      </Alert>
      <Table.ScrollContainer minWidth={720}>
        <Table className="tabular" verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Дата</Table.Th>
              <Table.Th>Показатель</Table.Th>
              <Table.Th>Результат</Table.Th>
              <Table.Th>Референс</Table.Th>
              <Table.Th>Лаборатория</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.id}>
                <Table.Td>{formatDate(row.collectedOn)}</Table.Td>
                <Table.Td>
                  <AnchorLink to="/analytes/$analyteId" params={{ analyteId: String(row.analyteId) }}>
                    {row.analyteName}
                  </AnchorLink>
                </Table.Td>
                <Table.Td>
                  {valueText(row)} {unitText(row.read.value.unitId, units)}
                </Table.Td>
                <Table.Td>{referenceText(row.read.reference)}</Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <LabName lab={labs.get(row.labId)} />
                    {row.labFlag && (
                      <Text size="sm" c="orange.8">
                        {LAB_FLAG_LABELS[row.labFlag]}
                      </Text>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  )
}
