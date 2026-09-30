import { useState } from 'react'
import { Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { IconPlugConnected, IconRefresh } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import type { Lab } from '@shared/api'
import { api } from '../api'
import { EmptyState } from '../components/EmptyState'
import { LabMarker } from '../components/LabMarker'
import { PageHeader } from '../components/PageHeader'
import { notifyError } from '../notify'
import { useLabAccounts, useLabs, useSyncProgress } from '../queries'
import { AccountCard } from './AccountCard'
import { ConnectModal } from './ConnectModal'

const ICON_SIZE = 16

export function LabsPage() {
  const { data: labs = [] } = useLabs()
  const { data: accounts = [] } = useLabAccounts()
  const { data: progress = [] } = useSyncProgress()
  const [connecting, setConnecting] = useState<Lab | null>(null)
  const syncAll = useMutation({ mutationFn: () => api.sync.all(), onError: notifyError })
  const labsById = new Map(labs.map((lab) => [lab.id, lab]))

  return (
    <>
      <PageHeader
        title="Лаборатории"
        subtitle="Личные кабинеты, из которых приложение забирает результаты"
        actions={
          accounts.length > 0 && (
            <Button
              leftSection={<IconRefresh size={ICON_SIZE} />}
              loading={syncAll.isPending}
              onClick={() => syncAll.mutate()}
            >
              Обновить всё
            </Button>
          )
        }
      />
      <Stack gap="lg">
        {accounts.length === 0 ? (
          <EmptyState
            icon={IconPlugConnected}
            title="Кабинеты пока не подключены"
            description="Подключите личный кабинет лаборатории: приложение заберёт из него всю историю анализов, а потом будет догружать новые."
          />
        ) : (
          accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              lab={labsById.get(account.labId)}
              progress={progress.find((p) => p.accountId === account.id)}
            />
          ))
        )}
        <ConnectCard labs={labs.filter((lab) => lab.connectable)} onConnect={setConnecting} />
      </Stack>
      <ConnectModal lab={connecting} onClose={() => setConnecting(null)} />
    </>
  )
}

function ConnectCard({ labs, onConnect }: { labs: Lab[]; onConnect: (lab: Lab) => void }) {
  return (
    <Card>
      <Title order={4}>Подключить кабинет</Title>
      <Text size="sm" c="dimmed" mt={4}>
        Вы входите на сайте лаборатории в окне приложения, и оно загружает ваши заказы от вашего имени, как
        если бы вы открыли каждый из них сами.
      </Text>
      <Group mt="md" gap="sm">
        {labs.map((lab) => (
          <Button
            key={lab.id}
            variant="default"
            leftSection={<LabMarker color={lab.markerColor} shape={lab.markerShape} />}
            onClick={() => onConnect(lab)}
          >
            {lab.name}
          </Button>
        ))}
      </Group>
      <Text size="xs" c="dimmed" mt="md">
        Другие лаборатории появятся позже, а пока их бланки можно внести вручную.
      </Text>
    </Card>
  )
}
