import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconArrowMerge, IconChartLine, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { AnalyteCard, ReferenceRule, Unit } from '@shared/api'
import { ageInDays } from '@shared/domain/age'
import { conditionsOn } from '@shared/domain/conditions'
import { todayIso } from '@shared/domain/dates'
import { chooseRule } from '@shared/domain/references'
import { api } from '../api'
import { AnalytePicker } from '../components/AnalytePicker'
import { ButtonLink } from '../components/links'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { formatDate, formatDateTime, plural } from '../format'
import { decimalText, NOT_A_NUMBER, readDecimal } from '../input'
import { CONDITION_LABELS, SEX_LABELS, SPECIMEN_LABELS } from '../labels'
import { notifyError, notifyUndoable } from '../notify'
import { useCurrentPatient } from '../patients/current'
import {
  useAnalyteCard,
  useLabMap,
  useLabReferences,
  useLabs,
  useMerges,
  usePeriods,
  useRules,
  useUnits,
} from '../queries'
import { LabName } from '../results/ResultsTable'
import { ICON_SIZE } from '../theme'
import { AnalyteForm } from './AnalyteForm'
import { RuleForm, type RuleDraft } from './RuleForm'
import { agesText, normText } from './rule-text'

export function AnalyteCardPage() {
  const { analyteId } = useParams({ from: '/catalog/$analyteId' })
  const { data: card, isLoading, isError } = useAnalyteCard(Number(analyteId))

  if (isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }
  if (isError || !card) {
    return (
      <EmptyState
        icon={IconArrowMerge}
        title="Показателя больше нет"
        description="Его объединили с другим показателем или удалили."
      />
    )
  }
  return <CardView card={card} />
}

function CardView({ card }: { card: AnalyteCard }) {
  const [merging, setMerging] = useState(false)
  return (
    <>
      <PageHeader
        title={
          <Group gap="sm">
            {card.name}
            {card.specimen && (
              <Badge variant="light" color="gray" size="lg">
                {SPECIMEN_LABELS[card.specimen]}
              </Badge>
            )}
            {!card.reviewed && (
              <Badge variant="light" color="yellow" size="lg">
                не проверен
              </Badge>
            )}
          </Group>
        }
        subtitle={`${card.resultCount} ${plural(card.resultCount, ['результат', 'результата', 'результатов'])} у всех пациентов`}
        actions={
          <>
            <ButtonLink
              variant="default"
              leftSection={<IconChartLine size={ICON_SIZE.button} />}
              to="/analytes/$analyteId"
              params={{ analyteId: String(card.id) }}
            >
              Результаты
            </ButtonLink>
            <Button
              variant="default"
              leftSection={<IconArrowMerge size={ICON_SIZE.button} />}
              onClick={() => setMerging(true)}
            >
              Объединить с…
            </Button>
          </>
        }
      />
      <Stack gap="lg">
        <Card>
          <Title order={4} mb="md">
            Основное
          </Title>
          <AnalyteForm card={card} />
        </Card>
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <AliasesCard card={card} />
          <UnitsCard card={card} />
        </SimpleGrid>
        <RulesCard card={card} />
        <MergesCard analyteId={card.id} />
      </Stack>
      <MergeModal card={card} opened={merging} onClose={() => setMerging(false)} />
    </>
  )
}

function AliasesCard({ card }: { card: AnalyteCard }) {
  const labs = useLabMap()
  const [alias, setAlias] = useState('')
  const add = async () => {
    try {
      await api.analytes.addAlias(card.id, alias)
      setAlias('')
    } catch (error) {
      notifyError(error)
    }
  }
  return (
    <Card>
      <Title order={4} mb="xs">
        Синонимы и коды лабораторий
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        По ним работает поиск; по кодам импорт узнаёт показатель.
      </Text>
      <Stack gap={6} mb="md">
        {card.aliases.map((a) => (
          <Group key={a.id} justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <Text size="sm">{a.alias}</Text>
              {a.labCode && (
                <Badge variant="outline" color="gray" size="sm">
                  {labs.get(a.labId ?? -1)?.name} {a.labCode}
                </Badge>
              )}
            </Group>
            {!a.labCode && (
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Убрать синоним"
                onClick={() => api.analytes.removeAlias(a.id).catch(notifyError)}
              >
                <IconX size={ICON_SIZE.small} />
              </ActionIcon>
            )}
          </Group>
        ))}
      </Stack>
      <Group gap="xs" wrap="nowrap">
        <TextInput
          placeholder="Новый синоним, например TSH"
          value={alias}
          onChange={(e) => setAlias(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          style={{ flex: 1 }}
        />
        <Button variant="light" onClick={() => void add()} disabled={!alias.trim()}>
          Добавить
        </Button>
      </Group>
    </Card>
  )
}

function UnitsCard({ card }: { card: AnalyteCard }) {
  const units = useUnits()
  const [adding, setAdding] = useState<string | null>(null)
  const allowed = new Set(card.units.map((u) => u.unitId))
  const choices = [...units.values()]
    .filter((u) => !allowed.has(u.id))
    .map((u) => ({ value: String(u.id), label: u.display }))

  return (
    <Card>
      <Title order={4} mb="xs">
        Единицы
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Коэффициент нужен, только если единицу нельзя пересчитать в основную ни по размерности, ни через
        молярную массу: значение × коэффициент = значение в основной единице.
      </Text>
      <Table verticalSpacing={6}>
        <Table.Tbody>
          {card.units.map((u) => (
            <UnitRow
              key={u.unitId}
              card={card}
              unitId={u.unitId}
              factor={u.factor}
              resultCount={u.resultCount}
              units={units}
            />
          ))}
        </Table.Tbody>
      </Table>
      <Group gap="xs" mt="md" wrap="nowrap">
        <Select
          placeholder="Добавить единицу"
          searchable
          data={choices}
          value={adding}
          onChange={setAdding}
          style={{ flex: 1 }}
        />
        <Button
          variant="light"
          disabled={!adding}
          onClick={() => {
            if (!adding) return
            api.analytes
              .setUnit(card.id, Number(adding), null)
              .then(() => setAdding(null))
              .catch(notifyError)
          }}
        >
          Добавить
        </Button>
      </Group>
    </Card>
  )
}

function UnitRow({
  card,
  unitId,
  factor,
  resultCount,
  units,
}: {
  card: AnalyteCard
  unitId: number
  factor: number | null
  resultCount: number
  units: ReadonlyMap<number, Unit>
}) {
  const [text, setText] = useState(decimalText(factor))
  const [error, setError] = useState<string | undefined>()
  const canonical = card.canonicalUnitId === unitId
  const saveFactor = () => {
    const value = readDecimal(text)
    if (value === undefined) {
      setError(NOT_A_NUMBER)
      return
    }
    setError(undefined)
    if (value !== factor) api.analytes.setUnit(card.id, unitId, value).catch(notifyError)
  }
  return (
    <Table.Tr>
      <Table.Td>
        <Group gap="xs">
          <Text size="sm">{units.get(unitId)?.display}</Text>
          {canonical && (
            <Badge size="sm" variant="light">
              основная
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td w={150}>
        {!canonical && (
          <TextInput
            size="xs"
            placeholder="без коэффициента"
            aria-label="Коэффициент"
            value={text}
            error={error}
            onChange={(e) => setText(e.currentTarget.value)}
            onBlur={saveFactor}
          />
        )}
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed" className="nowrap">
          {resultCount} {plural(resultCount, ['результат', 'результата', 'результатов'])}
        </Text>
      </Table.Td>
      <Table.Td w={40}>
        {!canonical && resultCount === 0 && (
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Убрать единицу"
            onClick={() => api.analytes.removeUnit(card.id, unitId).catch(notifyError)}
          >
            <IconX size={ICON_SIZE.small} />
          </ActionIcon>
        )}
      </Table.Td>
    </Table.Tr>
  )
}

/** A lab id no rule names: choosing for it falls through to the general rules. */
const NO_LAB = -1

/** Which of the rules would set the norm for the current patient today, per lab and in general. */
function useRulesForPatientToday(rules: ReferenceRule[]): Set<number> {
  const { patient } = useCurrentPatient()
  const { data: periods = [] } = usePeriods(patient?.id ?? null)
  return useMemo(() => {
    const chosen = new Set<number>()
    if (!patient) return chosen
    const today = todayIso()
    const context = {
      sex: patient.sex,
      ageDays: ageInDays(patient.birthDate, today),
      conditions: conditionsOn(today, periods, null),
    }
    const labIds = new Set(rules.flatMap((r) => (r.labId === null ? [] : [r.labId])))
    for (const labId of [NO_LAB, ...labIds]) {
      const pick = chooseRule(rules, { ...context, labId })
      if (pick) chosen.add(pick.rule.id)
    }
    return chosen
  }, [patient, periods, rules])
}

function RulesCard({ card }: { card: AnalyteCard }) {
  const { data: rules = [] } = useRules(card.id)
  const { data: references = [] } = useLabReferences(card.id)
  const { data: labList = [] } = useLabs()
  const labs = useLabMap()
  const units = useUnits()
  const { patient } = useCurrentPatient()
  const applying = useRulesForPatientToday(rules)
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const unitList = card.units.flatMap((u) => units.get(u.unitId) ?? [])

  const remove = (rule: ReferenceRule) =>
    modals.openConfirmModal({
      title: 'Удалить правило?',
      children: <Text size="sm">Норма {normText(rule)} больше не будет применяться к результатам.</Text>,
      labels: { confirm: 'Удалить', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        api.rules.remove(rule.id).catch(notifyError)
      },
    })

  return (
    <Card>
      <Group justify="space-between" mb="xs">
        <Title order={4}>Правила референсов</Title>
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={ICON_SIZE.small} />}
          onClick={() => setDraft({})}
        >
          Добавить правило
        </Button>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Применяются, когда лаборатория не прислала референс вместе с результатом. Из подходящих берётся самое
        точное: с условием, с полом, с самым узким возрастом; правило лаборатории — раньше общего.
      </Text>
      {rules.length === 0 ? (
        <Text size="sm">Правил пока нет.</Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table className="tabular" verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Лаборатория</Table.Th>
                <Table.Th>Пол</Table.Th>
                <Table.Th>Возраст</Table.Th>
                <Table.Th>Условие</Table.Th>
                <Table.Th>Норма</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rules.map((rule) => (
                <Table.Tr key={rule.id}>
                  <Table.Td>
                    {rule.labId === null ? 'Общее' : <LabName lab={labs.get(rule.labId)} />}
                  </Table.Td>
                  <Table.Td>{rule.sex ? SEX_LABELS[rule.sex] : 'Любой'}</Table.Td>
                  <Table.Td>{agesText(rule)}</Table.Td>
                  <Table.Td>{rule.condition ? CONDITION_LABELS[rule.condition] : '—'}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Text span className="nowrap">
                        {normText(rule)} {rule.unitId !== null ? units.get(rule.unitId)?.display : ''}
                      </Text>
                      {applying.has(rule.id) && patient && (
                        <Tooltip label="По этому правилу сейчас оцениваются результаты выбранного пациента">
                          <Badge size="sm" variant="light" color="teal">
                            {patient.title}
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td w={80}>
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label="Изменить правило"
                        onClick={() => setDraft(rule)}
                      >
                        <IconPencil size={ICON_SIZE.button} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label="Удалить правило"
                        onClick={() => remove(rule)}
                      >
                        <IconTrash size={ICON_SIZE.button} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {references.length > 0 && (
        <>
          <Title order={5} mt="lg" mb="xs">
            Референсы, которые присылали лаборатории
          </Title>
          <Stack gap={6}>
            {references.map((ref) => (
              <Group key={`${ref.labId}:${ref.text}:${ref.unitId}`} justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap">
                  <LabName lab={labs.get(ref.labId)} />
                  <Text size="sm">{ref.text}</Text>
                  <Text size="xs" c="dimmed" className="nowrap">
                    {ref.count} {plural(ref.count, ['раз', 'раза', 'раз'])}, последний{' '}
                    {formatDate(ref.lastCollectedOn)}
                  </Text>
                </Group>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() =>
                    setDraft({
                      labId: ref.labId,
                      low: ref.low,
                      high: ref.high,
                      expected: ref.expected,
                      unitId: ref.unitId,
                    })
                  }
                >
                  Создать правило
                </Button>
              </Group>
            ))}
          </Stack>
        </>
      )}
      <RuleForm
        analyteId={card.id}
        draft={draft}
        labs={labList}
        units={unitList}
        onClose={() => setDraft(null)}
      />
    </Card>
  )
}

function MergesCard({ analyteId }: { analyteId: number }) {
  const { data: merges = [] } = useMerges(analyteId)
  if (merges.length === 0) return null
  return (
    <Card>
      <Title order={4} mb="xs">
        Объединённые показатели
      </Title>
      <Stack gap={6}>
        {merges.map((merge) => (
          <Group key={merge.id} justify="space-between">
            <Text size="sm">
              {merge.sourceName}{' '}
              <Text span size="xs" c="dimmed">
                {formatDateTime(merge.createdAt)}
              </Text>
            </Text>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => api.analytes.unmerge(merge.id).catch(notifyError)}
            >
              Разъединить
            </Button>
          </Group>
        ))}
      </Stack>
    </Card>
  )
}

function MergeModal({ card, opened, onClose }: { card: AnalyteCard; opened: boolean; onClose: () => void }) {
  const [target, setTarget] = useState<{ id: number; name: string } | null>(null)
  const navigate = useNavigate()
  const merge = async () => {
    if (!target) return
    try {
      const mergeId = await api.analytes.merge(card.id, target.id)
      onClose()
      void navigate({ to: '/catalog/$analyteId', params: { analyteId: String(target.id) } })
      notifyUndoable({
        title: `«${card.name}» объединён с «${target.name}»`,
        undoLabel: 'Отменить объединение',
        undo: () => api.analytes.unmerge(mergeId),
      })
    } catch (error) {
      notifyError(error)
    }
  }
  return (
    <Modal opened={opened} onClose={onClose} title={`Объединить «${card.name}»`}>
      <Stack>
        <Text size="sm">
          Результаты, синонимы, коды лабораторий и правила этого показателя перейдут в выбранный, а сам он
          исчезнет. Объединение можно отменить.
        </Text>
        <AnalytePicker
          label="С каким показателем"
          value={target}
          onChange={setTarget}
          exclude={[card.id]}
          autoFocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!target} onClick={() => void merge()}>
            Объединить
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
