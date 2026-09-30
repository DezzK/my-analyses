import { and, asc, eq } from 'drizzle-orm'
import {
  BUILTIN_UNITS,
  createUnitResolver,
  normalizeUnitSpelling,
  UNKNOWN_UNIT_PREFIX,
  type UnitRowLike,
} from '@shared/domain/units'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { analyte, analyteUnit, referenceRule, result, unit, unitSpelling } from '../db/schema'
import { inTransaction } from '../db/transaction'
import { dataChanged, type EventSink } from '../events'

export type UnitRow = typeof unit.$inferSelect

/** Owner of units and of which spelling means which unit. */
export class UnitService {
  private resolveCached: ((spelling: string) => UnitRowLike | null) | null = null

  constructor(
    private readonly db: Db,
    private readonly events: EventSink,
  ) {}

  /** Inserts the built-in dictionary and keeps it current with the app; runs on every start. */
  ensureBuiltins(): void {
    for (const def of BUILTIN_UNITS) {
      const values = { display: def.display, dimension: def.dimension, scale: def.scale, reviewed: true }
      this.db
        .insert(unit)
        .values({ code: def.code, ...values })
        .onConflictDoUpdate({ target: unit.code, set: values })
        .run()
    }
    this.invalidate()
  }

  list(): UnitRow[] {
    return this.db.select().from(unit).orderBy(asc(unit.display)).all()
  }

  get(id: number): UnitRow | undefined {
    return this.db.select().from(unit).where(eq(unit.id, id)).get()
  }

  /** The unit a printed spelling means, or null when nobody has mapped that spelling yet. */
  resolve(spelling: string): UnitRow | null {
    if (!this.resolveCached) {
      const custom = new Map(
        this.db
          .select()
          .from(unitSpelling)
          .all()
          .map((s) => [s.spelling, s.unitId]),
      )
      this.resolveCached = createUnitResolver(this.list(), custom)
    }
    const row = this.resolveCached(spelling)
    return row ? (row as UnitRow) : null
  }

  /**
   * The unit a printed spelling means; a spelling nobody has mapped gets a unit of its own,
   * flagged for the person to map in the review queue.
   */
  resolveOrCreate(spelling: string): { unit: UnitRow; created: boolean } {
    const known = this.resolve(spelling)
    if (known) return { unit: known, created: false }
    const code = `${UNKNOWN_UNIT_PREFIX}${normalizeUnitSpelling(spelling)}`
    const row = this.db
      .insert(unit)
      .values({ code, display: spelling.trim(), dimension: code, scale: 1, reviewed: false })
      .returning()
      .get()
    this.invalidate()
    dataChanged(this.events, 'catalog')
    return { unit: row, created: true }
  }

  /**
   * Says that a spelling nobody had mapped means an existing unit: from now on imports read it so,
   * and everything stored in the placeholder unit moves into that unit.
   */
  map(unitId: number, targetId: number): void {
    const placeholder = this.unknown(unitId)
    if (!this.get(targetId)) throw new UserError('Единица не найдена')
    if (targetId === unitId) throw new UserError('Выберите другую единицу')
    const moved = { unitId: targetId }
    inTransaction(this.db, () => {
      this.db.update(result).set(moved).where(eq(result.unitId, unitId)).run()
      this.db.update(referenceRule).set(moved).where(eq(referenceRule.unitId, unitId)).run()
      for (const row of this.db.select().from(analyteUnit).where(eq(analyteUnit.unitId, unitId)).all()) {
        this.db
          .insert(analyteUnit)
          .values({ ...row, unitId: targetId })
          .onConflictDoNothing()
          .run()
      }
      this.db.delete(analyteUnit).where(eq(analyteUnit.unitId, unitId)).run()
      this.db
        .update(analyte)
        .set({ canonicalUnitId: targetId })
        .where(eq(analyte.canonicalUnitId, unitId))
        .run()
      this.db.update(analyte).set({ displayUnitId: targetId }).where(eq(analyte.displayUnitId, unitId)).run()
      // A spelling someone mapped never gets a placeholder, so it cannot be here twice.
      this.db
        .insert(unitSpelling)
        .values({ spelling: placeholder.code.slice(UNKNOWN_UNIT_PREFIX.length), unitId: targetId })
        .run()
      this.db.delete(unit).where(eq(unit.id, unitId)).run()
    })
    this.invalidate()
    dataChanged(this.events, 'catalog', 'orders')
  }

  /** Keeps a spelling nobody had mapped as a unit of its own, off the review queue. */
  accept(unitId: number): void {
    this.unknown(unitId)
    this.db.update(unit).set({ reviewed: true }).where(eq(unit.id, unitId)).run()
    this.invalidate()
    dataChanged(this.events, 'catalog')
  }

  /** Units an import made up for spellings nobody has mapped yet. */
  listUnknown(): UnitRow[] {
    return this.db.select().from(unit).where(eq(unit.reviewed, false)).orderBy(asc(unit.display)).all()
  }

  private unknown(unitId: number): UnitRow {
    const row = this.db
      .select()
      .from(unit)
      .where(and(eq(unit.id, unitId), eq(unit.reviewed, false)))
      .get()
    if (!row) throw new UserError('Эта единица уже сопоставлена')
    return row
  }

  private invalidate(): void {
    this.resolveCached = null
  }
}
