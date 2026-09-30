import { Button, Group } from '@mantine/core'
import { IconFlask } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { formatAge, formatDate } from '../format'
import { SEX_LABELS } from '../labels'
import { useCurrentPatient } from '../patients/current'

export function OverviewPage() {
  const { patient } = useCurrentPatient()
  if (!patient) return null
  return (
    <>
      <PageHeader
        title={patient.title}
        subtitle={`${SEX_LABELS[patient.sex]}, ${formatAge(patient.birthDate)}, дата рождения ${formatDate(patient.birthDate)}`}
      />
      <EmptyState
        icon={IconFlask}
        title="Пока нет результатов"
        description="Подключите личный кабинет лаборатории — приложение заберёт всю историю анализов. Старые бланки можно внести вручную."
      >
        <Group mt="xs">
          <Button component={Link} to="/labs">
            Подключить лабораторию
          </Button>
          <Button component={Link} to="/orders" variant="default">
            Внести вручную
          </Button>
        </Group>
      </EmptyState>
    </>
  )
}
