import { useState } from 'react'
import {
  Button,
  Group,
  Input,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  TextInput,
} from '@mantine/core'
import type { Lab, RuleInput, Unit } from '@shared/api'
import { AGE_UNITS, ageToDays, daysToAge, type AgeUnit } from '@shared/domain/age'
import { REFERENCE_CONDITIONS, SEXES, type ReferenceCondition, type Sex } from '@shared/domain/enums'
import { QUALITATIVE_CODES, type QualitativeCode } from '@shared/domain/values'
import { api } from '../api'
import { plural } from '../format'
import { decimalText, NOT_A_NUMBER, readDecimal } from '../input'
import { AGE_UNIT_FORMS, CONDITION_LABELS, QUALITATIVE_LABELS, SEX_LABELS } from '../labels'
import { notifyError } from '../notify'

/** What a rule prescribes: bounds of a number, or the answer expected of a qualitative test. */
type Norm = 'bounds' | 'expected'
const ANY = ''

interface AgeLimit {
  value: number | ''
  unit: AgeUnit
}

function limitOf(days: number | null): AgeLimit {
  return days === null ? { value: '', unit: 'years' } : daysToAge(days)
}

function daysOf(limit: AgeLimit): number | null {
  return limit.value === '' ? null : ageToDays(limit.value, limit.unit)
}

/** The fields a rule starts with: an existing rule, or a lab's reference turned into one. */
export type RuleDraft = Partial<RuleInput> & { id?: number }

/**
 * Edits one reference rule. The main process judges the rule (overlaps, units, conditions);
 * this only turns what was typed into numbers.
 */
export function RuleForm({
  analyteId,
  draft,
  labs,
  units,
  onClose,
}: {
  analyteId: number
  draft: RuleDraft | null
  labs: Lab[]
  units: Unit[]
  onClose: () => void
}) {
  return (
    <Modal
      opened={draft !== null}
      onClose={onClose}
      title={draft?.id ? 'Правило референса' : 'Новое правило'}
      size="lg"
    >
      {draft && <RuleFields analyteId={analyteId} draft={draft} labs={labs} units={units} onDone={onClose} />}
    </Modal>
  )
}

function RuleFields({
  analyteId,
  draft,
  labs,
  units,
  onDone,
}: {
  analyteId: number
  draft: RuleDraft
  labs: Lab[]
  units: Unit[]
  onDone: () => void
}) {
  const [labId, setLabId] = useState(
    draft.labId === undefined || draft.labId === null ? ANY : String(draft.labId),
  )
  const [sex, setSex] = useState<string>(draft.sex ?? ANY)
  const [from, setFrom] = useState(limitOf(draft.ageFromDays ?? null))
  const [to, setTo] = useState(limitOf(draft.ageToDays ?? null))
  const [condition, setCondition] = useState<string>(draft.condition ?? ANY)
  const [norm, setNorm] = useState<Norm>(draft.expected ? 'expected' : 'bounds')
  const [low, setLow] = useState(decimalText(draft.low ?? null))
  const [high, setHigh] = useState(decimalText(draft.high ?? null))
  const [unitId, setUnitId] = useState(
    draft.unitId ? String(draft.unitId) : units[0] ? String(units[0].id) : ANY,
  )
  const [expected, setExpected] = useState<string>(draft.expected ?? QUALITATIVE_CODES[0])
  const [note, setNote] = useState(draft.note ?? '')
  const [errors, setErrors] = useState<{ low?: string; high?: string }>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const lowValue = norm === 'bounds' ? readDecimal(low) : null
    const highValue = norm === 'bounds' ? readDecimal(high) : null
    const typos = {
      low: lowValue === undefined ? NOT_A_NUMBER : undefined,
      high: highValue === undefined ? NOT_A_NUMBER : undefined,
    }
    setErrors(typos)
    if (typos.low || typos.high) return
    const input: RuleInput = {
      labId: labId === ANY ? null : Number(labId),
      sex: sex === ANY ? null : (sex as Sex),
      ageFromDays: daysOf(from),
      ageToDays: daysOf(to),
      condition: condition === ANY ? null : (condition as ReferenceCondition),
      low: lowValue ?? null,
      high: highValue ?? null,
      expected: norm === 'expected' ? (expected as QualitativeCode) : null,
      unitId: unitId === ANY ? null : Number(unitId),
      note,
    }
    setSaving(true)
    try {
      if (draft.id) await api.rules.update(draft.id, input)
      else await api.rules.create(analyteId, input)
      onDone()
    } catch (error) {
      notifyError(error)
    } finally {
      setSaving(false)
    }
  }

  const ageField = (label: string, limit: AgeLimit, onChange: (limit: AgeLimit) => void) => (
    <Input.Wrapper label={label}>
      <Group gap="xs" wrap="nowrap">
        <NumberInput
          aria-label={label}
          placeholder="—"
          min={0}
          allowDecimal={false}
          value={limit.value}
          onChange={(value) => onChange({ ...limit, value: typeof value === 'number' ? value : '' })}
          style={{ flex: 1 }}
        />
        <Select
          aria-label={`${label}, единица`}
          w={120}
          allowDeselect={false}
          value={limit.unit}
          onChange={(unit) => unit && onChange({ ...limit, unit: unit as AgeUnit })}
          data={AGE_UNITS.map((u) => ({
            value: u,
            label: plural(limit.value === '' ? 0 : limit.value, AGE_UNIT_FORMS[u]),
          }))}
        />
      </Group>
    </Input.Wrapper>
  )

  return (
    <Stack gap="md">
      <SimpleGrid cols={2}>
        <Select
          label="Лаборатория"
          allowDeselect={false}
          value={labId}
          onChange={(value) => setLabId(value ?? ANY)}
          data={[
            { value: ANY, label: 'Общее правило' },
            ...labs.map((lab) => ({ value: String(lab.id), label: lab.name })),
          ]}
        />
        <Input.Wrapper label="Пол">
          <div>
            <SegmentedControl
              value={sex}
              onChange={setSex}
              data={[
                { value: ANY, label: 'Любой' },
                ...SEXES.map((s) => ({ value: s, label: SEX_LABELS[s] })),
              ]}
            />
          </div>
        </Input.Wrapper>
      </SimpleGrid>
      <SimpleGrid cols={2}>
        {ageField('Возраст от', from, setFrom)}
        {ageField('Возраст до', to, setTo)}
      </SimpleGrid>
      <Select
        label="Условие сдачи"
        allowDeselect={false}
        value={condition}
        onChange={(value) => setCondition(value ?? ANY)}
        data={[
          { value: ANY, label: 'Без условия' },
          ...REFERENCE_CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] })),
        ]}
      />
      <Input.Wrapper label="Норма">
        <div>
          <SegmentedControl
            value={norm}
            onChange={(value) => setNorm(value as Norm)}
            data={[
              { value: 'bounds', label: 'Границы' },
              { value: 'expected', label: 'Ожидаемый ответ' },
            ]}
          />
        </div>
      </Input.Wrapper>
      {norm === 'bounds' ? (
        <SimpleGrid cols={3}>
          <TextInput
            label="Нижняя граница"
            placeholder="нет"
            value={low}
            error={errors.low}
            onChange={(e) => setLow(e.currentTarget.value)}
          />
          <TextInput
            label="Верхняя граница"
            placeholder="нет"
            value={high}
            error={errors.high}
            onChange={(e) => setHigh(e.currentTarget.value)}
          />
          <Select
            label="Единица"
            allowDeselect={false}
            value={unitId}
            onChange={(value) => setUnitId(value ?? ANY)}
            data={units.map((u) => ({ value: String(u.id), label: u.display }))}
          />
        </SimpleGrid>
      ) : (
        <Select
          label="Ожидаемый ответ"
          allowDeselect={false}
          value={expected}
          onChange={(value) => value && setExpected(value)}
          data={QUALITATIVE_CODES.map((c) => ({ value: c, label: QUALITATIVE_LABELS[c] }))}
        />
      )}
      <TextInput
        label="Заметка"
        placeholder="Метод, источник нормы"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Отмена
        </Button>
        <Button loading={saving} onClick={() => void save()}>
          Сохранить
        </Button>
      </Group>
    </Stack>
  )
}
