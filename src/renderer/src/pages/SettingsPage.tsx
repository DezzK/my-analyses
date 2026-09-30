import { Alert, Button, Card, Code, Group, Stack, Table, Text, Title } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconCloudUpload, IconFolderOpen, IconHistory, IconRefresh } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import type { BackupInfo } from '@shared/api'
import { CHANGE_BACKUP_DELAY_MS, KEEP_RECENT } from '@shared/backup-policy'
import { api } from '../api'
import { PageHeader } from '../components/PageHeader'
import { formatBytes, formatDateTime, plural } from '../format'
import { BACKUP_REASON_LABELS } from '../labels'
import { notifyError } from '../notify'
import { keys, queryClient, useAppInfo, useBackups, useSettings, useUpdateStatus } from '../queries'
import { ICON_SIZE } from '../theme'
import { restartToUpdate, updateStatusText } from '../updates'

const MS_PER_SECOND = 1000

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Настройки" />
      <Stack gap="lg">
        <BackupsCard />
        <AboutCard />
      </Stack>
    </>
  )
}

function BackupsCard() {
  const { data: settings } = useSettings()
  const { data: backups = [] } = useBackups()
  const choose = useMutation({
    mutationFn: () => api.settings.chooseBackupDir(),
    onSuccess: (next) => next && queryClient.setQueryData(keys.settings(), next),
    onError: notifyError,
  })
  const create = useMutation({
    mutationFn: () => api.backups.create(),
    onSuccess: () => notifications.show({ message: 'Бэкап сохранён' }),
    onError: notifyError,
  })
  const delaySeconds = CHANGE_BACKUP_DELAY_MS / MS_PER_SECOND

  return (
    <Card>
      <Stack gap="md">
        <div>
          <Title order={4}>Бэкапы</Title>
          <Text size="sm" c="dimmed">
            Копия базы и оригиналов бланков сохраняется при запуске и через {delaySeconds}{' '}
            {plural(delaySeconds, ['секунду', 'секунды', 'секунд'])} после любых изменений. Хранятся последние{' '}
            {KEEP_RECENT} копий и по одной за каждый месяц.
          </Text>
        </div>
        <Group gap="xs">
          <Code style={{ flex: 1 }}>{settings?.backupDir}</Code>
          <Button
            variant="default"
            leftSection={<IconFolderOpen size={ICON_SIZE.button} />}
            onClick={() => choose.mutate()}
          >
            Изменить папку…
          </Button>
          <Button variant="default" onClick={() => void api.backups.reveal()}>
            Открыть
          </Button>
        </Group>
        {settings?.backupDirIsDefault && (
          <Alert color="yellow" variant="light" title="Бэкапы лежат рядом с базой">
            Если компьютер сломается, пропадут и база, и бэкапы. Выберите папку, которая синхронизируется с
            облаком: iCloud Drive, OneDrive или Яндекс Диск.
          </Alert>
        )}
        <BackupTable backups={backups} />
        <Group>
          <Button
            leftSection={<IconCloudUpload size={ICON_SIZE.button} />}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Сделать бэкап сейчас
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}

function BackupTable({ backups }: { backups: BackupInfo[] }) {
  if (backups.length === 0) return <Text size="sm">Бэкапов пока нет.</Text>
  return (
    <Table.ScrollContainer minWidth={520} maxHeight={320}>
      <Table striped highlightOnHover className="tabular">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Дата</Table.Th>
            <Table.Th>Когда сделан</Table.Th>
            <Table.Th>Размер</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {backups.map((backup) => (
            <Table.Tr key={backup.file}>
              <Table.Td>{formatDateTime(backup.createdAt)}</Table.Td>
              <Table.Td>{BACKUP_REASON_LABELS[backup.reason]}</Table.Td>
              <Table.Td>{formatBytes(backup.sizeBytes)}</Table.Td>
              <Table.Td ta="right">
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconHistory size={ICON_SIZE.small} />}
                  onClick={() => confirmRestore(backup)}
                >
                  Восстановить
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function confirmRestore(backup: BackupInfo): void {
  modals.openConfirmModal({
    title: 'Восстановить базу из бэкапа?',
    children: (
      <Text size="sm">
        База вернётся к состоянию на {formatDateTime(backup.createdAt)}. Текущая база сохранится отдельным
        бэкапом «Перед восстановлением», приложение перезапустится.
      </Text>
    ),
    labels: { confirm: 'Восстановить', cancel: 'Отмена' },
    onConfirm: async () => {
      try {
        await api.backups.restore(backup.file)
      } catch (error) {
        notifyError(error)
      }
    },
  })
}

function AboutCard() {
  const { data: info } = useAppInfo()
  const { data: status } = useUpdateStatus()
  const check = useMutation({ mutationFn: () => api.updates.check(), onError: notifyError })
  const text = status ? updateStatusText(status) : null
  return (
    <Card>
      <Title order={4} mb="xs">
        О приложении
      </Title>
      <Text size="sm">Версия {info?.version}</Text>
      {text && (
        <Text size="sm" c={status?.state === 'failed' ? 'red' : undefined}>
          {text}
        </Text>
      )}
      <Text size="sm" c="dimmed">
        Данные: <Code>{info?.dataDir}</Code>
      </Text>
      <Text size="sm" c="dimmed">
        Приложение не является медицинским изделием: оно не ставит диагнозов и не заменяет врача.
      </Text>
      {status && status.state !== 'disabled' && (
        <Group mt="sm">
          {status.state === 'ready' ? (
            <Button leftSection={<IconRefresh size={ICON_SIZE.button} />} onClick={restartToUpdate}>
              Перезапустить и обновить
            </Button>
          ) : (
            <Button
              variant="default"
              leftSection={<IconRefresh size={ICON_SIZE.button} />}
              loading={status.state === 'checking' || status.state === 'downloading' || check.isPending}
              onClick={() => check.mutate()}
            >
              Проверить обновления
            </Button>
          )}
        </Group>
      )}
    </Card>
  )
}
