import { count, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { analyte, dictionaryLink, result } from '../db/schema'
import { inTransaction } from '../db/transaction'
import { findEntry } from '../dictionary/match'
import type { AnalyteService } from './analytes'
import type { MergeService } from './merges'
import type { UnitService } from './units'

/** What applying the dictionary did. */
export interface DictionaryOutcome {
  /** Analytes linked to an entry no analyte was linked to before. */
  linked: number
  /** Analytes merged into the analyte of their entry. */
  merged: number
  /** Analytes kept apart from the analyte of their entry: the two have results in one order. */
  apart: number
}

/**
 * The built-in analyte dictionary (`src/main/dictionary/`) applied to the catalog. An analyte whose
 * names, unit and specimen agree with exactly one entry is that entry: the first such analyte is
 * linked to it and leaves the review queue, later ones are merged into it, and every such merge
 * waits for the person to look at it. Two analytes with results in one order are never merged —
 * a lab does not report one analyte twice in an order, so the names deceive — and an analyte the
 * person split back out of a merge is left alone for good.
 */
export class AnalyteDictionary {
  constructor(
    private readonly deps: {
      db: Db
      analytes: AnalyteService
      units: UnitService
      merges: MergeService
    },
  ) {}

  /** Applies the dictionary to the analytes given, or to every analyte not linked to an entry yet. */
  apply(analyteIds?: readonly number[]): DictionaryOutcome {
    const { db, merges } = this.deps
    return inTransaction(db, () => {
      const outcome: DictionaryOutcome = { linked: 0, merged: 0, apart: 0 }
      const linkedTo = new Map(
        db
          .select()
          .from(dictionaryLink)
          .all()
          .map((link) => [link.entryKey, link.analyteId]),
      )
      const matches = this.matches(analyteIds, new Set(linkedTo.values()))
      const counts = this.resultCounts(matches.map(({ row }) => row.id))
      for (const group of Map.groupBy(matches, ({ entry }) => entry.key).values()) {
        const [first] = group
        if (!first) continue
        const members = group
          .map(({ row }) => row)
          .sort(
            (a, b) =>
              Number(b.reviewed) - Number(a.reviewed) ||
              (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
              a.id - b.id,
          )
        let targetId = linkedTo.get(first.entry.key)
        if (targetId === undefined) {
          const target = members.shift()
          if (!target) continue
          targetId = target.id
          db.insert(dictionaryLink).values({ entryKey: first.entry.key, analyteId: targetId }).run()
          this.deps.analytes.recognize(targetId, first.entry.molarMass ?? null)
          outcome.linked += 1
        }
        const targetOrders = this.ordersOf(targetId)
        for (const member of members) {
          const orders = this.ordersOf(member.id)
          if ([...orders].some((orderId) => targetOrders.has(orderId))) {
            outcome.apart += 1
            continue
          }
          merges.merge(member.id, targetId, { reviewed: false })
          for (const orderId of orders) targetOrders.add(orderId)
          outcome.merged += 1
        }
      }
      return outcome
    })
  }

  /** The analytes to look at that the dictionary knows, each with its entry. */
  private matches(analyteIds: readonly number[] | undefined, linked: ReadonlySet<number>) {
    const { db, analytes, units } = this.deps
    if (analyteIds?.length === 0) return []
    const rows = (
      analyteIds === undefined
        ? db.select().from(analyte).all()
        : db
            .select()
            .from(analyte)
            .where(inArray(analyte.id, [...analyteIds]))
            .all()
    ).filter((row) => !row.separated && !linked.has(row.id))
    const aliases = Map.groupBy(analytes.aliases(rows.map((row) => row.id)), (alias) => alias.analyteId)
    return rows.flatMap((row) => {
      const unit = row.canonicalUnitId === null ? undefined : units.get(row.canonicalUnitId)
      const entry = findEntry({
        names: [row.name, ...(aliases.get(row.id) ?? []).map((alias) => alias.alias)],
        specimen: row.specimen,
        valueKind: row.valueKind,
        unit: unit ? { dimension: unit.dimension, scale: unit.scale } : null,
      })
      return entry ? [{ row, entry }] : []
    })
  }

  private resultCounts(analyteIds: readonly number[]): Map<number, number> {
    if (analyteIds.length === 0) return new Map()
    return new Map(
      this.deps.db
        .select({ analyteId: result.analyteId, n: count() })
        .from(result)
        .where(inArray(result.analyteId, [...analyteIds]))
        .groupBy(result.analyteId)
        .all()
        .map((row) => [row.analyteId, row.n]),
    )
  }

  private ordersOf(analyteId: number): Set<number> {
    return new Set(
      this.deps.db
        .selectDistinct({ orderId: result.orderId })
        .from(result)
        .where(eq(result.analyteId, analyteId))
        .all()
        .map((row) => row.orderId),
    )
  }
}
