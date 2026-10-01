import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import {
  IconArrowDown,
  IconArrowUp,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import type { CatalogEntry, Panel } from '@shared/api'
import { foldCase } from '@shared/domain/text'
import { api } from '../api'
import { AnalytePicker } from '../components/AnalytePicker'
import { AnchorLink } from '../components/links'
import { PageHeader } from '../components/PageHeader'
import { plural } from '../format'
import { ANALYTE_FORMS, SPECIMEN_LABELS } from '../labels'
import { notifyError } from '../notify'
import { useCatalog, useLabMap, usePanels, useUnits } from '../queries'
import { ICON_SIZE } from '../theme'
import { AnalyteForm } from './AnalyteForm'

export function CatalogPage() {
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  return (
    <>
      <PageHeader
        title="Справочник"
        subtitle="Показатели, их синонимы, единицы и правила референсов"
        actions={
          <Button leftSection={<IconPlus size={ICON_SIZE.button} />} onClick={() => setCreating(true)}>
            Новый показатель
          </Button>
        }
      />
      <Tabs defaultValue="analytes" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="analytes">Показатели</Tabs.Tab>
          <Tabs.Tab value="panels">Наборы</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="analytes">
          <AnalyteList />
        </Tabs.Panel>
        <Tabs.Panel value="panels">
          <PanelList />
        </Tabs.Panel>
      </Tabs>
      <Modal opened={creating} onClose={() => setCreating(false)} title="Новый показатель" size="lg">
        <AnalyteForm
          card={null}
          onSaved={(created) => {
            setCreating(false)
            if (!created) return
            void navigate({ to: '/catalog/$analyteId', params: { analyteId: String(created.id) } })
          }}
        />
      </Modal>
    </>
  )
}

/** Whether an analyte matches what was typed, by name or code, the way search matches. */
function matches(entry: CatalogEntry, needle: string): boolean {
  return [entry.name, ...entry.codes.map((c) => c.code)].some((text) => foldCase(text).includes(needle))
}

function AnalyteList() {
  const { data: entries = [] } = useCatalog()
  const labs = useLabMap()
  const units = useUnits()
  const [query, setQuery] = useState('')
  const [unreviewedOnly, setUnreviewedOnly] = useState(false)
  const needle = foldCase(query.trim())
  const shown = entries.filter((e) => (!unreviewedOnly || !e.reviewed) && (!needle || matches(e, needle)))
  const unreviewed = entries.filter((e) => !e.reviewed).length

  return (
    <Card>
      <Group justify="space-between" mb="md">
        <TextInput
          placeholder="Название или код"
          leftSection={<IconSearch size={ICON_SIZE.button} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          w={320}
        />
        <Switch
          label={`Только непроверенные (${unreviewed})`}
          checked={unreviewedOnly}
          onChange={(e) => setUnreviewedOnly(e.currentTarget.checked)}
        />
      </Group>
      {shown.length === 0 ? (
        <Text size="sm" c="dimmed">
          {entries.length === 0 ? 'Справочник пуст: он наполнится при первом импорте.' : 'Ничего не найдено.'}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={720} maxHeight={640}>
          <Table highlightOnHover verticalSpacing={6} stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Показатель</Table.Th>
                <Table.Th>Биоматериал</Table.Th>
                <Table.Th>Единица</Table.Th>
                <Table.Th>Коды</Table.Th>
                <Table.Th ta="right">Результатов</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <AnchorLink to="/catalog/$analyteId" params={{ analyteId: String(entry.id) }}>
                        {entry.name}
                      </AnchorLink>
                      {!entry.reviewed && (
                        <Badge size="xs" variant="light" color="yellow">
                          не проверен
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{entry.specimen ? SPECIMEN_LABELS[entry.specimen] : ''}</Table.Td>
                  <Table.Td className="nowrap">
                    {entry.canonicalUnitId !== null ? units.get(entry.canonicalUnitId)?.display : ''}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {entry.codes
                        .map((c) => `${labs.get(c.labId ?? -1)?.name ?? ''} ${c.code}`.trim())
                        .join(', ')}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {entry.resultCount}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  )
}

function PanelList() {
  const { data: panels = [] } = usePanels()
  const { data: entries = [] } = useCatalog()
  const names = useMemo(() => new Map(entries.map((e) => [e.id, e.name])), [entries])
  const [editing, setEditing] = useState<Panel | 'new' | null>(null)

  const remove = (panel: Panel) =>
    modals.openConfirmModal({
      title: `Удалить набор «${panel.name}»?`,
      children: <Text size="sm">Показатели и их результаты останутся.</Text>,
      labels: { confirm: 'Удалить', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        api.panels.remove(panel.id).catch(notifyError)
      },
    })

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Набор одним выбором добавляет свои показатели в новый заказ или в отчёт, а поиск находит его и
          показывает результаты всех его показателей разом.
        </Text>
        <Button
          variant="light"
          leftSection={<IconPlus size={ICON_SIZE.button} />}
          onClick={() => setEditing('new')}
        >
          Новый набор
        </Button>
      </Group>
      {panels.length === 0 && (
        <Text size="sm" c="dimmed">
          Наборов пока нет.
        </Text>
      )}
      {panels.map((panel) => (
        <Card key={panel.id}>
          <Group justify="space-between" mb="xs">
            <Title order={5}>{panel.name}</Title>
            <Group gap={4}>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Изменить набор"
                onClick={() => setEditing(panel)}
              >
                <IconPencil size={ICON_SIZE.button} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Удалить набор"
                onClick={() => remove(panel)}
              >
                <IconTrash size={ICON_SIZE.button} />
              </ActionIcon>
            </Group>
          </Group>
          <Text size="sm" c="dimmed">
            {panel.analyteIds.map((id) => names.get(id) ?? '').join(', ')}
          </Text>
        </Card>
      ))}
      <PanelEditor
        panel={editing === 'new' ? null : editing}
        opened={editing !== null}
        names={names}
        onClose={() => setEditing(null)}
      />
    </Stack>
  )
}

function PanelEditor({
  panel,
  opened,
  names,
  onClose,
}: {
  panel: Panel | null
  opened: boolean
  names: ReadonlyMap<number, string>
  onClose: () => void
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={panel ? `Набор «${panel.name}»` : 'Новый набор'}
      size="lg"
    >
      {opened && <PanelFields key={panel?.id ?? 'new'} panel={panel} names={names} onDone={onClose} />}
    </Modal>
  )
}

function PanelFields({
  panel,
  names,
  onDone,
}: {
  panel: Panel | null
  names: ReadonlyMap<number, string>
  onDone: () => void
}) {
  const [name, setName] = useState(panel?.name ?? '')
  const [ids, setIds] = useState<number[]>(panel?.analyteIds ?? [])
  const move = (index: number, by: number) =>
    setIds((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      if (item !== undefined) next.splice(index + by, 0, item)
      return next
    })
  const save = async () => {
    try {
      await api.panels.save(panel?.id ?? null, name, ids)
      onDone()
    } catch (error) {
      notifyError(error)
    }
  }
  return (
    <Stack>
      <TextInput
        label="Название"
        placeholder="Общий анализ крови"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <Stack gap={4}>
        {ids.map((id, index) => (
          <Group key={id} justify="space-between" wrap="nowrap">
            <Text size="sm">
              {index + 1}. {names.get(id)}
            </Text>
            <Group gap={2} wrap="nowrap">
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Выше"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <IconArrowUp size={ICON_SIZE.small} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Ниже"
                disabled={index === ids.length - 1}
                onClick={() => move(index, 1)}
              >
                <IconArrowDown size={ICON_SIZE.small} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Убрать"
                onClick={() => setIds(ids.filter((x) => x !== id))}
              >
                <IconX size={ICON_SIZE.small} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
      </Stack>
      <AnalytePicker
        placeholder="Добавить показатель"
        value={null}
        exclude={ids}
        onChange={(picked) => picked && setIds([...ids, picked.id])}
      />
      <Text size="xs" c="dimmed">
        {ids.length} {plural(ids.length, ANALYTE_FORMS)}
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Отмена
        </Button>
        <Button onClick={() => void save()}>Сохранить</Button>
      </Group>
    </Stack>
  )
}
