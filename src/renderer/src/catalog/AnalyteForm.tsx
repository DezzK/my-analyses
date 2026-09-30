import { useEffect } from 'react'
import {
  Button,
  Group,
  Input,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { AnalyteCard, AnalyteInput, AnalyteSummary } from '@shared/api'
import { SPECIMENS, VALUE_KINDS, type Specimen, type ValueKind } from '@shared/domain/enums'
import { api } from '../api'
import { decimalText, NOT_A_NUMBER, readDecimal } from '../input'
import { SPECIMEN_LABELS, VALUE_KIND_LABELS } from '../labels'
import { notifyError } from '../notify'
import { useUnits } from '../queries'

interface Values {
  name: string
  specimen: string
  valueKind: ValueKind
  description: string
  molarMass: string
  canonicalUnitId: string
  reviewed: boolean
}

function valuesOf(card: AnalyteCard | null, initialName = ''): Values {
  return {
    name: card?.name ?? initialName,
    specimen: card?.specimen ?? '',
    valueKind: card?.valueKind ?? 'numeric',
    description: card?.description ?? '',
    molarMass: decimalText(card?.molarMass ?? null),
    canonicalUnitId: card?.canonicalUnitId === null || !card ? '' : String(card.canonicalUnitId),
    reviewed: card?.reviewed ?? true,
  }
}

/**
 * The analyte's own fields. With `card` it edits that analyte and offers its units as the
 * canonical one; without, it creates an analyte, and any unit may become its first.
 */
export function AnalyteForm({
  card,
  initialName,
  onSaved,
}: {
  card: AnalyteCard | null
  initialName?: string
  onSaved?: (analyte: AnalyteSummary | null) => void
}) {
  const units = useUnits()
  const form = useForm<Values>({ initialValues: valuesOf(card, initialName) })
  // A new version of the card (after any save) resets the form to it.
  useEffect(() => {
    form.setValues(valuesOf(card, initialName))
    form.resetDirty(valuesOf(card, initialName))
  }, [card, initialName])

  const unitChoices = (card ? card.units.map((u) => u.unitId) : [...units.keys()]).flatMap((id) => {
    const unit = units.get(id)
    return unit ? [{ value: String(id), label: unit.display }] : []
  })

  const submit = form.onSubmit(async (values) => {
    const molarMass = readDecimal(values.molarMass)
    if (molarMass === undefined) {
      form.setFieldError('molarMass', NOT_A_NUMBER)
      return
    }
    const input: AnalyteInput = {
      name: values.name,
      specimen: (values.specimen || null) as Specimen | null,
      valueKind: values.valueKind,
      description: values.description,
      molarMass,
      canonicalUnitId: values.canonicalUnitId ? Number(values.canonicalUnitId) : null,
      reviewed: values.reviewed,
    }
    try {
      if (card) {
        await api.analytes.update(card.id, input)
        notifications.show({ message: 'Сохранено' })
        onSaved?.(null)
      } else {
        onSaved?.(await api.analytes.create(input))
      }
    } catch (error) {
      notifyError(error)
    }
  })

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <TextInput label="Название" required {...form.getInputProps('name')} />
          <Select
            label="Биоматериал"
            placeholder="Не указан"
            clearable
            data={SPECIMENS.map((s) => ({ value: s, label: SPECIMEN_LABELS[s] }))}
            {...form.getInputProps('specimen')}
          />
        </SimpleGrid>
        <Input.Wrapper label="Значение">
          <div>
            <SegmentedControl
              data={VALUE_KINDS.map((k) => ({ value: k, label: VALUE_KIND_LABELS[k] }))}
              {...form.getInputProps('valueKind')}
            />
          </div>
        </Input.Wrapper>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Select
            label={card ? 'Основная единица' : 'Единица'}
            description={card ? 'К ней пересчитываются остальные единицы' : undefined}
            placeholder="Без единицы"
            searchable
            clearable
            data={unitChoices}
            {...form.getInputProps('canonicalUnitId')}
          />
          <TextInput
            label="Молярная масса, г/моль"
            description="Нужна для пересчёта ммоль/л ↔ мг/дл"
            {...form.getInputProps('molarMass')}
          />
        </SimpleGrid>
        <Textarea label="Описание" autosize minRows={2} {...form.getInputProps('description')} />
        <Group justify="space-between">
          <Switch label="Проверен" {...form.getInputProps('reviewed', { type: 'checkbox' })} />
          <Button type="submit" disabled={card !== null && !form.isDirty()}>
            {card ? 'Сохранить' : 'Создать'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
