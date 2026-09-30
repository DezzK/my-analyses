import { useEffect, useState } from 'react'
import { Button, Group, Loader, Modal, Select, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation } from '@tanstack/react-query'
import type { Lab } from '@shared/api'
import { api } from '../api'
import { notifyError } from '../notify'
import { useCurrentPatient } from '../patients/current'
import { TITLE_WEIGHT } from '../theme'

/**
 * Connecting an account: the person picks whose results it holds, then logs in on the lab's own
 * site in a window of the app. The window closes by itself once they are in.
 */
export function ConnectModal({ lab, onClose }: { lab: Lab | null; onClose: () => void }) {
  const { patient, patients } = useCurrentPatient()
  const [patientId, setPatientId] = useState<string | null>(null)
  useEffect(() => setPatientId(patient ? String(patient.id) : null), [lab, patient])

  const connect = useMutation({
    mutationFn: ({ labId, forPatient }: { labId: number; forPatient: number }) =>
      api.labs.connect(labId, forPatient),
    onSuccess: (account) => {
      if (!account) {
        notifications.show({ message: 'Подключение отменено: окно сайта закрыли до входа в кабинет' })
        return
      }
      notifications.show({ color: 'teal', message: `Кабинет «${account.label}» подключён, загружаю анализы` })
      onClose()
    },
    onError: notifyError,
  })

  return (
    <Modal
      opened={lab !== null}
      onClose={onClose}
      closeOnClickOutside={!connect.isPending}
      withCloseButton={!connect.isPending}
      closeOnEscape={!connect.isPending}
      title={`Подключить кабинет ${lab?.name ?? ''}`}
    >
      {connect.isPending ? (
        <Stack align="center" ta="center" gap="sm" py="md">
          <Loader />
          <Text fw={TITLE_WEIGHT}>Ждём входа в личный кабинет</Text>
          <Text size="sm" c="dimmed">
            Войдите на сайте в открывшемся окне. Когда вход выполнится, окно закроется само. Чтобы отменить
            подключение, просто закройте его.
          </Text>
        </Stack>
      ) : (
        <Stack>
          <Select
            label="Чьи анализы в этом кабинете"
            data={patients.map((p) => ({ value: String(p.id), label: p.title }))}
            value={patientId}
            onChange={setPatientId}
            allowDeselect={false}
          />
          <Text size="sm">
            Откроется окно сайта {lab?.name}. Войдите в личный кабинет как обычно, например по номеру телефона
            и коду из SMS.
          </Text>
          <Text size="sm" c="dimmed">
            Приложение не видит и не хранит пароль: оно читает анализы в кабинете, пока вы в него вошли. Вход
            запоминается, дальше достаточно нажимать «Обновить».
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button
              disabled={!lab || patientId === null}
              onClick={() => lab && connect.mutate({ labId: lab.id, forPatient: Number(patientId) })}
            >
              Открыть сайт {lab?.name}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
