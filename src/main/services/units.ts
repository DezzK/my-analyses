import { asc, eq } from 'drizzle-orm'
import {
  BUILTIN_UNITS,
  createUnitResolver,
  normalizeUnitSpelling,
  UNKNOWN_UNIT_PREFIX,
  type UnitRowLike,
} from '@shared/domain/units'
import type { Db } from '../db/client'
import { unit, unitSpelling } from '../db/schema'
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

  private invalidate(): void {
    this.resolveCached = null
  }
}
