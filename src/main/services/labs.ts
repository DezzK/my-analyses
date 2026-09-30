import { asc, count, eq } from 'drizzle-orm'
import type { MarkerShape } from '@shared/domain/enums'
import type { Db } from '../db/client'
import { lab } from '../db/schema'

export type LabRow = typeof lab.$inferSelect

/**
 * Colors and shapes that tell labs apart on charts: the Okabe–Ito palette stays distinguishable
 * for color-blind readers, and the shapes still do the job on a black-and-white printout.
 */
export const LAB_MARKERS: readonly { color: string; shape: MarkerShape }[] = [
  { color: '#0072B2', shape: 'circle' },
  { color: '#D55E00', shape: 'triangle' },
  { color: '#009E73', shape: 'diamond' },
  { color: '#CC79A7', shape: 'rect' },
  { color: '#E69F00', shape: 'roundRect' },
  { color: '#56B4E9', shape: 'pin' },
]

/** Labs every install starts with; `connectorId` names a connector in `src/main/lab/connectors`. */
export const BUILTIN_LABS: readonly { name: string; connectorId: string | null }[] = [
  { name: 'KDL', connectorId: 'kdl' },
  { name: 'Хеликс', connectorId: null },
  { name: 'Гемотест', connectorId: null },
  { name: 'Инвитро', connectorId: null },
  { name: 'Другая лаборатория', connectorId: null },
]

/** Owner of the list of labs and of their chart markers. */
export class LabService {
  constructor(private readonly db: Db) {}

  /** Adds the built-in labs that are missing; never touches labs the person already has. */
  ensureBuiltins(): void {
    for (const def of BUILTIN_LABS) {
      const existing = this.db.select().from(lab).where(eq(lab.name, def.name)).get()
      if (existing) {
        if (existing.connectorId !== def.connectorId) {
          this.db.update(lab).set({ connectorId: def.connectorId }).where(eq(lab.id, existing.id)).run()
        }
        continue
      }
      this.db
        .insert(lab)
        .values({ name: def.name, connectorId: def.connectorId, ...this.nextMarker() })
        .run()
    }
  }

  list(): LabRow[] {
    return this.db.select().from(lab).orderBy(asc(lab.id)).all()
  }

  get(id: number): LabRow | undefined {
    return this.db.select().from(lab).where(eq(lab.id, id)).get()
  }

  /** Markers go round the palette in order of creation. */
  private nextMarker(): { markerColor: string; markerShape: MarkerShape } {
    const n = this.db.select({ n: count() }).from(lab).get()?.n ?? 0
    const marker = LAB_MARKERS[n % LAB_MARKERS.length] ?? LAB_MARKERS[0]
    if (!marker) throw new Error('LAB_MARKERS is empty')
    return { markerColor: marker.color, markerShape: marker.shape }
  }
}
