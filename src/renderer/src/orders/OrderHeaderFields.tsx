import { useState } from 'react'
import { Button, Group, Input, Modal, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { IconPaperclip, IconX } from '@tabler/icons-react'
import type { OrderDetails, OrderInput, Patient } from '@shared/api'
import { CYCLE_PHASES, type CyclePhase } from '@shared/domain/enums'
import { api } from '../api'
import { DateField } from '../components/DateField'
import { CYCLE_PHASE_LABELS } from '../labels'
import { notifyError } from '../notify'
import { useLabs } from '../queries'
import { ICON_SIZE } from '../theme'

/** The order's own fields while they are being typed. */
export interface HeaderValues {
  labId: string | null
  collectedOn: string | null
  collectedTime: string
  cyclePhase: string | null
  note: string
  form: { key: string; name: string } | null
}

const NEW_LAB = 'new-lab'
const ATTACHED = 'бланк приложен'

export function emptyHeader(): HeaderValues {
  return { labId: null, collectedOn: null, collectedTime: '', cyclePhase: null, note: '', form: null }
}

export function headerOf(order: OrderDetails): HeaderValues {
  return {
    labId: String(order.labId),
    collectedOn: order.collectedOn,
    collectedTime: order.collectedTime ?? '',
    cyclePhase: order.cyclePhase,
    note: order.note ?? '',
    form: order.formFile ? { key: order.formFile, name: ATTACHED } : null,
  }
}

/** The fields as the API takes them; what is missing is the main process's to point out. */
export function orderInput(values: HeaderValues, patientId: number): OrderInput {
  return {
    patientId,
    labId: values.labId ? Number(values.labId) : 0,
    collectedOn: values.collectedOn ?? '',
    collectedTime: values.collectedTime || null,
    cyclePhase: (values.cyclePhase as CyclePhase | null) ?? null,
    note: values.note || null,
    formFile: values.form?.key ?? null,
  }
}

export function OrderHeaderFields({
  values,
  onChange,
  patient,
}: {
  values: HeaderValues
  onChange: (values: HeaderValues) => void
  patient: Patient
}) {
  const { data: labs = [] } = useLabs()
  const [addingLab, setAddingLab] = useState(false)
  const set = (patch: Partial<HeaderValues>) => onChange({ ...values, ...patch })
  const attach = () =>
    api.forms
      .pick()
      .then((form) => form && set({ form }))
      .catch(notifyError)

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Select
          label="Лаборатория"
          placeholder="Выберите"
          searchable
          data={[
            ...labs.map((lab) => ({ value: String(lab.id), label: lab.name })),
            { value: NEW_LAB, label: 'Новая лаборатория…' },
          ]}
          value={values.labId}
          onChange={(labId) => (labId === NEW_LAB ? setAddingLab(true) : set({ labId }))}
        />
        <DateField
          label="Дата сдачи"
          value={values.collectedOn}
          onChange={(collectedOn) => set({ collectedOn })}
        />
        <TimeInput
          label="Время сдачи"
          description="если известно"
          value={values.collectedTime}
          onChange={(e) => set({ collectedTime: e.currentTarget.value })}
        />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {patient.sex === 'female' && (
          <Select
            label="Фаза цикла"
            description="влияет на нормы гормонов"
            placeholder="Не указана"
            clearable
            data={CYCLE_PHASES.map((p) => ({ value: p, label: CYCLE_PHASE_LABELS[p] }))}
            value={values.cyclePhase}
            onChange={(cyclePhase) => set({ cyclePhase })}
          />
        )}
        <TextInput
          label="Заметка"
          placeholder="натощак, на фоне лечения…"
          value={values.note}
          onChange={(e) => set({ note: e.currentTarget.value })}
        />
        <Input.Wrapper label="Бланк" description="PDF или фотография">
          <Group gap="xs" mt={4} wrap="nowrap">
            {values.form ? (
              <>
                <Text size="sm" truncate>
                  {values.form.name}
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconX size={ICON_SIZE.small} />}
                  onClick={() => set({ form: null })}
                >
                  Убрать
                </Button>
              </>
            ) : (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPaperclip size={ICON_SIZE.small} />}
                onClick={() => void attach()}
              >
                Приложить
              </Button>
            )}
          </Group>
        </Input.Wrapper>
      </SimpleGrid>
      <NewLabModal
        opened={addingLab}
        onClose={() => setAddingLab(false)}
        onCreated={(labId) => {
          setAddingLab(false)
          set({ labId: String(labId) })
        }}
      />
    </Stack>
  )
}

function NewLabModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean
  onClose: () => void
  onCreated: (labId: number) => void
}) {
  const [name, setName] = useState('')
  const create = () =>
    api.labs
      .create(name)
      .then((lab) => {
        setName('')
        onCreated(lab.id)
      })
      .catch(notifyError)
  return (
    <Modal opened={opened} onClose={onClose} title="Новая лаборатория">
      <Stack>
        <TextInput
          label="Название"
          placeholder="Лаборатория в поликлинике"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void create()}>Добавить</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
