import { Alert, Box, Button, Card, Center, Code, Group, Stack, Stepper, Text, Title } from '@mantine/core'
import { IconFolderOpen, IconHeartbeat } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import type { Patient } from '@shared/api'
import { api, errorMessage } from '../api'
import { PatientForm } from '../patients/PatientForm'
import { keys, queryClient, useSettings } from '../queries'
import { ICON_SIZE } from '../theme'

export type WelcomeStep = 'patient' | 'backups'

interface Props {
  step: WelcomeStep
  onPatientCreated(patient: Patient): void
  onFinished(): void
}

/** First run: the first patient, then where backups go. */
export function Welcome({ step, onPatientCreated, onFinished }: Props) {
  return (
    <Center mih="100vh" p="xl" className="drag-region">
      <Card w={560} shadow="md" className="no-drag">
        <Stack gap="lg">
          <Group gap="sm">
            <IconHeartbeat size={32} color="var(--mantine-color-teal-6)" />
            <div>
              <Title order={2}>Мои анализы</Title>
              <Text c="dimmed" size="sm">
                Результаты анализов всей семьи — в одном месте и только на этом компьютере.
              </Text>
            </div>
          </Group>
          <Stepper active={step === 'patient' ? 0 : 1} size="sm">
            <Stepper.Step label="Пациент" description="Чьи анализы храним">
              <Box pt="md">
                <PatientForm submitLabel="Продолжить" onSaved={onPatientCreated} />
              </Box>
            </Stepper.Step>
            <Stepper.Step label="Бэкапы" description="Где хранить копии">
              <BackupStep onFinished={onFinished} />
            </Stepper.Step>
          </Stepper>
        </Stack>
      </Card>
    </Center>
  )
}

function BackupStep({ onFinished }: { onFinished(): void }) {
  const { data: settings } = useSettings()
  const choose = useMutation({
    mutationFn: () => api.settings.chooseBackupDir(),
    onSuccess: (next) => next && queryClient.setQueryData(keys.settings(), next),
  })
  return (
    <Stack pt="md" gap="sm">
      <Text size="sm">
        Приложение само делает копии базы. Лучше всего хранить их в папке, которая синхронизируется с облаком
        (iCloud Drive, OneDrive, Яндекс Диск): тогда данные переживут даже поломку компьютера.
      </Text>
      <Text size="sm" c="dimmed">
        Сейчас копии сохраняются сюда:
      </Text>
      <Code block>{settings?.backupDir}</Code>
      {choose.error && <Alert color="red">{errorMessage(choose.error)}</Alert>}
      <Group justify="space-between" mt="xs">
        <Button
          variant="default"
          leftSection={<IconFolderOpen size={ICON_SIZE.button} />}
          onClick={() => choose.mutate()}
        >
          Выбрать папку…
        </Button>
        <Button onClick={onFinished}>{settings?.backupDirIsDefault ? 'Оставить как есть' : 'Готово'}</Button>
      </Group>
    </Stack>
  )
}
