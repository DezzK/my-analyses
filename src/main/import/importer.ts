import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { SyncStats } from '@shared/api'
import type { ValueKind } from '@shared/domain/enums'
import { parseReference } from '@shared/domain/references'
import { parseValue, splitValueAndUnit } from '@shared/domain/values'
import type { Db } from '../db/client'
import { labOrder, result } from '../db/schema'
import { inTransaction } from '../db/transaction'
import { dataChanged, type EventSink } from '../events'
import type { RawOrder, RawResult } from '../lab/types'
import type { AnalyteService, LabContext } from '../services/analytes'
import type { AnalyteDictionary } from '../services/dictionary'
import type { OrderForms } from '../services/order-forms'
import type { UnitService } from '../services/units'

/** Where imported orders go: the lab, the account they came from and the patient they belong to. */
export interface ImportTarget {
  labId: number
  labAccountId: number | null
  patientId: number
  /** The lab's person the orders are of; absent when the lab names nobody. */
  labPersonId?: number | null
  connectorVersion: string | null
}

export function emptyStats(): SyncStats {
  return {
    ordersAdded: 0,
    ordersUpdated: 0,
    ordersUnchanged: 0,
    resultsAdded: 0,
    resultsUpdated: 0,
    resultsKeptEdited: 0,
    analytesCreated: 0,
    analytesRecognized: 0,
    unknownUnits: 0,
    ordersWaiting: 0,
  }
}

/** Adds the counters of `more` into `total`. */
export function addStats(total: SyncStats, more: SyncStats): void {
  for (const key of Object.keys(total) as (keyof SyncStats)[]) total[key] += more[key]
}

/** The value and the unit spelling of a result as printed; the reference may name the unit instead. */
function readResult(raw: RawResult): { rawValue: string; unitText: string | null } | null {
  const printed = raw.printed.trim()
  if (!printed) return raw.value ? { rawValue: raw.value, unitText: null } : null
  const split = splitValueAndUnit(printed)
  if (parseValue(split.valueText).kind !== 'numeric') return { rawValue: printed, unitText: null }
  const reference = parseReference(raw.reference)
  const refUnit = reference?.kind === 'range' ? reference.unitText : null
  return { rawValue: split.valueText, unitText: split.unitText ?? refUnit }
}

/** What the lab says of the result's test beyond its name. */
function contextOf(raw: RawResult): LabContext {
  return { analysis: raw.analysis?.trim() || null, specimen: raw.specimen ?? null }
}

/** Compiles only while every kind `parseValue` returns is one of VALUE_KINDS. */
function valueKindOf(rawValue: string): ValueKind {
  return parseValue(rawValue).kind
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Whether a stored order holds exactly this report of the lab's. */
function sameReport(stored: { rawHash: string | null }, rawPayload: string): boolean {
  return stored.rawHash === sha256(rawPayload)
}

/**
 * Turns orders as a lab reports them into stored orders and results. A repeated import changes
 * nothing that did not change at the lab, never duplicates an order, and never overwrites a
 * result the person corrected. Test codes it meets for the first time become new analytes; those
 * the built-in dictionary knows join their analyte, the rest wait in the review queue.
 */
export class ImportService {
  constructor(
    private readonly deps: {
      db: Db
      units: UnitService
      analytes: AnalyteService
      dictionary: AnalyteDictionary
      forms: OrderForms
      events: EventSink
    },
  ) {}

  importOrders(target: ImportTarget, orders: readonly RawOrder[]): SyncStats {
    const stats = emptyStats()
    let learned = false
    for (const order of orders) {
      inTransaction(this.deps.db, () => {
        const news = this.importOrder(target, order, stats)
        // Once the whole order is in, so that the dictionary sees which analytes share it.
        if (news.length === 0) return
        learned = true
        const { linked, merged } = this.deps.dictionary.apply(news)
        stats.analytesRecognized += linked + merged
      })
    }
    if (stats.ordersAdded + stats.ordersUpdated > 0) dataChanged(this.deps.events, 'orders', 'catalog')
    else if (learned) dataChanged(this.deps.events, 'catalog')
    return stats
  }

  /** The orders already imported from a lab, by external key, with the connector version that last read each. */
  importedVersions(labId: number): Map<string, string | null> {
    const rows = this.deps.db
      .select({ key: labOrder.externalKey, version: labOrder.connectorVersion })
      .from(labOrder)
      .where(eq(labOrder.labId, labId))
      .all()
    return new Map(rows.flatMap((row) => (row.key === null ? [] : [[row.key, row.version] as const])))
  }

  /**
   * Whether the lab's original forms are worth fetching along with this report: the order is new,
   * has no forms yet, or its report changed since the forms were stored.
   */
  needsForms(labId: number, report: Pick<RawOrder, 'externalKey' | 'rawPayload'>): boolean {
    const existing = this.find(labId, report.externalKey)
    if (!existing || !sameReport(existing, report.rawPayload)) return true
    return this.deps.forms.of(existing.id).length === 0
  }

  private find(labId: number, externalKey: string) {
    return this.deps.db
      .select()
      .from(labOrder)
      .where(and(eq(labOrder.labId, labId), eq(labOrder.externalKey, externalKey)))
      .get()
  }

  /** Stores the order; returns the analytes it created or learned more of, for the dictionary. */
  private importOrder(target: ImportTarget, raw: RawOrder, stats: SyncStats): number[] {
    const { db, analytes } = this.deps
    const existing = this.find(target.labId, raw.externalKey)
    const storedForms = existing ? this.deps.forms.of(existing.id) : []
    const fetched = this.deps.forms.storePdfs(raw.forms)
    // Forms the lab did not send this time stay as they were.
    const forms = fetched.length > 0 ? fetched : storedForms
    const sameForms = forms.length === storedForms.length && forms.every((file, i) => file === storedForms[i])
    if (existing && sameReport(existing, raw.rawPayload) && sameForms) {
      stats.ordersUnchanged += 1
      if (existing.connectorVersion === target.connectorVersion) return []
      // Read again by this version of the connector, it need not be fetched again for that; a
      // newer connector may say more of the same report: what analysis each test is part of.
      db.update(labOrder)
        .set({ connectorVersion: target.connectorVersion })
        .where(eq(labOrder.id, existing.id))
        .run()
      return raw.results.flatMap(
        (item) => analytes.noteContext(target.labId, item.labCode, contextOf(item)) ?? [],
      )
    }

    const fields = {
      labAccountId: target.labAccountId,
      collectedOn: raw.collectedOn,
      connectorVersion: target.connectorVersion,
      rawPayload: raw.rawPayload,
      rawHash: sha256(raw.rawPayload),
      updatedAt: new Date().toISOString(),
    }
    const orderId = existing
      ? (db.update(labOrder).set(fields).where(eq(labOrder.id, existing.id)).run(), existing.id)
      : db
          .insert(labOrder)
          .values({
            ...fields,
            patientId: target.patientId,
            labPersonId: target.labPersonId ?? null,
            labId: target.labId,
            externalKey: raw.externalKey,
            source: 'import',
          })
          .returning({ id: labOrder.id })
          .get().id
    stats[existing ? 'ordersUpdated' : 'ordersAdded'] += 1
    if (!sameForms) this.deps.forms.replace(orderId, forms)

    const news: number[] = []
    for (const item of raw.results) this.importResult(target, orderId, item, stats, news)
    return news
  }

  /** Stores the result; an analyte it creates, or learns more of, joins `news`. */
  private importResult(
    target: ImportTarget,
    orderId: number,
    raw: RawResult,
    stats: SyncStats,
    news: number[],
  ): void {
    const { db, units, analytes } = this.deps
    const read = readResult(raw)
    if (!read) return

    let unitId: number | null = null
    if (read.unitText) {
      const resolved = units.resolveOrCreate(read.unitText)
      unitId = resolved.unit.id
      if (resolved.created) stats.unknownUnits += 1
    }

    const context = contextOf(raw)
    let analyteRow = analytes.findByLabCode(target.labId, raw.labCode)
    if (!analyteRow) {
      analyteRow = analytes.createFromLab({
        labId: target.labId,
        labCode: raw.labCode,
        name: raw.labName,
        valueKind: valueKindOf(read.rawValue),
        unitId,
        context,
      })
      stats.analytesCreated += 1
      news.push(analyteRow.id)
    } else {
      const learned = analytes.noteContext(target.labId, raw.labCode, context)
      if (learned !== null) news.push(learned)
      if (unitId !== null) analytes.allowUnit(analyteRow.id, unitId)
    }

    const values = {
      analyteId: analyteRow.id,
      rawValue: read.rawValue,
      unitId,
      refRaw: raw.reference?.trim() || null,
      labFlag: raw.flag,
    }
    const current = db
      .select()
      .from(result)
      .where(and(eq(result.orderId, orderId), eq(result.externalKey, raw.labCode)))
      .get()
    if (!current) {
      db.insert(result)
        .values({ ...values, orderId, externalKey: raw.labCode })
        .run()
      stats.resultsAdded += 1
      return
    }
    const changed = (Object.keys(values) as (keyof typeof values)[]).some(
      (key) => current[key] !== values[key],
    )
    if (!changed) return
    if (current.userEdited) {
      stats.resultsKeptEdited += 1
      return
    }
    db.update(result).set(values).where(eq(result.id, current.id)).run()
    stats.resultsUpdated += 1
  }
}
