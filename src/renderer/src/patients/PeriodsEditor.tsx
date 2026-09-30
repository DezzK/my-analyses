import { useState } from 'react'
import { ActionIcon, Alert, Button, Group, Paper, Select, Stack, Text, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import type { PatientPeriod, PatientPeriodInput } from '@shared/api'
import { PERIOD_KINDS, type PeriodKind } from '@shared/domain/enums'
import { api, errorMessage } from '../api'
import { formatDate } from '../format'
import { PERIOD_KIND_LABELS } from '../labels'
import { usePeriods } from '../queries'

function describe(period: PatientPeriod): string {
  const from = `с ${formatDate(period.startDate)}`
  if (period.kind === 'menopause') return from
  return period.endDate ? `${from} по ${formatDate(period.endDate)}` : `${from}, продолжается`
}

/** Pregnancy and menopause change which reference ranges apply, so they are dated here. */
export function PeriodsEditor({ patientId }: { patientId: number }) {
  const { data: periods = [] } = usePeriods(patientId)
  const [editing, setEditing] = useState<PatientPeriod | 'new' | null>(null)
  const remove = useMutation({ mutationFn: (id: number) => api.patients.removePeriod(id) })

  return (
    <Stack gap="xs">
      <Text fw={600}>Периоды</Text>
      <Text size="sm" c="dimmed">
        Беременность и менопауза меняют нормы: по датам периода приложение выберет подходящий референс.
      </Text>
      {periods.map((period) =>
        editing !== 'new' && editing?.id === period.id ? (
          <PeriodForm key={period.id} patientId={patientId} period={period} onDone={() => setEditing(null)} />
        ) : (
          <Paper key={period.id} withBorder px="sm" py={6}>
            <Group justify="space-between">
              <Text size="sm">
                <b>{PERIOD_KIND_LABELS[period.kind]}</b> {describe(period)}
              </Text>
              <Group gap={4}>
                <Tooltip label="Изменить">
                  <ActionIcon variant="subtle" color="gray" onClick={() => setEditing(period)}>
                    <IconPencil size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Удалить">
                  <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(period.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Paper>
        ),
      )}
      {editing === 'new' ? (
        <PeriodForm patientId={patientId} period={null} onDone={() => setEditing(null)} />
      ) : (
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => setEditing('new')}
          w="fit-content"
        >
          Добавить период
        </Button>
      )}
    </Stack>
  )
}

function PeriodForm({
  patientId,
  period,
  onDone,
}: {
  patientId: number
  period: PatientPeriod | null
  onDone(): void
}) {
  const [kind, setKind] = useState<PeriodKind>(period?.kind ?? 'pregnancy')
  const [startDate, setStartDate] = useState<string | null>(period?.startDate ?? null)
  const [endDate, setEndDate] = useState<string | null>(period?.endDate ?? null)
  const save = useMutation({
    mutationFn: (input: PatientPeriodInput) =>
      period ? api.patients.updatePeriod(period.id, input) : api.patients.addPeriod(patientId, input),
    onSuccess: onDone,
  })

  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group grow align="flex-end">
          <Select
            label="Период"
            data={PERIOD_KINDS.map((k) => ({ value: k, label: PERIOD_KIND_LABELS[k] }))}
            value={kind}
            onChange={(value) => value && setKind(value as PeriodKind)}
            allowDeselect={false}
          />
          <DateInput
            label={kind === 'pregnancy' ? 'Начало срока' : 'Начало'}
            description={kind === 'pregnancy' ? 'Первый день последней менструации' : undefined}
            valueFormat="DD.MM.YYYY"
            placeholder="ДД.ММ.ГГГГ"
            value={startDate}
            onChange={setStartDate}
          />
          {kind === 'pregnancy' && (
            <DateInput
              label="Окончание"
              description="Пусто, если продолжается"
              valueFormat="DD.MM.YYYY"
              placeholder="ДД.ММ.ГГГГ"
              clearable
              value={endDate}
              onChange={setEndDate}
            />
          )}
        </Group>
        {save.error && (
          <Alert color="red" variant="light" py={6}>
            {errorMessage(save.error)}
          </Alert>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" size="xs" onClick={onDone}>
            Отмена
          </Button>
          <Button
            size="xs"
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                kind,
                startDate: startDate ?? '',
                endDate: kind === 'pregnancy' ? endDate : null,
              })
            }
          >
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Paper>
  )
}
