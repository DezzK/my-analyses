import { ActionIcon, Alert, Button, Card, Group, Menu, Progress, Select, Stack, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import {
  IconDots,
  IconHistory,
  IconLogin2,
  IconPlugConnectedX,
  IconRefresh,
  IconUser,
} from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import type { Lab, LabAccount, SyncProgress } from '@shared/api'
import { api } from '../api'
import { LabMarker } from '../components/LabMarker'
import { formatDateTime } from '../format'
import { notifyError } from '../notify'
import { useCurrentPatient } from '../patients/current'
import { ICON_SIZE, TITLE_WEIGHT } from '../theme'
import { AccountPeople } from './AccountPeople'
import { describeProgress, describeStats } from './sync-text'
import { SyncHistory } from './SyncHistory'

/** A touch larger than in buttons: here the marker stands next to a title. */
const MARKER_SIZE = 14
const PERCENT = 100

export function AccountCard({
  account,
  lab,
  progress,
}: {
  account: LabAccount
  lab: Lab | undefined
  progress: SyncProgress | undefined
}) {
  const { patients } = useCurrentPatient()
  const sync = useMutation({ mutationFn: () => api.sync.account(account.id), onError: notifyError })
  const login = useMutation({ mutationFn: () => api.labs.login(account.id), onError: notifyError })
  const setPatient = useMutation({
    mutationFn: (patientId: number) => api.labs.setPatient(account.id, patientId),
    onError: notifyError,
  })
  const labName = lab?.name ?? ''
  const syncing = progress !== undefined || sync.isPending
  // Once the lab names whose each order is, the people decide and the account's patient does not.
  const namesPeople = account.people.length > 0 && account.patientId !== null

  return (
    <Card>
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap">
            {lab && <LabMarker color={lab.markerColor} shape={lab.markerShape} size={MARKER_SIZE} />}
            <div>
              <Text fw={TITLE_WEIGHT}>{labName}</Text>
              {account.label !== labName && (
                <Text size="sm" c="dimmed">
                  {account.label}
                </Text>
              )}
            </div>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {!namesPeople && (
              <Select
                aria-label="Чьи анализы"
                placeholder="Чьи анализы?"
                size="xs"
                w={180}
                leftSection={<IconUser size={ICON_SIZE.button} />}
                data={patients.map((p) => ({ value: String(p.id), label: p.title }))}
                value={account.patientId === null ? null : String(account.patientId)}
                onChange={(value) => value && setPatient.mutate(Number(value))}
                allowDeselect={false}
              />
            )}
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={ICON_SIZE.button} />}
              loading={syncing}
              disabled={account.patientId === null}
              onClick={() => sync.mutate()}
            >
              Обновить
            </Button>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Действия с кабинетом">
                  <IconDots size={ICON_SIZE.button} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconLogin2 size={ICON_SIZE.button} />}
                  onClick={() => login.mutate()}
                >
                  Войти заново
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconHistory size={ICON_SIZE.button} />}
                  onClick={() =>
                    modals.open({
                      title: `История обновлений: ${account.label}`,
                      size: 'lg',
                      children: <SyncHistory accountId={account.id} />,
                    })
                  }
                >
                  История обновлений
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconPlugConnectedX size={ICON_SIZE.button} />}
                  disabled={syncing}
                  onClick={() => confirmDisconnect(account, labName)}
                >
                  Отключить
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
        {account.people.length > 0 && <AccountPeople account={account} />}
        <AccountStatus
          account={account}
          progress={progress}
          onLogin={() => login.mutate()}
          loggingIn={login.isPending}
        />
      </Stack>
    </Card>
  )
}

function AccountStatus({
  account,
  progress,
  onLogin,
  loggingIn,
}: {
  account: LabAccount
  progress: SyncProgress | undefined
  onLogin: () => void
  loggingIn: boolean
}) {
  if (progress) {
    const determinate = progress.total > 0
    return (
      <Stack gap={6}>
        <Text size="sm">{describeProgress(progress)}</Text>
        <Progress
          size="sm"
          value={determinate ? (progress.done / progress.total) * PERCENT : PERCENT}
          striped={!determinate}
          animated={!determinate}
        />
      </Stack>
    )
  }
  if (account.patientId === null) {
    return (
      <Alert color="yellow" variant="light">
        Выберите, чьи анализы хранятся в этом кабинете: загруженные заказы попадут к этому человеку.
      </Alert>
    )
  }
  const run = account.lastRun
  if (!run) {
    return (
      <Text size="sm" c="dimmed">
        Ещё не обновлялся
      </Text>
    )
  }
  switch (run.status) {
    case 'ok':
      return (
        <Text size="sm" c="dimmed">
          Обновлено {formatDateTime(run.finishedAt ?? run.startedAt)} · {describeStats(run.stats)}
        </Text>
      )
    case 'running':
      return (
        <Text size="sm" c="dimmed">
          Идёт обновление…
        </Text>
      )
    case 'login_required':
      return (
        <Alert color="yellow" variant="light" title="Нужно снова войти в кабинет">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              Лаборатория завершила сессию. Войдите на её сайте, как при подключении: пароль приложение не
              видит и не хранит.
            </Text>
            <Button
              size="xs"
              leftSection={<IconLogin2 size={ICON_SIZE.button} />}
              loading={loggingIn}
              onClick={onLogin}
            >
              Войти
            </Button>
          </Stack>
        </Alert>
      )
    case 'blocked':
      return (
        <Alert color="red" variant="light" title="Сайт лаборатории не пустил приложение">
          Так бывает, когда включён VPN или компьютер находится не в России. Отключите VPN и нажмите
          «Обновить».
        </Alert>
      )
    case 'error':
      return (
        <Alert color="red" variant="light" title="Не удалось обновить">
          <Text size="sm">
            Попробуйте ещё раз позже. Если ошибка повторяется, сайт лаборатории мог измениться.
          </Text>
          {run.error && (
            <Text size="xs" c="dimmed" mt={4}>
              {run.error}
            </Text>
          )}
        </Alert>
      )
  }
}

function confirmDisconnect(account: LabAccount, labName: string): void {
  modals.openConfirmModal({
    title: 'Отключить кабинет?',
    children: (
      <Text size="sm">
        Приложение забудет вход в кабинет {labName} «{account.label}». Уже загруженные анализы останутся.
      </Text>
    ),
    labels: { confirm: 'Отключить', cancel: 'Отмена' },
    confirmProps: { color: 'red' },
    onConfirm: () => {
      api.labs.disconnect(account.id).catch(notifyError)
    },
  })
}
