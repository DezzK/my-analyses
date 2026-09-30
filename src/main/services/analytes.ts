import { and, eq, sql } from 'drizzle-orm'
import type { ValueKind } from '@shared/domain/enums'
import { inferSpecimen } from '@shared/domain/specimens'
import { foldCase } from '@shared/domain/text'
import type { Db } from '../db/client'
import { analyte, analyteAlias, analyteUnit } from '../db/schema'

export type AnalyteRow = typeof analyte.$inferSelect

/** The text the search index holds for an analyte, and the text a query is compared with. */
export function normalizeSearchText(text: string): string {
  return foldCase(text)
}

/** Owner of analytes: their names, aliases, lab codes, allowed units and search index. */
export class AnalyteService {
  constructor(private readonly db: Db) {}

  get(id: number): AnalyteRow | undefined {
    return this.db.select().from(analyte).where(eq(analyte.id, id)).get()
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
