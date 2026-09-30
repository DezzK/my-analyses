import { useState } from 'react'
import { Button, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import type { ResultRow } from '@shared/api'
import { api } from '../api'
import { AnalytePicker } from '../components/AnalytePicker'
import { notifyError } from '../notify'
import { useResultUnits, VALUE_PLACEHOLDER } from './result-units'

/** What the editor is for: a new result of an order (`row` null), or a correction of `row`. */
export interface ResultEdit {
  orderId: number
  /** The order came from a lab's account, whose later imports keep a corrected result. */
  imported: boolean
  row: ResultRow | null
}

export function ResultEditor({ edit, onClose }: { edit: ResultEdit | null; onClose: () => void }) {
  return (
    <Modal
      opened={edit !== null}
      onClose={onClose}
      title={edit?.row ? `Исправить «${edit.row.analyteName}»` : 'Добавить результат'}
    >
      {edit && <Fields key={edit.row?.id ?? 'new'} edit={edit} onDone={onClose} />}
    </Modal>
  )
}

function Fields({ edit, onDone }: { edit: ResultEdit; onDone: () => void }) {
  const { row } = edit
  const [analyte, setAnalyte] = useState(row ? { id: row.analyteId, name: row.analyteName } : null)
  const [value, setValue] = useState(row?.rawValue ?? '')
  const [unitId, setUnitId] = useState<string | null>(row?.reportedUnitId ? String(row.reportedUnitId) : null)
  const [reference, setReference] = useState(row?.refRaw ?? '')
  const [note, setNote] = useState(row?.note ?? '')
  const unitOptions = useResultUnits(analyte?.id ?? null, unitId, setUnitId)

  const save = async () => {
    const input = {
      analyteId: analyte?.id ?? 0,
      rawValue: value,
      unitId: unitId ? Number(unitId) : null,
      refRaw: reference || null,
      note: note || null,
    }
    try {
      if (row) await api.orders.updateResult(row.id, input)
      else await api.orders.addResult(edit.orderId, input)
      onDone()
    } catch (error) {
      notifyError(error)
    }
  }

  return (
    <Stack>
      {row ? (
        edit.imported && (
          <Text size="sm" c="dimmed">
            Результат пришёл из лаборатории: исправленное значение останется, даже если лаборатория пришлёт
            его снова.
          </Text>
        )
      ) : (
        <AnalytePicker
          label="Показатель"
          value={analyte}
          onChange={(picked) => {
            setAnalyte(picked)
            setUnitId(null)
          }}
          autoFocus
        />
      )}
      <SimpleGrid cols={2}>
        <TextInput
          label="Значение"
          placeholder={VALUE_PLACEHOLDER}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          autoFocus={row !== null}
        />
        <Select
          label="Единица"
          placeholder="—"
          clearable
          data={unitOptions}
          value={unitId}
          onChange={setUnitId}
        />
      </SimpleGrid>
      <TextInput
        label="Референс из бланка"
        placeholder="3,9–5,5"
        value={reference}
        onChange={(e) => setReference(e.currentTarget.value)}
      />
      <TextInput label="Заметка" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Отмена
        </Button>
        <Button onClick={() => void save()}>Сохранить</Button>
      </Group>
    </Stack>
  )
}
