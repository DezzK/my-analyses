import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type {
  AnalyteCard,
  AnalyteHit,
  AnalyteInput,
  AnalyteSummary,
  CatalogEntry,
  LabCode,
} from '@shared/api'
import { SPECIMENS, VALUE_KINDS, type Specimen, type ValueKind } from '@shared/domain/enums'
import { inferSpecimen } from '@shared/domain/specimens'
import { compareRussian, foldCase } from '@shared/domain/text'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { analyte, analyteAlias, analyteUnit, result, unit } from '../db/schema'
import { dataChanged, type EventSink } from '../events'
import { typedName } from './validation'

export type AnalyteRow = typeof analyte.$inferSelect
export type AnalyteAliasRow = typeof analyteAlias.$inferSelect

/** Enough hits to scroll through, few enough to show at once. */
const SEARCH_LIMIT = 50
/** Labs name their tests at length: «Антитела к тиреоидной пероксидазе (анти-ТПО), IgG». */
const MAX_ANALYTE_NAME_LENGTH = 120

/** The text the search index holds for an analyte, and the text a query is compared with. */
export function normalizeSearchText(text: string): string {
  return foldCase(text)
}

/** What a search looks for: what was typed, case and ё folded; empty when nothing was. */
export function searchNeedle(query: string): string {
  return normalizeSearchText(query).trim()
}

/** Whether a name, a synonym or a code holds what a search looks for, anywhere in it. */
export function holdsNeedle(text: string, needle: string): boolean {
  return normalizeSearchText(text).includes(needle)
}

/** The lab codes among aliases, each with its lab and analysis: what imports know an analyte by. */
export function labCodesOf(aliases: readonly AnalyteAliasRow[]): LabCode[] {
  return aliases.flatMap((alias) =>
    alias.labCode === null ? [] : [{ labId: alias.labId, code: alias.labCode, analysis: alias.analysis }],
  )
}

/** What a lab says of a test beyond its name: the analysis it is part of, and the specimen. */
export interface LabContext {
  analysis: string | null
  specimen: Specimen | null
}

/**
 * The specimen of a lab's test: what its name says, else what the lab says of the sample, else
 * what the name of its analysis says («Лейкоциты» of «Общий анализ мочи»).
 */
function specimenOfTest(name: string, context: LabContext): Specimen | null {
  return (
    inferSpecimen(name) ??
    context.specimen ??
    (context.analysis === null ? null : inferSpecimen(context.analysis))
  )
}

/** The unit an analyte is shown in: the one the person chose, else its canonical unit. */
export function shownUnitId(row: Pick<AnalyteRow, 'displayUnitId' | 'canonicalUnitId'>): number | null {
  return row.displayUnitId ?? row.canonicalUnitId
}

/** A LIKE pattern matching `needle` anywhere, with LIKE's own wildcards taken literally. */
function containing(needle: string): string {
  return `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Owner of analytes: their names, aliases, lab codes, allowed units and search index. */
export class AnalyteService {
  constructor(
    private readonly db: Db,
    private readonly events: EventSink,
  ) {}

  get(id: number): AnalyteRow | undefined {
    return this.db.select().from(analyte).where(eq(analyte.id, id)).get()
  }

  aliases(analyteIds: readonly number[]): AnalyteAliasRow[] {
    if (analyteIds.length === 0) return []
    return this.db
      .select()
      .from(analyteAlias)
      .where(inArray(analyteAlias.analyteId, [...analyteIds]))
      .all()
  }

  summary(id: number): AnalyteSummary {
    const row = this.find(id)
    return {
      id: row.id,
      name: row.name,
      specimen: row.specimen,
      description: row.description,
      valueKind: row.valueKind,
      reviewed: row.reviewed,
      aliases: this.aliases([id]).map(({ id: aliasId, alias, labId, labCode, analysis }) => ({
        id: aliasId,
        alias,
        labId,
        labCode,
        analysis,
      })),
    }
  }

  /** Every analyte, alphabetically, with how many results it has and the codes it is imported by. */
  list(): CatalogEntry[] {
    const counts = new Map(
      this.db
        .select({ analyteId: result.analyteId, n: count() })
        .from(result)
        .groupBy(result.analyteId)
        .all()
        .map((r) => [r.analyteId, r.n]),
    )
    const codes = Map.groupBy(
      this.db
        .select()
        .from(analyteAlias)
        .where(sql`${analyteAlias.labCode} is not null`)
        .all(),
      (a) => a.analyteId,
    )
    return this.db
      .select()
      .from(analyte)
      .all()
      .sort((a, b) => compareRussian(a.name, b.name))
      .map((row) => ({
        id: row.id,
        name: row.name,
        specimen: row.specimen,
        reviewed: row.reviewed,
        canonicalUnitId: row.canonicalUnitId,
        resultCount: counts.get(row.id) ?? 0,
        codes: labCodesOf(codes.get(row.id) ?? []),
      }))
  }

  card(id: number): AnalyteCard {
    const row = this.find(id)
    const perUnit = new Map(
      this.db
        .select({ unitId: result.unitId, n: count() })
        .from(result)
        .where(eq(result.analyteId, id))
        .groupBy(result.unitId)
        .all()
        .map((r) => [r.unitId, r.n]),
    )
    const units = this.db.select().from(analyteUnit).where(eq(analyteUnit.analyteId, id)).all()
    return {
      ...this.summary(id),
      canonicalUnitId: row.canonicalUnitId,
      displayUnitId: row.displayUnitId,
      shownUnitId: shownUnitId(row),
      molarMass: row.molarMass,
      resultCount: [...perUnit.values()].reduce((sum, n) => sum + n, 0),
      units: units.map((u) => ({
        unitId: u.unitId,
        factor: u.factor,
        resultCount: perUnit.get(u.unitId) ?? 0,
      })),
    }
  }

  /** An analyte the person adds by hand; it is reviewed by definition. */
  create(input: AnalyteInput): AnalyteSummary {
    const values = this.validate(input, null)
    const row = this.db
      .insert(analyte)
      .values({ ...values, reviewed: true })
      .returning()
      .get()
    if (row.canonicalUnitId !== null) this.allowUnit(row.id, row.canonicalUnitId)
    this.reindex(row.id)
    dataChanged(this.events, 'catalog')
    return this.summary(row.id)
  }

  update(id: number, input: AnalyteInput): void {
    const current = this.find(id)
    const values = this.validate(input, id)
    const factors = this.db
      .select()
      .from(analyteUnit)
      .where(and(eq(analyteUnit.analyteId, id), sql`${analyteUnit.factor} is not null`))
      .all()
    if (values.canonicalUnitId !== current.canonicalUnitId && factors.length > 0) {
      throw new UserError('Сначала уберите коэффициенты единиц: они заданы относительно основной единицы')
    }
    this.db.update(analyte).set(values).where(eq(analyte.id, id)).run()
    this.reindex(id)
    dataChanged(this.events, 'catalog')
  }

  addAlias(analyteId: number, alias: string): void {
    const text = alias.trim()
    if (!text) throw new UserError('Введите синоним')
    const row = this.find(analyteId)
    const taken = [row.name, ...this.aliases([analyteId]).map((a) => a.alias)].map(normalizeSearchText)
    if (taken.includes(normalizeSearchText(text))) throw new UserError('Такой синоним уже есть')
    this.db.insert(analyteAlias).values({ analyteId, alias: text }).run()
    this.reindex(analyteId)
    dataChanged(this.events, 'catalog')
  }

  removeAlias(aliasId: number): void {
    const row = this.db.select().from(analyteAlias).where(eq(analyteAlias.id, aliasId)).get()
    if (!row) throw new UserError('Синоним не найден')
    if (row.labCode !== null) {
      throw new UserError('Код лаборатории убрать нельзя: по нему импорт узнаёт показатель')
    }
    this.db.delete(analyteAlias).where(eq(analyteAlias.id, aliasId)).run()
    this.reindex(row.analyteId)
    dataChanged(this.events, 'catalog')
  }

  /**
   * Allows `unitId` for the analyte, or changes its factor: value × factor = value in the
   * canonical unit, for units whose dimension and the molar mass do not relate them.
   */
  setUnit(analyteId: number, unitId: number, factor: number | null): void {
    const row = this.find(analyteId)
    if (!this.db.select().from(unit).where(eq(unit.id, unitId)).get())
      throw new UserError('Единица не найдена')
    if (factor !== null && !(factor > 0)) throw new UserError('Коэффициент должен быть больше нуля')
    if (factor !== null && (row.canonicalUnitId === null || row.canonicalUnitId === unitId)) {
      throw new UserError('У основной единицы коэффициента нет')
    }
    this.db
      .insert(analyteUnit)
      .values({ analyteId, unitId, factor })
      .onConflictDoUpdate({ target: [analyteUnit.analyteId, analyteUnit.unitId], set: { factor } })
      .run()
    if (row.canonicalUnitId === null) {
      this.db.update(analyte).set({ canonicalUnitId: unitId }).where(eq(analyte.id, analyteId)).run()
    }
    dataChanged(this.events, 'catalog')
  }

  removeUnit(analyteId: number, unitId: number): void {
    const row = this.find(analyteId)
    if (row.canonicalUnitId === unitId) throw new UserError('Это основная единица показателя')
    const used = this.db
      .select({ n: count() })
      .from(result)
      .where(and(eq(result.analyteId, analyteId), eq(result.unitId, unitId)))
      .get()
    if ((used?.n ?? 0) > 0) throw new UserError('В этой единице есть результаты показателя')
    this.db
      .delete(analyteUnit)
      .where(and(eq(analyteUnit.analyteId, analyteId), eq(analyteUnit.unitId, unitId)))
      .run()
    if (row.displayUnitId === unitId) {
      this.db.update(analyte).set({ displayUnitId: null }).where(eq(analyte.id, analyteId)).run()
    }
    dataChanged(this.events, 'catalog')
  }

  find(id: number): AnalyteRow {
    const row = this.get(id)
    if (!row) throw new UserError('Показатель не найден')
    return row
  }

  private validate(input: AnalyteInput, id: number | null): AnalyteInput {
    const name = typedName(input.name, 'Введите название показателя', { maxLength: MAX_ANALYTE_NAME_LENGTH })
    if (input.specimen !== null && !SPECIMENS.includes(input.specimen))
      throw new UserError('Неизвестный биоматериал')
    if (!VALUE_KINDS.includes(input.valueKind)) throw new UserError('Неизвестный тип значения')
    if (input.molarMass !== null && !(input.molarMass > 0)) {
      throw new UserError('Молярная масса должна быть больше нуля')
    }
    if (input.canonicalUnitId !== null && id !== null) {
      const allowed = this.db
        .select()
        .from(analyteUnit)
        .where(and(eq(analyteUnit.analyteId, id), eq(analyteUnit.unitId, input.canonicalUnitId)))
        .get()
      if (!allowed) throw new UserError('Основной может быть только единица показателя')
    }
    return { ...input, name, description: input.description?.trim() || null }
  }

  /**
   * Analytes whose name, synonym or lab code contains the query, ignoring case and ё. Those the
   * patient has results for come first, most recently measured first.
   */
  search(query: string, patientId: number | null): AnalyteHit[] {
    const needle = searchNeedle(query)
    if (!needle) return []
    const rows = this.db.$client
      .prepare(
        `SELECT a.id AS id, a.name AS name, a.specimen AS specimen,
                count(o.id) AS resultCount, max(o.collected_on) AS lastCollectedOn
           FROM analyte_search s
           JOIN analyte a ON a.id = s.analyte_id
           LEFT JOIN result r ON r.analyte_id = a.id
           LEFT JOIN lab_order o ON o.id = r.order_id AND o.patient_id = ?
          WHERE s.text LIKE ? ESCAPE '\\'
          GROUP BY a.id
          ORDER BY lastCollectedOn DESC NULLS LAST, a.name
          LIMIT ?`,
      )
      .all(patientId, containing(needle), SEARCH_LIMIT) as {
      id: number
      name: string
      specimen: Specimen | null
      resultCount: number
      lastCollectedOn: string | null
    }[]
    const aliases = this.aliases(rows.map((r) => r.id))
    const matches = (text: string | null) => text !== null && holdsNeedle(text, needle)
    return rows.map((row) => {
      const own = aliases.filter((a) => a.analyteId === row.id)
      const matched = matches(row.name)
        ? null
        : (own.find((a) => matches(a.alias))?.alias ?? own.find((a) => matches(a.labCode))?.labCode ?? null)
      return { ...row, matched }
    })
  }

  /**
   * An analyte the built-in dictionary knows: it leaves the review queue, and takes the molar mass
   * its units convert by unless it has one.
   */
  recognize(analyteId: number, molarMass: number | null): void {
    this.db.update(analyte).set({ reviewed: true }).where(eq(analyte.id, analyteId)).run()
    if (molarMass !== null) {
      this.db
        .update(analyte)
        .set({ molarMass })
        .where(and(eq(analyte.id, analyteId), isNull(analyte.molarMass)))
        .run()
    }
    dataChanged(this.events, 'catalog')
  }

  /** Takes analytes off the review queue (`reviewed`), or puts them back on it. */
  setReviewed(ids: readonly number[], reviewed: boolean): void {
    if (ids.length === 0) return
    this.db
      .update(analyte)
      .set({ reviewed })
      .where(inArray(analyte.id, [...ids]))
      .run()
    dataChanged(this.events, 'catalog')
  }

  /** Shows the analyte in `unitId` everywhere; it must be one of the analyte's units. */
  setDisplayUnit(analyteId: number, unitId: number | null): void {
    this.find(analyteId)
    if (unitId !== null) {
      const allowed = this.db
        .select()
        .from(analyteUnit)
        .where(and(eq(analyteUnit.analyteId, analyteId), eq(analyteUnit.unitId, unitId)))
        .get()
      if (!allowed) throw new UserError('Эта единица не относится к показателю')
    }
    this.db.update(analyte).set({ displayUnitId: unitId }).where(eq(analyte.id, analyteId)).run()
    dataChanged(this.events, 'catalog')
  }

  /** The analyte a lab's test code is mapped to. */
  findByLabCode(labId: number, labCode: string): AnalyteRow | undefined {
    const alias = this.db
      .select({ analyteId: analyteAlias.analyteId })
      .from(analyteAlias)
      .where(and(eq(analyteAlias.labId, labId), eq(analyteAlias.labCode, labCode)))
      .get()
    return alias ? this.get(alias.analyteId) : undefined
  }

  /**
   * A new analyte for a test code an import meets for the first time; it waits in the review
   * queue (`reviewed = false`) until the dictionary or the person accepts it or merges it into an
   * existing one.
   */
  createFromLab(input: {
    labId: number
    labCode: string
    name: string
    valueKind: ValueKind
    unitId: number | null
    context: LabContext
  }): AnalyteRow {
    const name = input.name.trim()
    const row = this.db
      .insert(analyte)
      .values({
        name,
        specimen: specimenOfTest(name, input.context),
        valueKind: input.valueKind,
        canonicalUnitId: input.unitId,
        reviewed: false,
      })
      .returning()
      .get()
    this.db
      .insert(analyteAlias)
      .values({
        analyteId: row.id,
        alias: name,
        labId: input.labId,
        labCode: input.labCode,
        analysis: input.context.analysis,
      })
      .run()
    if (input.unitId !== null) this.allowUnit(row.id, input.unitId)
    this.reindex(row.id)
    return row
  }

  /**
   * What a lab says of a code it reports again: the analysis the code is part of, and the specimen,
   * which an analyte without one takes. Returns the analyte when the lab told something new of it.
   */
  noteContext(labId: number, labCode: string, context: LabContext): number | null {
    const alias = this.db
      .select()
      .from(analyteAlias)
      .where(and(eq(analyteAlias.labId, labId), eq(analyteAlias.labCode, labCode)))
      .get()
    if (!alias) return null
    const analysis = context.analysis !== null && alias.analysis !== context.analysis
    if (analysis) {
      this.db
        .update(analyteAlias)
        .set({ analysis: context.analysis })
        .where(eq(analyteAlias.id, alias.id))
        .run()
    }
    const row = this.get(alias.analyteId)
    const specimen = row?.specimen === null ? specimenOfTest(alias.alias, context) : null
    if (specimen !== null) {
      this.db.update(analyte).set({ specimen }).where(eq(analyte.id, alias.analyteId)).run()
    }
    return analysis || specimen !== null ? alias.analyteId : null
  }

  /** Records that results of the analyte come in `unitId`; the first such unit becomes canonical. */
  allowUnit(analyteId: number, unitId: number): void {
    this.db.insert(analyteUnit).values({ analyteId, unitId }).onConflictDoNothing().run()
    this.db
      .update(analyte)
      .set({ canonicalUnitId: unitId })
      .where(and(eq(analyte.id, analyteId), sql`${analyte.canonicalUnitId} is null`))
      .run()
  }

  /** Rebuilds the search entry from the name, every alias and every lab code of the analyte. */
  reindex(analyteId: number): void {
    const row = this.get(analyteId)
    this.db.$client.prepare('DELETE FROM analyte_search WHERE analyte_id = ?').run(analyteId)
    if (!row) return
    const aliases = this.db.select().from(analyteAlias).where(eq(analyteAlias.analyteId, analyteId)).all()
    const text = [row.name, ...aliases.flatMap((a) => [a.alias, a.labCode ?? ''])]
      .filter(Boolean)
      .map(normalizeSearchText)
      .join(' | ')
    this.db.$client
      .prepare('INSERT INTO analyte_search (analyte_id, text) VALUES (?, ?)')
      .run(analyteId, text)
  }
}
