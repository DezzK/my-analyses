import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AnalyteHit, AnalyteSummary } from '@shared/api'
import type { Specimen, ValueKind } from '@shared/domain/enums'
import { inferSpecimen } from '@shared/domain/specimens'
import { foldCase } from '@shared/domain/text'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { analyte, analyteAlias, analyteUnit } from '../db/schema'
import { dataChanged, type EventSink } from '../events'

export type AnalyteRow = typeof analyte.$inferSelect
export type AnalyteAliasRow = typeof analyteAlias.$inferSelect

/** Enough hits to scroll through, few enough to show at once. */
const SEARCH_LIMIT = 50

/** The text the search index holds for an analyte, and the text a query is compared with. */
export function normalizeSearchText(text: string): string {
  return foldCase(text)
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
    const row = this.get(id)
    if (!row) throw new UserError('Показатель не найден')
    return {
      id: row.id,
      name: row.name,
      specimen: row.specimen,
      description: row.description,
      valueKind: row.valueKind,
      reviewed: row.reviewed,
      aliases: this.aliases([id]).map(({ alias, labId, labCode }) => ({ alias, labId, labCode })),
    }
  }

  /**
   * Analytes whose name, synonym or lab code contains the query, ignoring case and ё. Those the
   * patient has results for come first, most recently measured first.
   */
  search(query: string, patientId: number | null): AnalyteHit[] {
    const needle = normalizeSearchText(query).trim()
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
    const matches = (text: string | null) => text !== null && normalizeSearchText(text).includes(needle)
    return rows.map((row) => {
      const own = aliases.filter((a) => a.analyteId === row.id)
      const matched = matches(row.name)
        ? null
        : (own.find((a) => matches(a.alias))?.alias ?? own.find((a) => matches(a.labCode))?.labCode ?? null)
      return { ...row, matched }
    })
  }

  /** Shows the analyte in `unitId` everywhere; it must be one of the analyte's units. */
  setDisplayUnit(analyteId: number, unitId: number | null): void {
    if (!this.get(analyteId)) throw new UserError('Показатель не найден')
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
   * queue (`reviewed = false`) until the person accepts it or merges it into an existing one.
   */
  createFromLab(input: {
    labId: number
    labCode: string
    name: string
    valueKind: ValueKind
    unitId: number | null
  }): AnalyteRow {
    const name = input.name.trim()
    const row = this.db
      .insert(analyte)
      .values({
        name,
        specimen: inferSpecimen(name),
        valueKind: input.valueKind,
        canonicalUnitId: input.unitId,
        reviewed: false,
      })
      .returning()
      .get()
    this.db
      .insert(analyteAlias)
      .values({ analyteId: row.id, alias: name, labId: input.labId, labCode: input.labCode })
      .run()
    if (input.unitId !== null) this.allowUnit(row.id, input.unitId)
    this.reindex(row.id)
    return row
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
