import { Alert, Button, Group, Select, Stack, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import { useMutation } from '@tanstack/react-query'
import type { AccountPerson, LabAccount, Patient } from '@shared/api'
import { api } from '../api'
import { formatDate, plural } from '../format'
import { ORDER_FORMS } from '../labels'
import { notifyError } from '../notify'
import { useCurrentPatient } from '../patients/current'

/** The choice that keeps a person's orders out of the app. */
const KEEP_OUT = 'keep-out'
const SELECT_WIDTH = 180

function isWaiting(person: AccountPerson): boolean {
  return person.patientId === null && !person.skipped
}

/**
 * The people a lab names as owners of the account's orders, each with the patient their orders go
 * to. Nobody is assumed: a person waits, and so do their orders, until someone chooses.
 */
export function AccountPeople({ account }: { account: LabAccount }) {
  const { patients } = useCurrentPatient()
  const assign = useMutation({
    mutationFn: ({ personId, patientId }: { personId: number; patientId: number | null }) =>
      api.labs.assignPerson(personId, patientId),
    onError: notifyError,
  })

  const choose = (person: AccountPerson, patientId: number | null) => {
    if (patientId !== null || person.importedCount === 0) {
      assign.mutate({ personId: person.id, patientId })
      return
    }
    const count = person.importedCount
    modals.openConfirmModal({
      title: 'Не загружать анализы этого человека?',
      children: (
        <Text size="sm">
          {`Из приложения удалятся уже загруженные заказы человека «${person.name}»: ${count} ${plural(count, ORDER_FORMS)}. Новые загружаться не будут.`}
        </Text>
      ),
      labels: { confirm: 'Не загружать', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => assign.mutate({ personId: person.id, patientId }),
    })
  }

  return (
    <Stack gap="xs">
      {account.people.some(isWaiting) && (
        <Alert color="yellow" variant="light" title="Чьи это анализы?">
          В кабинете есть заказы людей, для которых не выбран пациент. Выберите, к кому их загрузить, или «Не
          загружать»: до этого их заказы ждут.
        </Alert>
      )}
      {account.people.map((person) => (
        <PersonRow
          key={person.id}
          person={person}
          patients={patients}
          busy={assign.isPending}
          onChoose={(patientId) => choose(person, patientId)}
        />
      ))}
    </Stack>
  )
}

function PersonRow({
  person,
  patients,
  busy,
  onChoose,
}: {
  person: AccountPerson
  patients: Patient[]
  busy: boolean
  onChoose: (patientId: number | null) => void
}) {
  const suggested = isWaiting(person) ? patients.find((p) => p.id === person.suggestedPatientId) : undefined
  const details = [
    person.birthDate && `род. ${formatDate(person.birthDate)}`,
    `${person.orderCount} ${plural(person.orderCount, ORDER_FORMS)}`,
  ]
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <div>
        <Text size="sm">{person.name}</Text>
        <Text size="xs" c="dimmed">
          {details.filter(Boolean).join(' · ')}
        </Text>
      </div>
      <Group gap="xs" wrap="nowrap">
        {suggested && (
          <Button size="xs" variant="light" disabled={busy} onClick={() => onChoose(suggested.id)}>
            Это {suggested.title}
          </Button>
        )}
        <Select
          aria-label={`Чьи анализы: ${person.name}`}
          placeholder="Выберите пациента"
          size="xs"
          w={SELECT_WIDTH}
          disabled={busy}
          data={[
            ...patients.map((p) => ({ value: String(p.id), label: p.title })),
            { value: KEEP_OUT, label: 'Не загружать' },
          ]}
          value={person.skipped ? KEEP_OUT : person.patientId === null ? null : String(person.patientId)}
          onChange={(value) => value && onChoose(value === KEEP_OUT ? null : Number(value))}
          allowDeselect={false}
        />
      </Group>
    </Group>
  )
}
