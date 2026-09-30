import { Button, Divider, Group, Modal, Stack, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconTrash } from '@tabler/icons-react'
import type { Patient } from '@shared/api'
import { api } from '../api'
import { plural } from '../format'
import { notifyError, notifyUndoable } from '../notify'
import { PatientForm } from './PatientForm'
import { PeriodsEditor } from './PeriodsEditor'
import { ICON_SIZE } from '../theme'

interface Props {
  opened: boolean
  /** Null to create a new patient. */
  patient: Patient | null
  onClose(): void
  onCreated?(patient: Patient): void
}

export function PatientModal({ opened, patient, onClose, onCreated }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={patient ? `Пациент: ${patient.title}` : 'Новый пациент'}
      size="lg"
    >
      <Stack gap="lg">
        <PatientForm
          key={patient?.id ?? 'new'}
          initial={patient ?? undefined}
          submitLabel={patient ? 'Сохранить' : 'Добавить'}
          onSaved={(saved) => {
            if (!patient) onCreated?.(saved)
            onClose()
          }}
          onCancel={onClose}
        />
        {patient?.sex === 'female' && (
          <>
            <Divider />
            <PeriodsEditor patientId={patient.id} />
          </>
        )}
        {patient && (
          <>
            <Divider />
            <Group>
              <Button
                variant="subtle"
                color="red"
                leftSection={<IconTrash size={ICON_SIZE.button} />}
                onClick={() => confirmRemoval(patient, onClose)}
              >
                Удалить пациента
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  )
}

async function confirmRemoval(patient: Patient, onRemoved: () => void): Promise<void> {
  const orders = await api.patients.orderCount(patient.id)
  modals.openConfirmModal({
    title: `Удалить пациента «${patient.title}»?`,
    children: (
      <Text size="sm">
        {orders > 0
          ? `Вместе с пациентом удалятся ${orders} ${plural(orders, ['заказ', 'заказа', 'заказов'])} с результатами.`
          : 'У пациента нет заказов.'}{' '}
        Удаление можно отменить сразу после него.
      </Text>
    ),
    labels: { confirm: 'Удалить', cancel: 'Отмена' },
    confirmProps: { color: 'red' },
    onConfirm: async () => {
      try {
        await api.patients.remove(patient.id)
        onRemoved()
        notifyUndoable({
          title: `Пациент «${patient.title}» удалён`,
          undoLabel: 'Отменить удаление',
          undo: () => api.patients.restore(patient.id),
        })
      } catch (error) {
        notifyError(error)
      }
    },
  })
}
