import { Alert, Button, Group, Radio, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMutation } from '@tanstack/react-query'
import type { Patient, PatientInput } from '@shared/api'
import { SEXES, type Sex } from '@shared/domain/enums'
import { api, errorMessage } from '../api'
import { SEX_LABELS } from '../labels'
import { DateField } from '../components/DateField'

interface FormValues {
  title: string
  sex: Sex | ''
  birthDate: string | null
  note: string
}

interface Props {
  initial?: Patient
  submitLabel: string
  onSaved(patient: Patient): void
  onCancel?(): void
}

/** Collects the fields; PatientService decides whether they are acceptable. */
export function PatientForm({ initial, submitLabel, onSaved, onCancel }: Props) {
  const form = useForm<FormValues>({
    initialValues: {
      title: initial?.title ?? '',
      sex: initial?.sex ?? '',
      birthDate: initial?.birthDate ?? null,
      note: initial?.note ?? '',
    },
  })
  const save = useMutation({
    mutationFn: (input: PatientInput) =>
      initial ? api.patients.update(initial.id, input) : api.patients.create(input),
    onSuccess: onSaved,
  })

  const submit = form.onSubmit((values) =>
    save.mutate({
      title: values.title,
      sex: values.sex as Sex,
      birthDate: values.birthDate ?? '',
      note: values.note || null,
    }),
  )

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <TextInput
          label="Имя"
          description="Так пациент будет подписан в приложении и в отчётах"
          placeholder="Например, Маша"
          data-autofocus
          {...form.getInputProps('title')}
        />
        <Radio.Group label="Пол" {...form.getInputProps('sex')}>
          <Group mt={6}>
            {SEXES.map((sex) => (
              <Radio key={sex} value={sex} label={SEX_LABELS[sex]} />
            ))}
          </Group>
        </Radio.Group>
        <DateField label="Дата рождения" {...form.getInputProps('birthDate')} />
        <Textarea label="Заметка" autosize minRows={2} maxRows={6} {...form.getInputProps('note')} />
        {save.error && (
          <Alert color="red" variant="light">
            {errorMessage(save.error)}
          </Alert>
        )}
        <Group justify="flex-end">
          {onCancel && (
            <Button variant="default" onClick={onCancel}>
              Отмена
            </Button>
          )}
          <Button type="submit" loading={save.isPending}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
