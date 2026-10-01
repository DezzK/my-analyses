import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { AnalyteMerge, UnreviewedMerge } from '@shared/api'
import { UserError } from '@shared/errors'
import { compareRussian } from '@shared/domain/text'
import type { Db } from '../db/client'
import {
  analyte,
  analyteAlias,
  analyteMerge,
  analyteUnit,
  dictionaryLink,
  panel,
  panelItem,
  referenceRule,
  reportBlock,
  reportTemplate,
  result,
} from '../db/schema'
import { inTransaction } from '../db/transaction'
import { dataChanged, type EventSink } from '../events'
import { labCodesOf, type AnalyteRow, type AnalyteService } from './analytes'

/**
 * An analyte's places in named lists: panels, report templates, entries of the built-in
 * dictionary. A merge moves the source's places to the target, or drops them from lists the
 * target is in already; undoing it puts them back.
 */
interface Places<Row extends { analyteId: number }, List = number> {
  of(analyteId: number): Row[]
  list(place: Omit<Row, 'analyteId'>): List
  /** Gives the place of `fromId` in the list to `toId`. */
  move(list: List, fromId: number, toId: number): void
  drop(list: List, analyteId: number): void
  /** Puts a dropped place back, unless its list is gone by now. */
  restore(row: Row): void
}

/** A place of the source as the merge left it: `moved` to the target, or dropped. */
type KeptPlace<Row> = Omit<Row, 'analyteId'> & { moved: boolean }

function movePlaces<Row extends { analyteId: number }, List>(
  places: Places<Row, List>,
  sourceId: number,
  targetId: number,
): KeptPlace<Row>[] {
  const targetLists = new Set(places.of(targetId).map((row) => places.list(row)))
  return places.of(sourceId).map(({ analyteId: _source, ...place }) => {
    const list = places.list(place)
    const moved = !targetLists.has(list)
    if (moved) places.move(list, sourceId, targetId)
    else places.drop(list, sourceId)
    return { ...place, moved }
  })
}

function restorePlaces<Row extends { analyteId: number }, List>(
  places: Places<Row, List>,
  kept: readonly KeptPlace<Row>[],
  sourceId: number,
  targetId: number,
): void {
  for (const { moved, ...place } of kept) {
    const row = { ...place, analyteId: sourceId } as unknown as Row
    if (moved) places.move(places.list(row), targetId, sourceId)
    else places.restore(row)
  }
}

function panelPlaces(db: Db): Places<typeof panelItem.$inferSelect> {
  const at = (list: number, analyteId: number) =>
    and(eq(panelItem.panelId, list), eq(panelItem.analyteId, analyteId))
  return {
    of: (analyteId) => db.select().from(panelItem).where(eq(panelItem.analyteId, analyteId)).all(),
    list: (place) => place.panelId,
    move: (list, fromId, toId) => db.update(panelItem).set({ analyteId: toId }).where(at(list, fromId)).run(),
    drop: (list, analyteId) => db.delete(panelItem).where(at(list, analyteId)).run(),
    restore: (row) => {
      const exists = db.select({ id: panel.id }).from(panel).where(eq(panel.id, row.panelId)).get()
      if (exists) db.insert(panelItem).values(row).run()
    },
  }
}

function reportBlockPlaces(db: Db): Places<typeof reportBlock.$inferSelect> {
  const at = (list: number, analyteId: number) =>
    and(eq(reportBlock.templateId, list), eq(reportBlock.analyteId, analyteId))
  return {
    of: (analyteId) => db.select().from(reportBlock).where(eq(reportBlock.analyteId, analyteId)).all(),
    list: (place) => place.templateId,
    move: (list, fromId, toId) =>
      db.update(reportBlock).set({ analyteId: toId }).where(at(list, fromId)).run(),
    drop: (list, analyteId) => db.delete(reportBlock).where(at(list, analyteId)).run(),
    restore: (row) => {
      const exists = db
        .select({ id: reportTemplate.id })
        .from(reportTemplate)
        .where(eq(reportTemplate.id, row.templateId))
        .get()
      if (exists) db.insert(reportBlock).values(row).run()
    },
  }
}

/** An entry of the dictionary is one analyte's, so a merge always gives the source's to the target. */
function dictionaryPlaces(db: Db): Places<typeof dictionaryLink.$inferSelect, string> {
  const at = (key: string, analyteId: number) =>
    and(eq(dictionaryLink.entryKey, key), eq(dictionaryLink.analyteId, analyteId))
  return {
    of: (analyteId) => db.select().from(dictionaryLink).where(eq(dictionaryLink.analyteId, analyteId)).all(),
    list: (place) => place.entryKey,
    move: (key, fromId, toId) =>
      db.update(dictionaryLink).set({ analyteId: toId }).where(at(key, fromId)).run(),
    drop: (key, analyteId) => db.delete(dictionaryLink).where(at(key, analyteId)).run(),
    restore: (row) => db.insert(dictionaryLink).values(row).onConflictDoNothing().run(),
  }
}

/** What a merge moved, kept so that it can be put back. */
interface MergeRecord {
  /** The merged analyte's row as it was. */
  source: AnalyteRow
  results: number[]
  aliases: number[]
  rules: number[]
  /** The source's units: `added` when the target did not have the unit before. */
  units: { unitId: number; factor: number | null; added: boolean }[]
  panelItems: KeptPlace<typeof panelItem.$inferSelect>[]
  /** Absent from merges recorded before report templates kept their blocks as rows. */
  reportBlocks?: KeptPlace<typeof reportBlock.$inferSelect>[]
  /** Absent from merges recorded before the built-in dictionary. */
  dictionaryLinks?: KeptPlace<typeof dictionaryLink.$inferSelect>[]
}

/** A merge's record, as `merge` wrote it. */
function recordOf(row: { record: string }): MergeRecord {
  return JSON.parse(row.record) as MergeRecord
}

/**
 * Merging two analytes that are the same thing (TSH from one lab and from another): results,
 * synonyms, lab codes, rules and panel places move into the target and the source disappears.
 * Every merge is recorded, so it can be undone; the dictionary's merges wait for the person to
 * look at them (`reviewed`), and a source the person split back out is `separated` for good.
 */
export class MergeService {
  constructor(
    private readonly deps: {
      db: Db
      analytes: AnalyteService
      events: EventSink
    },
  ) {}

  /** `reviewed: false` for a merge nobody asked for, made by the dictionary. */
  merge(sourceId: number, targetId: number, { reviewed = true }: { reviewed?: boolean } = {}): number {
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

      record.panelItems = movePlaces(panelPlaces(db), sourceId, targetId)
      record.reportBlocks = movePlaces(reportBlockPlaces(db), sourceId, targetId)
      record.dictionaryLinks = movePlaces(dictionaryPlaces(db), sourceId, targetId)

      db.delete(analyte).where(eq(analyte.id, sourceId)).run()
      return db
        .insert(analyteMerge)
        .values({ sourceId, targetId, record: JSON.stringify(record), reviewed })
        .returning({ id: analyteMerge.id })
        .get().id
    })
    analytes.reindex(sourceId)
    analytes.reindex(targetId)
    dataChanged(this.deps.events, 'catalog', 'orders', 'reports')
    return mergeId
  }

  /**
   * Puts everything the merge moved back where it came from. The person said the two differ, so
   * the dictionary never merges the source again.
   */
  unmerge(mergeId: number): void {
    const { db, analytes } = this.deps
    const row = db.select().from(analyteMerge).where(eq(analyteMerge.id, mergeId)).get()
    if (!row) throw new UserError('Объединение не найдено')
    const record = recordOf(row)
    const { source } = record
    const back = { analyteId: source.id }
    inTransaction(db, () => {
      db.insert(analyte)
        .values({ ...source, separated: true })
        .run()
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
      restorePlaces(panelPlaces(db), record.panelItems, source.id, row.targetId)
      restorePlaces(reportBlockPlaces(db), record.reportBlocks ?? [], source.id, row.targetId)
      restorePlaces(dictionaryPlaces(db), record.dictionaryLinks ?? [], source.id, row.targetId)
      db.delete(analyteMerge).where(eq(analyteMerge.id, mergeId)).run()
    })
    analytes.reindex(source.id)
    analytes.reindex(row.targetId)
    dataChanged(this.deps.events, 'catalog', 'orders', 'reports')
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
        sourceName: recordOf(row).source.name,
        createdAt: row.createdAt,
        reviewed: row.reviewed,
      }))
  }

  /** The merges nobody has looked at yet, by the analyte they went into, alphabetically. */
  unreviewed(): UnreviewedMerge[] {
    const { db, analytes } = this.deps
    const rows = db
      .select()
      .from(analyteMerge)
      .where(eq(analyteMerge.reviewed, false))
      .orderBy(asc(analyteMerge.id))
      .all()
      .map((row) => ({ row, record: recordOf(row) }))
    const aliases = new Map(
      analytes.aliases([...new Set(rows.map(({ row }) => row.targetId))]).map((alias) => [alias.id, alias]),
    )
    return [...Map.groupBy(rows, ({ row }) => row.targetId)]
      .map(([targetId, merges]) => ({
        targetId,
        targetName: analytes.find(targetId).name,
        merged: merges.map(({ row, record }) => ({
          mergeId: row.id,
          name: record.source.name,
          codes: labCodesOf(record.aliases.flatMap((id) => aliases.get(id) ?? [])),
        })),
      }))
      .sort((a, b) => compareRussian(a.targetName, b.targetName))
  }

  /** Marks merges as looked at, or puts them back among those to look at. */
  setReviewed(mergeIds: readonly number[], reviewed: boolean): void {
    if (mergeIds.length === 0) return
    this.deps.db
      .update(analyteMerge)
      .set({ reviewed })
      .where(inArray(analyteMerge.id, [...mergeIds]))
      .run()
    dataChanged(this.deps.events, 'catalog')
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
