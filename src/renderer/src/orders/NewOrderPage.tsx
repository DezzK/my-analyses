import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconX } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import type { ManualOrder, Patient } from '@shared/api'
import { api } from '../api'
import { AnalyteForm } from '../catalog/AnalyteForm'
import { AnalytePicker } from '../components/AnalytePicker'
import { PageHeader } from '../components/PageHeader'
import { notifyError } from '../notify'
import { useCurrentPatient } from '../patients/current'
import { useCatalog, useOrderCheck, usePanels } from '../queries'
import { ICON_SIZE } from '../theme'
import { emptyHeader, OrderHeaderFields, orderInput, type HeaderValues } from './OrderHeaderFields'
import { useResultUnits, VALUE_PLACEHOLDER } from './result-units'

/** Typing pauses this long before the rows are checked against earlier results. */
const CHECK_DEBOUNCE_MS = 500

/** The fields of a row focus moves between. */
type Field = 'analyte' | 'value'

interface Row {
  key: number
  analyte: { id: number; name: string } | null
  value: string
  unitId: string | null
  reference: string
}

let nextKey = 1
function blankRow(analyte: Row['analyte'] = null): Row {
  return { key: nextKey++, analyte, value: '', unitId: null, reference: '' }
}

/** The rows worth sending: those with an analyte; an analyte without a value is for the main process to point out. */
function manualOrder(header: HeaderValues, rows: readonly Row[], patient: Patient): ManualOrder {
  return {
    ...orderInput(header, patient.id),
    results: rows.flatMap((row) =>
      row.analyte
        ? [
            {
              analyteId: row.analyte.id,
              rawValue: row.value,
              unitId: row.unitId ? Number(row.unitId) : null,
              refRaw: row.reference || null,
              note: null,
            },
          ]
        : [],
    ),
  }
}

/**
 * An order typed by hand: the header once, then a row per result. Enter in the last field of a
 * row moves to the next one, adding it when needed, so a panel of twenty results is typed
 * without the mouse.
 */
export function NewOrderPage() {
  const { patient } = useCurrentPatient()
  if (!patient) return null
  return <OrderEntry patient={patient} />
}

function OrderEntry({ patient }: { patient: Patient }) {
  const navigate = useNavigate()
  const [header, setHeader] = useState<HeaderValues>(emptyHeader)
  const [rows, setRows] = useState<Row[]>(() => [blankRow()])
  const fields = useRef(new Map<number, Partial<Record<Field, HTMLInputElement | null>>>())
  const [focus, setFocus] = useState<{ key: number; field: Field } | null>(null)
  useEffect(() => {
    if (!focus) return
    fields.current.get(focus.key)?.[focus.field]?.focus()
    setFocus(null)
  }, [focus])
  const [creating, setCreating] = useState<{ rowKey: number; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: panels = [] } = usePanels()
  const { data: catalog = [] } = useCatalog()
  const names = useMemo(() => new Map(catalog.map((entry) => [entry.id, entry.name])), [catalog])

  const order = manualOrder(header, rows, patient)
  const [checked] = useDebouncedValue(order, CHECK_DEBOUNCE_MS)
  const { data: warnings = [] } = useOrderCheck(header.labId && header.collectedOn ? checked : null)
  const sentKeys = rows.filter((row) => row.analyte).map((row) => row.key)
  const warningFor = (key: number) => warnings.find((w) => sentKeys[w.row] === key)?.message

  const update = (key: number, patch: Partial<Row>) =>
    setRows((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  /** Moves on to the next row: to its value if it has an analyte, else to picking one. */
  const next = (key: number) => {
    const index = rows.findIndex((row) => row.key === key)
    const following = rows[index + 1]
    if (following) {
      setFocus({ key: following.key, field: following.analyte ? 'value' : 'analyte' })
      return
    }
    addRow()
  }
  const addRow = () => {
    const added = blankRow()
    setRows((list) => [...list, added])
    setFocus({ key: added.key, field: 'analyte' })
  }
  const addPanel = (panelId: string | null) => {
    const panel = panels.find((p) => String(p.id) === panelId)
    if (!panel) return
    const present = new Set(rows.flatMap((row) => (row.analyte ? [row.analyte.id] : [])))
    const added = panel.analyteIds
      .filter((id) => !present.has(id))
      .map((id) => blankRow({ id, name: names.get(id) ?? '' }))
    setRows([...rows.filter((row) => row.analyte || row.value), ...added])
  }
  const save = async () => {
    setSaving(true)
    try {
      await api.orders.create(order)
      notifications.show({ message: 'Заказ сохранён' })
      void navigate({ to: '/orders' })
    } catch (error) {
      notifyError(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Новый заказ" subtitle={`Пациент: ${patient.title}`} />
      <Stack gap="lg">
        <Card>
          <OrderHeaderFields values={header} onChange={setHeader} patient={patient} />
        </Card>
        <Card>
          <Group justify="space-between" mb="md">
            <Title order={4}>Результаты</Title>
            {panels.length > 0 && (
              <Select
                placeholder="Добавить набор"
                w={260}
                value={null}
                data={panels.map((p) => ({ value: String(p.id), label: p.name }))}
                onChange={addPanel}
              />
            )}
          </Group>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w="36%">Показатель</Table.Th>
                  <Table.Th>Значение</Table.Th>
                  <Table.Th w={170}>Единица</Table.Th>
                  <Table.Th>Референс из бланка</Table.Th>
                  <Table.Th w={40} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <EntryRow
                    key={row.key}
                    row={row}
                    register={(field, element) => {
                      const known = fields.current.get(row.key) ?? {}
                      fields.current.set(row.key, { ...known, [field]: element })
                    }}
                    warning={warningFor(row.key)}
                    exclude={rows.flatMap((other) =>
                      other.analyte && other.key !== row.key ? [other.analyte.id] : [],
                    )}
                    onChange={(patch) => update(row.key, patch)}
                    onNext={() => next(row.key)}
                    onRemove={() =>
                      setRows(rows.length > 1 ? rows.filter((r) => r.key !== row.key) : [blankRow()])
                    }
                    onCreate={(name) => setCreating({ rowKey: row.key, name })}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Button variant="subtle" mt="xs" leftSection={<IconPlus size={ICON_SIZE.small} />} onClick={addRow}>
            Строка
          </Button>
        </Card>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => void navigate({ to: '/orders' })}>
            Отмена
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Сохранить заказ
          </Button>
        </Group>
      </Stack>
      <Modal opened={creating !== null} onClose={() => setCreating(null)} title="Новый показатель" size="lg">
        {creating && (
          <AnalyteForm
            card={null}
            initialName={creating.name}
            onSaved={(created) => {
              if (created) update(creating.rowKey, { analyte: { id: created.id, name: created.name } })
              setCreating(null)
            }}
          />
        )}
      </Modal>
    </>
  )
}

function EntryRow({
  row,
  register,
  warning,
  exclude,
  onChange,
  onNext,
  onRemove,
  onCreate,
}: {
  row: Row
  register: (field: Field, element: HTMLInputElement | null) => void
  warning: string | undefined
  exclude: number[]
  onChange: (patch: Partial<Row>) => void
  onNext: () => void
  onRemove: () => void
  onCreate: (name: string) => void
}) {
  const chooseUnit = useCallback((unitId: string) => onChange({ unitId }), [onChange])
  const unitOptions = useResultUnits(row.analyte?.id ?? null, row.unitId, chooseUnit)
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    onNext()
  }
  return (
    <Table.Tr>
      <Table.Td>
        <AnalytePicker
          value={row.analyte}
          exclude={exclude}
          inputRef={(element) => register('analyte', element)}
          onChange={(analyte) => onChange({ analyte, unitId: null })}
          onCreate={onCreate}
        />
      </Table.Td>
      <Table.Td>
        <TextInput
          ref={(element) => register('value', element)}
          aria-label="Значение"
          placeholder={VALUE_PLACEHOLDER}
          value={row.value}
          onChange={(e) => onChange({ value: e.currentTarget.value })}
          onKeyDown={onEnter}
        />
        {warning && (
          <Text size="xs" c="orange.8" mt={4}>
            {warning}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Select
          aria-label="Единица"
          placeholder="—"
          clearable
          data={unitOptions}
          value={row.unitId}
          onChange={(unitId) => onChange({ unitId })}
        />
      </Table.Td>
      <Table.Td>
        <TextInput
          aria-label="Референс"
          placeholder="3,9–5,5"
          value={row.reference}
          onChange={(e) => onChange({ reference: e.currentTarget.value })}
          onKeyDown={onEnter}
        />
      </Table.Td>
      <Table.Td>
        <ActionIcon variant="subtle" color="gray" aria-label="Убрать строку" onClick={onRemove}>
          <IconX size={ICON_SIZE.small} />
        </ActionIcon>
      </Table.Td>
    </Table.Tr>
  )
}
