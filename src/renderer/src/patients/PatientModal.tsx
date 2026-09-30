import { Button, Divider, Group, Modal, Stack, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconTrash } from '@tabler/icons-react'
import type { Patient } from '@shared/api'
import { api } from '../api'
import { plural } from '../format'
import { notifyError } from '../notify'
import { PatientForm } from './PatientForm'
import { PeriodsEditor } from './PeriodsEditor'
import { ICON_SIZE } from '../theme'

const UNDO_WINDOW_MS = 10_000

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
        const id = `removed-${patient.id}`
        notifications.show({
          id,
          autoClose: UNDO_WINDOW_MS,
          title: `Пациент «${patient.title}» удалён`,
          message: (
            <Button
              size="xs"
              variant="light"
              mt={4}
              onClick={() => {
                void api.patients.restore(patient.id)
                notifications.hide(id)
              }}
            >
              Отменить удаление
            </Button>
          ),
        })
      } catch (error) {
        notifyError(error)
      }
    },
  })
}
