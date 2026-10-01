import { useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Input,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import {
  IconArrowDown,
  IconArrowUp,
  IconDeviceFloppy,
  IconFileTypePdf,
  IconPageBreak,
  IconPrinter,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import type { Patient, ReportBlock, ReportSpec, ReportTemplate } from '@shared/api'
import { REPORT_CHARTS_PER_ROW, REPORT_VIEWS, type ReportView } from '@shared/domain/enums'
import { formatDateRu, todayIso } from '@shared/domain/dates'
import { api } from '../api'
import { PERIOD_LABELS, periodStart, PERIODS, type Period } from '../analytes/periods'
import { AnalytePicker } from '../components/AnalytePicker'
import { PageHeader } from '../components/PageHeader'
import { notifyError } from '../notify'
import { useCurrentPatient } from '../patients/current'
import { useCatalog, usePanels, useReportTemplates } from '../queries'
import { ICON_SIZE } from '../theme'
import { useReportDraft, withAnalytes, type ReportDraft } from './draft'
import { ReportDocument } from './ReportDocument'

const VIEW_LABELS: Record<ReportView, string> = { table: 'Таблица', chart: 'График', both: 'Оба' }

function specOf(draft: ReportDraft, patient: Patient): ReportSpec {
  return {
    patientId: patient.id,
    from: periodStart(draft.period),
    to: null,
    blocks: draft.blocks,
    layout: draft.layout,
  }
}

/** "Анализы — Анна — 30.09.2026.pdf": what the saved file is called unless the person renames it. */
function fileName(patient: Patient): string {
  return `Анализы — ${patient.title} — ${formatDateRu(todayIso())}.pdf`
}

/**
 * Builds a report from blocks — an analyte as a table, a chart or both — over a period, for the
 * current patient. A template keeps the blocks for any patient; the report goes to PDF, which is
 * also what gets printed.
 */
export function ReportsPage() {
  const { patient } = useCurrentPatient()
  const [draft, setDraft] = useReportDraft()
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  if (!patient) return null
  const spec = specOf(draft, patient)
  const run = async (what: 'preview' | 'save') => {
    setBusy(what)
    try {
      if (what === 'preview') await api.reports.preview(spec)
      else await api.reports.savePdf(spec, fileName(patient))
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Отчёты"
        subtitle="Таблицы и графики выбранных показателей для врача: на печать или в PDF"
        actions={
          <>
            <Button
              variant="default"
              leftSection={<IconFileTypePdf size={ICON_SIZE.button} />}
              loading={busy === 'save'}
              disabled={draft.blocks.length === 0}
              onClick={() => void run('save')}
            >
              Сохранить PDF…
            </Button>
            <Button
              leftSection={<IconPrinter size={ICON_SIZE.button} />}
              loading={busy === 'preview'}
              disabled={draft.blocks.length === 0}
              onClick={() => void run('preview')}
            >
              Предпросмотр и печать
            </Button>
          </>
        }
      />
      <Group align="flex-start" gap="lg" wrap="nowrap">
        <Stack gap="lg" w={420} style={{ flex: 'none' }}>
          <TemplatesCard draft={draft} onApply={setDraft} />
          <BlocksCard draft={draft} onChange={setDraft} />
        </Stack>
        <Card component="section" aria-label="Предпросмотр отчёта" style={{ flex: 1, minWidth: 0 }}>
          {draft.blocks.length === 0 ? (
            <Text c="dimmed" size="sm">
              Добавьте показатели слева или нажмите «В отчёт» на странице показателя.
            </Text>
          ) : (
            <FitToWidth>
              <ReportDocument spec={spec} patient={patient} />
            </FitToWidth>
          )}
        </Card>
      </Group>
    </>
  )
}

/**
 * The report laid out at its width on paper and scaled down to the space it has, the way a page
 * is previewed: a scale leaves the layout, and so the charts' size, exactly as printed.
 */
function FitToWidth({ children }: { children: ReactNode }) {
  const frame = useElementSize()
  const page = useElementSize()
  const scale = page.width > 0 ? Math.min(1, frame.width / page.width) : 1
  return (
    <div ref={frame.ref} style={{ height: page.height * scale, overflow: 'hidden' }}>
      <div
        ref={page.ref}
        style={{ width: 'fit-content', transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {children}
      </div>
    </div>
  )
}

function BlocksCard({ draft, onChange }: { draft: ReportDraft; onChange: (draft: ReportDraft) => void }) {
  const { data: panels = [] } = usePanels()
  const { data: catalog = [] } = useCatalog()
  const names = new Map(catalog.map((entry) => [entry.id, entry.name]))
  const setBlocks = (blocks: ReportBlock[]) => onChange({ ...draft, blocks })
  const patch = (index: number, change: Partial<ReportBlock>) =>
    setBlocks(draft.blocks.map((block, i) => (i === index ? { ...block, ...change } : block)))
  const move = (index: number, by: number) => {
    const blocks = [...draft.blocks]
    const [block] = blocks.splice(index, 1)
    if (block) blocks.splice(index + by, 0, block)
    setBlocks(blocks)
  }

  return (
    <Card>
      <Stack gap="md">
        <SimpleGrid cols={2}>
          <Input.Wrapper label="Период">
            <div>
              <SegmentedControl
                size="xs"
                value={draft.period}
                onChange={(period) => onChange({ ...draft, period: period as Period })}
                data={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
              />
            </div>
          </Input.Wrapper>
          <Input.Wrapper label="Графиков в ряд">
            <div>
              <SegmentedControl
                size="xs"
                value={String(draft.layout.chartsPerRow)}
                onChange={(value) => {
                  const chartsPerRow = REPORT_CHARTS_PER_ROW.find((n) => String(n) === value)
                  if (chartsPerRow) onChange({ ...draft, layout: { ...draft.layout, chartsPerRow } })
                }}
                data={REPORT_CHARTS_PER_ROW.map(String)}
              />
            </div>
          </Input.Wrapper>
        </SimpleGrid>
        <Title order={5}>Показатели</Title>
        {draft.blocks.map((block, index) => (
          <Stack key={block.analyteId} gap={6}>
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" truncate>
                {index + 1}. {names.get(block.analyteId) ?? '…'}
              </Text>
              <Group gap={2} wrap="nowrap">
                <Tooltip label={block.breakAfter ? 'Убрать разрыв страницы' : 'Разрыв страницы после блока'}>
                  <ActionIcon
                    variant={block.breakAfter ? 'light' : 'subtle'}
                    color={block.breakAfter ? undefined : 'gray'}
                    aria-label="Разрыв страницы"
                    onClick={() => patch(index, { breakAfter: !block.breakAfter })}
                  >
                    <IconPageBreak size={ICON_SIZE.small} />
                  </ActionIcon>
                </Tooltip>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Выше"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <IconArrowUp size={ICON_SIZE.small} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Ниже"
                  disabled={index === draft.blocks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <IconArrowDown size={ICON_SIZE.small} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Убрать из отчёта"
                  onClick={() => setBlocks(draft.blocks.filter((_, i) => i !== index))}
                >
                  <IconX size={ICON_SIZE.small} />
                </ActionIcon>
              </Group>
            </Group>
            <SegmentedControl
              size="xs"
              value={block.view}
              onChange={(view) => patch(index, { view: view as ReportView })}
              data={REPORT_VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view] }))}
            />
          </Stack>
        ))}
        <AnalytePicker
          placeholder="Добавить показатель"
          value={null}
          exclude={draft.blocks.map((block) => block.analyteId)}
          onChange={(picked) => picked && onChange(withAnalytes(draft, [picked.id]))}
        />
        {panels.length > 0 && (
          <Select
            placeholder="Добавить набор"
            value={null}
            searchable
            data={panels.map((panel) => ({ value: String(panel.id), label: panel.name }))}
            onChange={(picked) => {
              const panel = panels.find((p) => String(p.id) === picked)
              if (panel) onChange(withAnalytes(draft, panel.analyteIds))
            }}
          />
        )}
      </Stack>
    </Card>
  )
}

function TemplatesCard({ draft, onApply }: { draft: ReportDraft; onApply: (draft: ReportDraft) => void }) {
  const { data: templates = [] } = useReportTemplates()
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const template = templates.find((t) => String(t.id) === selected)
  const remove = (t: ReportTemplate) =>
    modals.openConfirmModal({
      title: `Удалить шаблон «${t.title}»?`,
      children: <Text size="sm">Отчёты, уже сохранённые в PDF, останутся.</Text>,
      labels: { confirm: 'Удалить', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        api.reports
          .removeTemplate(t.id)
          .then(() => setSelected(null))
          .catch(notifyError)
      },
    })

  return (
    <Card>
      <Stack gap="sm">
        <Title order={5}>Шаблон</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            placeholder={templates.length ? 'Выберите шаблон' : 'Шаблонов пока нет'}
            data={templates.map((t) => ({ value: String(t.id), label: t.title }))}
            value={selected}
            onChange={setSelected}
            style={{ flex: 1 }}
          />
          <Button
            variant="light"
            disabled={!template}
            onClick={() =>
              template && onApply({ ...draft, blocks: template.blocks, layout: template.layout })
            }
          >
            Применить
          </Button>
          {template && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              aria-label="Удалить шаблон"
              onClick={() => remove(template)}
            >
              <IconTrash size={ICON_SIZE.button} />
            </ActionIcon>
          )}
        </Group>
        <Button
          variant="subtle"
          leftSection={<IconDeviceFloppy size={ICON_SIZE.button} />}
          disabled={draft.blocks.length === 0}
          onClick={() => setSaving(true)}
        >
          Сохранить отчёт как шаблон
        </Button>
      </Stack>
      <SaveTemplateModal
        opened={saving}
        draft={draft}
        template={template ?? null}
        onClose={() => setSaving(false)}
        onSaved={(saved) => {
          setSaving(false)
          setSelected(String(saved.id))
        }}
      />
    </Card>
  )
}

function SaveTemplateModal({
  opened,
  draft,
  template,
  onClose,
  onSaved,
}: {
  opened: boolean
  draft: ReportDraft
  template: ReportTemplate | null
  onClose: () => void
  onSaved: (template: ReportTemplate) => void
}) {
  const [title, setTitle] = useState('')
  const save = (templateId: number | null, name: string) =>
    api.reports.saveTemplate(templateId, name, draft.blocks, draft.layout).then(onSaved).catch(notifyError)
  return (
    <Modal opened={opened} onClose={onClose} title="Шаблон отчёта">
      <Stack>
        <TextInput
          label="Название"
          placeholder="Для эндокринолога"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          {template && (
            <Button variant="default" onClick={() => void save(template.id, template.title)}>
              Обновить «{template.title}»
            </Button>
          )}
          <Button onClick={() => void save(null, title)}>Сохранить новый</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
