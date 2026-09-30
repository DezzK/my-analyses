import { and, desc, eq, inArray } from 'drizzle-orm'
import type { AnalyteMerge } from '@shared/api'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import {
  analyte,
  analyteAlias,
  analyteMerge,
  analyteUnit,
  panelItem,
  referenceRule,
  result,
} from '../db/schema'
import { inTransaction } from '../db/transaction'
import { dataChanged, type EventSink } from '../events'
import type { AnalyteRow, AnalyteService } from './analytes'

/** What a merge moved, kept so that it can be put back. */
interface MergeRecord {
  /** The merged analyte's row as it was. */
  source: AnalyteRow
  results: number[]
  aliases: number[]
  rules: number[]
  /** The source's units: `added` when the target did not have the unit before. */
  units: { unitId: number; factor: number | null; added: boolean }[]
  /** The source's panel places: `moved` to the target, or dropped where the target already was. */
  panelItems: { panelId: number; position: number; moved: boolean }[]
}

/**
 * Merging two analytes that are the same thing (TSH from one lab and from another): results,
 * synonyms, lab codes, rules and panel places move into the target and the source disappears.
 * Every merge is recorded, so it can be undone.
 */
export class MergeService {
  constructor(
    private readonly deps: {
      db: Db
      analytes: AnalyteService
      events: EventSink
    },
  ) {}

  merge(sourceId: number, targetId: number): number {
    if (sourceId === targetId) throw new UserError('Показатель нельзя объединить с самим собой')
    const { db, analytes } = this.deps
    const source = analytes.find(sourceId)
    const target = analytes.find(targetId)
    const mergeId = inTransaction(db, () => {
      const ids = (rows: { id: number }[]) => rows.map((r) => r.id)
      const record: MergeRecord = {
        source,
        results: ids(db.select({ id: result.id }).from(result).where(eq(result.analyteId, sourceId)).all()),
        aliases: ids(
          db
            .select({ id: analyteAlias.id })
            .from(analyteAlias)
            .where(eq(analyteAlias.analyteId, sourceId))
            .all(),
        ),
        rules: ids(
          db
            .select({ id: referenceRule.id })
            .from(referenceRule)
            .where(eq(referenceRule.analyteId, sourceId))
            .all(),
        ),
        units: [],
        panelItems: [],
      }
      db.update(result).set({ analyteId: targetId }).where(eq(result.analyteId, sourceId)).run()
      db.update(analyteAlias).set({ analyteId: targetId }).where(eq(analyteAlias.analyteId, sourceId)).run()
      db.update(referenceRule).set({ analyteId: targetId }).where(eq(referenceRule.analyteId, sourceId)).run()

      const targetUnits = new Set(
        db
          .select()
          .from(analyteUnit)
          .where(eq(analyteUnit.analyteId, targetId))
          .all()
          .map((u) => u.unitId),
      )
      // Factors lead to the source's canonical unit; they hold for the target only if it is the same.
      const sameCanonical = source.canonicalUnitId === target.canonicalUnitId
      for (const u of db.select().from(analyteUnit).where(eq(analyteUnit.analyteId, sourceId)).all()) {
        const added = !targetUnits.has(u.unitId)
        record.units.push({ unitId: u.unitId, factor: u.factor, added })
        if (added) {
          db.insert(analyteUnit)
            .values({ analyteId: targetId, unitId: u.unitId, factor: sameCanonical ? u.factor : null })
            .run()
        }
      }

      const targetPanels = new Set(
        db
          .select()
          .from(panelItem)
          .where(eq(panelItem.analyteId, targetId))
          .all()
          .map((i) => i.panelId),
      )
      for (const item of db.select().from(panelItem).where(eq(panelItem.analyteId, sourceId)).all()) {
        const moved = !targetPanels.has(item.panelId)
        record.panelItems.push({ panelId: item.panelId, position: item.position, moved })
        const place = and(eq(panelItem.panelId, item.panelId), eq(panelItem.analyteId, sourceId))
        if (moved) db.update(panelItem).set({ analyteId: targetId }).where(place).run()
        else db.delete(panelItem).where(place).run()
      }

      db.delete(analyte).where(eq(analyte.id, sourceId)).run()
      return db
        .insert(analyteMerge)
        .values({ sourceId, targetId, record: JSON.stringify(record) })
        .returning({ id: analyteMerge.id })
        .get().id
    })
    analytes.reindex(sourceId)
    analytes.reindex(targetId)
    dataChanged(this.deps.events, 'catalog', 'orders')
    return mergeId
  }

  /** Puts everything the merge moved back where it came from. */
  unmerge(mergeId: number): void {
    const { db, analytes } = this.deps
    const row = db.select().from(analyteMerge).where(eq(analyteMerge.id, mergeId)).get()
    if (!row) throw new UserError('Объединение не найдено')
    const record = JSON.parse(row.record) as MergeRecord
    const { source } = record
    const back = { analyteId: source.id }
    inTransaction(db, () => {
      db.insert(analyte).values(source).run()
      if (record.results.length > 0)
        db.update(result).set(back).where(inArray(result.id, record.results)).run()
      if (record.aliases.length > 0) {
        db.update(analyteAlias).set(back).where(inArray(analyteAlias.id, record.aliases)).run()
      }
      if (record.rules.length > 0) {
        db.update(referenceRule).set(back).where(inArray(referenceRule.id, record.rules)).run()
      }
      for (const u of record.units) {
        db.insert(analyteUnit).values({ analyteId: source.id, unitId: u.unitId, factor: u.factor }).run()
        if (u.added && !this.targetUses(row.targetId, u.unitId)) {
          db.delete(analyteUnit)
            .where(and(eq(analyteUnit.analyteId, row.targetId), eq(analyteUnit.unitId, u.unitId)))
            .run()
        }
      }
      for (const item of record.panelItems) {
        if (item.moved) {
          db.update(panelItem)
            .set(back)
            .where(and(eq(panelItem.panelId, item.panelId), eq(panelItem.analyteId, row.targetId)))
            .run()
        } else {
          db.insert(panelItem)
            .values({ panelId: item.panelId, analyteId: source.id, position: item.position })
            .run()
        }
      }
      db.delete(analyteMerge).where(eq(analyteMerge.id, mergeId)).run()
    })
    analytes.reindex(source.id)
    analytes.reindex(row.targetId)
    dataChanged(this.deps.events, 'catalog', 'orders')
  }

  /** Merges into the analyte, newest first. */
  list(targetId: number): AnalyteMerge[] {
    return this.deps.db
      .select()
      .from(analyteMerge)
      .where(eq(analyteMerge.targetId, targetId))
      .orderBy(desc(analyteMerge.id))
      .all()
      .map((row) => ({
        id: row.id,
        sourceName: (JSON.parse(row.record) as MergeRecord).source.name,
        createdAt: row.createdAt,
      }))
  }

  /** Whether the target's own results (not the ones going back) are in the unit. */
  private targetUses(targetId: number, unitId: number): boolean {
    return (
      this.deps.db
        .select({ id: result.id })
        .from(result)
        .where(and(eq(result.analyteId, targetId), eq(result.unitId, unitId)))
        .get() !== undefined
    )
  }
}
