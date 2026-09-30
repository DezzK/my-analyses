import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import type { MappingQueue, MatchSuggestion, UnknownUnit } from '@shared/api'
import { CYCLE_PHASE_CONDITIONS, cycleOn } from '@shared/domain/conditions'
import { compareRussian, foldCase } from '@shared/domain/text'
import type { Db } from '../db/client'
import { analyte, analyteUnit, labOrder, referenceRule, result } from '../db/schema'
import type { AnalyteService } from './analytes'
import type { OrderService } from './orders'
import type { PatientService } from './patients'
import type { ResultReader } from './results'
import type { UnitService } from './units'

/** Shorter words ("в", "на", "общ") say too little about what is measured to suggest a match. */
const MIN_WORD_LENGTH = 4
const SUGGESTIONS = 5

function words(name: string): string[] {
  return [...new Set(foldCase(name).split(/[^\p{L}\p{N}]+/u))].filter((w) => w.length >= MIN_WORD_LENGTH)
}

/**
 * What waits for the person after imports: analytes and unit spellings nobody has looked at,
 * orders whose norms need a cycle phase, and results the lab judged otherwise than the app.
 */
export class MappingService {
  constructor(
    private readonly deps: {
      db: Db
      analytes: AnalyteService
      units: UnitService
      orders: OrderService
      results: ResultReader
      patients: PatientService
    },
  ) {}

  queue(patientId: number): MappingQueue {
    return {
      analytes: this.deps.analytes
        .list()
        .filter((entry) => !entry.reviewed)
        .map(({ id, name, specimen, canonicalUnitId, codes, resultCount }) => ({
          id,
          name,
          specimen,
          unitId: canonicalUnitId,
          codes,
          resultCount,
        })),
      units: this.unknownUnits(),
      phaseOrders: this.phaseOrders(patientId),
      disagreements: this.deps.results.forPatient(patientId).filter((row) => row.read.labDisagrees),
    }
  }

  /**
   * Existing analytes a new one may be: they share words of the name with it, the more the
   * likelier, and a unit of the same kind counts too. Analytes that another code of the same lab
   * already maps to are left out: a lab does not measure one thing under two codes.
   */
  suggestions(analyteId: number): MatchSuggestion[] {
    const { analytes, units } = this.deps
    const self = analytes.find(analyteId)
    const ownLabs = new Set(analytes.aliases([analyteId]).flatMap((a) => (a.labCode ? [a.labId] : [])))
    const scores = new Map<number, number>()
    for (const word of words(self.name)) {
      for (const hit of analytes.search(word, null)) {
        if (hit.id !== analyteId) scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1)
      }
    }
    const candidates = [...scores.keys()]
    const sameLab = new Set(
      analytes
        .aliases(candidates)
        .filter((a) => a.labCode !== null && ownLabs.has(a.labId))
        .map((a) => a.analyteId),
    )
    const dimension = (unitId: number | null) =>
      unitId === null ? null : (units.get(unitId)?.dimension ?? null)
    const ownDimension = dimension(self.canonicalUnitId)
    return candidates
      .filter((id) => !sameLab.has(id))
      .flatMap((id) => {
        const row = analytes.get(id)
        if (!row) return []
        const alike = ownDimension !== null && dimension(row.canonicalUnitId) === ownDimension
        return [
          { id, name: row.name, unitId: row.canonicalUnitId, score: (scores.get(id) ?? 0) + Number(alike) },
        ]
      })
      .sort((a, b) => b.score - a.score || compareRussian(a.name, b.name))
      .slice(0, SUGGESTIONS)
      .map(({ id, name, unitId }) => ({ id, name, unitId }))
  }

  private unknownUnits(): UnknownUnit[] {
    const { db, units } = this.deps
    const unknown = units.listUnknown()
    if (unknown.length === 0) return []
    const ids = unknown.map((u) => u.id)
    const counts = new Map(
      db
        .select({ unitId: result.unitId, n: count() })
        .from(result)
        .where(inArray(result.unitId, ids))
        .groupBy(result.unitId)
        .all()
        .map((r) => [r.unitId, r.n]),
    )
    const users = Map.groupBy(
      db
        .select({ unitId: analyteUnit.unitId, name: analyte.name })
        .from(analyteUnit)
        .innerJoin(analyte, eq(analyte.id, analyteUnit.analyteId))
        .where(inArray(analyteUnit.unitId, ids))
        .all(),
      (row) => row.unitId,
    )
    return unknown.map((u) => ({
      id: u.id,
      display: u.display,
      resultCount: counts.get(u.id) ?? 0,
      analyteNames: (users.get(u.id) ?? []).map((row) => row.name),
    }))
  }

  /** The patient's orders with results whose rules depend on a cycle phase that was never recorded. */
  private phaseOrders(patientId: number) {
    const { db, patients, orders } = this.deps
    const patient = patients.get(patientId)
    if (patient.sex !== 'female') return []
    const phased = db
      .selectDistinct({ id: referenceRule.analyteId })
      .from(referenceRule)
      .where(inArray(referenceRule.condition, [...CYCLE_PHASE_CONDITIONS]))
      .all()
      .map((r) => r.id)
    if (phased.length === 0) return []
    const periods = patients.periods(patientId)
    const waiting = new Set(
      db
        .selectDistinct({ id: labOrder.id, collectedOn: labOrder.collectedOn })
        .from(labOrder)
        .innerJoin(result, eq(result.orderId, labOrder.id))
        .where(
          and(
            eq(labOrder.patientId, patientId),
            isNull(labOrder.cyclePhase),
            inArray(result.analyteId, phased),
          ),
        )
        .all()
        .filter((o) => cycleOn(o.collectedOn, periods))
        .map((o) => o.id),
    )
    return orders.list(patientId).filter((order) => waiting.has(order.id))
  }
}
