import { and, asc, desc, eq, type SQL } from 'drizzle-orm'
import type { AnalyteResults, ResultRow, UnitOption } from '@shared/api'
import {
  interpret,
  type AnalyteFacts,
  type Interpretation,
  type PatientFacts,
  type ResultFacts,
  type RuleWithBounds,
} from '@shared/domain/interpret'
import { convert, type UnitInfo } from '@shared/domain/units'
import { asQualitativeCode } from '@shared/domain/values'
import type { Db } from '../db/client'
import { analyte, analyteUnit, labOrder, referenceRule, result } from '../db/schema'
import { shownUnitId, type AnalyteRow, type AnalyteService } from './analytes'
import type { PatientService } from './patients'
import type { UnitRow, UnitService } from './units'

/**
 * The catalog as reading results needs it, loaded once per request: every analyte, unit and
 * rule is a few hundred rows, cheaper to read whole than to fetch per result.
 */
class CatalogSnapshot {
  private readonly units: Map<number, UnitRow>
  private readonly analytes: Map<number, AnalyteRow>
  private readonly rules = new Map<number, RuleWithBounds[]>()
  private readonly allowed = new Map<number, { unitId: number; factor: number | null }[]>()
  private readonly facts = new Map<number, AnalyteFacts>()
  private readonly resolveUnit: (spelling: string) => UnitInfo | null

  constructor(db: Db, units: UnitService) {
    this.units = new Map(units.list().map((u) => [u.id, u]))
    this.analytes = new Map(
      db
        .select()
        .from(analyte)
        .all()
        .map((a) => [a.id, a]),
    )
    for (const r of db.select().from(referenceRule).all()) {
      const list = this.rules.get(r.analyteId) ?? []
      list.push({ ...r, expected: asQualitativeCode(r.expected) })
      this.rules.set(r.analyteId, list)
    }
    for (const u of db.select().from(analyteUnit).all()) {
      const list = this.allowed.get(u.analyteId) ?? []
      list.push({ unitId: u.unitId, factor: u.factor })
      this.allowed.set(u.analyteId, list)
    }
    this.resolveUnit = (spelling) => units.resolve(spelling)
  }

  analyte(id: number): AnalyteRow | undefined {
    return this.analytes.get(id)
  }

  private unit(id: number | null): UnitRow | null {
    return id === null ? null : (this.units.get(id) ?? null)
  }

  target(analyteId: number): UnitInfo | null {
    const row = this.analytes.get(analyteId)
    return row ? this.unit(shownUnitId(row)) : null
  }

  factsFor(analyteId: number): AnalyteFacts {
    const cached = this.facts.get(analyteId)
    if (cached) return cached
    const row = this.analytes.get(analyteId)
    const factors = new Map<number, number>()
    for (const { unitId, factor } of this.allowed.get(analyteId) ?? []) {
      if (factor !== null) factors.set(unitId, factor)
    }
    const facts: AnalyteFacts = {
      conversion: {
        canonical: this.unit(row?.canonicalUnitId ?? null),
        molarMass: row?.molarMass ?? null,
        factors,
      },
      rules: this.rules.get(analyteId) ?? [],
      units: this.units,
      resolveUnit: this.resolveUnit,
    }
    this.facts.set(analyteId, facts)
    return facts
  }

  /** The analyte's units, each marked by whether every one of them converts into it. */
  unitOptions(analyteId: number): UnitOption[] {
    const { conversion } = this.factsFor(analyteId)
    const units = (this.allowed.get(analyteId) ?? []).flatMap(({ unitId }) => this.unit(unitId) ?? [])
    return units.map((to) => ({
      id: to.id,
      convertible: units.every((from) => convert(1, from, to, conversion) !== null),
    }))
  }
}

/**
 * Reads stored results the way every screen shows them, through `interpret`: tables, charts,
 * orders and reports get the same values, references and verdicts from here.
 */
export class ResultReader {
  constructor(
    private readonly deps: {
      db: Db
      units: UnitService
      analytes: AnalyteService
      patients: PatientService
    },
  ) {}

  forAnalyte(analyteId: number, patientId: number): AnalyteResults {
    const catalog = new CatalogSnapshot(this.deps.db, this.deps.units)
    return {
      analyte: this.deps.analytes.summary(analyteId),
      unitId: catalog.target(analyteId)?.id ?? null,
      units: catalog.unitOptions(analyteId),
      rows: this.read(patientId, catalog, eq(result.analyteId, analyteId)),
    }
  }

  /** Results typed but not stored yet, read exactly as they will be once stored. */
  preview(patientId: number, rows: readonly (ResultFacts & { analyteId: number })[]): Interpretation[] {
    const catalog = new CatalogSnapshot(this.deps.db, this.deps.units)
    const patient = this.patientFacts(patientId)
    return rows.map((row) =>
      interpret(row, catalog.target(row.analyteId), patient, catalog.factsFor(row.analyteId)),
    )
  }

  /** Every result of the patient, or those `where` selects; newest orders first. */
  forPatient(patientId: number, where?: SQL): ResultRow[] {
    return this.read(patientId, new CatalogSnapshot(this.deps.db, this.deps.units), where)
  }

  private patientFacts(patientId: number): PatientFacts {
    const { sex, birthDate } = this.deps.patients.get(patientId)
    return { sex, birthDate, periods: this.deps.patients.periods(patientId) }
  }

  private read(patientId: number, catalog: CatalogSnapshot, where?: SQL): ResultRow[] {
    const patient = this.patientFacts(patientId)
    const stored = this.deps.db
      .select({
        id: result.id,
        orderId: result.orderId,
        analyteId: result.analyteId,
        rawValue: result.rawValue,
        unitId: result.unitId,
        refRaw: result.refRaw,
        labFlag: result.labFlag,
        userEdited: result.userEdited,
        note: result.note,
        labId: labOrder.labId,
        collectedOn: labOrder.collectedOn,
        collectedTime: labOrder.collectedTime,
        cyclePhase: labOrder.cyclePhase,
      })
      .from(result)
      .innerJoin(labOrder, eq(labOrder.id, result.orderId))
      .where(and(eq(labOrder.patientId, patientId), where))
      .orderBy(desc(labOrder.collectedOn), desc(labOrder.collectedTime), desc(labOrder.id), asc(result.id))
      .all()
    return stored.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      analyteId: row.analyteId,
      analyteName: catalog.analyte(row.analyteId)?.name ?? '',
      labId: row.labId,
      collectedOn: row.collectedOn,
      collectedTime: row.collectedTime,
      rawValue: row.rawValue,
      reportedUnitId: row.unitId,
      refRaw: row.refRaw,
      labFlag: row.labFlag,
      userEdited: row.userEdited,
      note: row.note,
      read: interpret(row, catalog.target(row.analyteId), patient, catalog.factsFor(row.analyteId)),
    }))
  }
}
