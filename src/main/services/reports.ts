import { asc, eq } from 'drizzle-orm'
import type { ReportBlock, ReportLayout, ReportSpec, ReportTemplate } from '@shared/api'
import { REPORT_CHARTS_PER_ROW, REPORT_VIEWS } from '@shared/domain/enums'
import { compareRussian, foldCase } from '@shared/domain/text'
import { UserError } from '@shared/errors'
import { DEFAULT_REPORT_LAYOUT } from '@shared/report'
import type { Db } from '../db/client'
import { reportBlock, reportTemplate } from '../db/schema'
import { inTransaction } from '../db/transaction'
import { dataChanged, type EventSink } from '../events'
import type { AnalyteService } from './analytes'
import type { PatientService } from './patients'
import { typedName } from './validation'

/**
 * Owner of report templates: blocks and layout saved under a name, to build the same report for
 * any patient; and of what a report must satisfy to be built.
 */
export class ReportService {
  constructor(
    private readonly deps: {
      db: Db
      analytes: AnalyteService
      patients: PatientService
      events: EventSink
    },
  ) {}

  templates(): ReportTemplate[] {
    const { db } = this.deps
    const blocks = Map.groupBy(
      db.select().from(reportBlock).orderBy(asc(reportBlock.position)).all(),
      (block) => block.templateId,
    )
    return db
      .select()
      .from(reportTemplate)
      .all()
      .sort((a, b) => compareRussian(a.title, b.title))
      .map((row) => ({
        id: row.id,
        title: row.title,
        blocks: (blocks.get(row.id) ?? []).map(({ analyteId, view, breakAfter }) => ({
          analyteId,
          view,
          breakAfter,
        })),
        layout: { ...DEFAULT_REPORT_LAYOUT, ...(JSON.parse(row.layout) as Partial<ReportLayout>) },
      }))
  }

  /** Creates a template (`templateId` null) or replaces a template's title, blocks and layout. */
  saveTemplate(
    templateId: number | null,
    title: string,
    blocks: ReportBlock[],
    layout: ReportLayout,
  ): ReportTemplate {
    const name = typedName(title, 'Введите название шаблона')
    this.checkBlocks(blocks, layout)
    const taken = this.templates().some((t) => t.id !== templateId && foldCase(t.title) === foldCase(name))
    if (taken) throw new UserError('Шаблон с таким названием уже есть')

    const { db } = this.deps
    const values = { title: name, layout: JSON.stringify({ chartsPerRow: layout.chartsPerRow }) }
    const id = inTransaction(db, () => {
      const saved =
        templateId === null
          ? db.insert(reportTemplate).values(values).returning({ id: reportTemplate.id }).get().id
          : this.find(templateId)
      if (templateId !== null) {
        db.update(reportTemplate)
          .set({ ...values, updatedAt: new Date().toISOString() })
          .where(eq(reportTemplate.id, saved))
          .run()
        db.delete(reportBlock).where(eq(reportBlock.templateId, saved)).run()
      }
      db.insert(reportBlock)
        .values(
          blocks.map((block, position) => ({
            templateId: saved,
            analyteId: block.analyteId,
            position,
            view: block.view,
            breakAfter: Boolean(block.breakAfter),
          })),
        )
        .run()
      return saved
    })
    dataChanged(this.deps.events, 'reports')
    const template = this.templates().find((t) => t.id === id)
    if (!template) throw new UserError('Шаблон не найден')
    return template
  }

  removeTemplate(templateId: number): void {
    this.find(templateId)
    this.deps.db.delete(reportTemplate).where(eq(reportTemplate.id, templateId)).run()
    dataChanged(this.deps.events, 'reports')
  }

  /** Refuses a report that cannot be built: an unknown patient, a period that ends before it starts. */
  checkSpec(spec: ReportSpec): void {
    this.deps.patients.get(spec.patientId)
    if (spec.from !== null && spec.to !== null && spec.from > spec.to) {
      throw new UserError('Период отчёта заканчивается раньше, чем начинается')
    }
    this.checkBlocks(spec.blocks, spec.layout)
  }

  /** A report shows analytes that exist, each once and in a known way, in a known layout. */
  private checkBlocks(blocks: readonly ReportBlock[], layout: ReportLayout): void {
    if (blocks.length === 0) throw new UserError('Добавьте в отчёт хотя бы один показатель')
    const ids = blocks.map((block) => block.analyteId)
    if (new Set(ids).size !== ids.length) throw new UserError('Показатель уже есть в отчёте')
    for (const block of blocks) {
      this.deps.analytes.find(block.analyteId)
      if (!REPORT_VIEWS.includes(block.view)) throw new UserError('Неизвестный вид блока')
    }
    if (!REPORT_CHARTS_PER_ROW.includes(layout.chartsPerRow)) {
      throw new UserError(`Графиков в ряд — ${REPORT_CHARTS_PER_ROW.join(' или ')}`)
    }
  }

  private find(templateId: number): number {
    const row = this.deps.db
      .select({ id: reportTemplate.id })
      .from(reportTemplate)
      .where(eq(reportTemplate.id, templateId))
      .get()
    if (!row) throw new UserError('Шаблон не найден')
    return row.id
  }
}
