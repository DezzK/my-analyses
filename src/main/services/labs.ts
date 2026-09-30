import { randomUUID } from 'node:crypto'
import { asc, count, eq } from 'drizzle-orm'
import type { Lab } from '@shared/api'
import type { MarkerShape } from '@shared/domain/enums'
import { foldCase } from '@shared/domain/text'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { lab, labAccount } from '../db/schema'
import { dataChanged, type EventSink } from '../events'
import { connectorFor } from '../lab/connectors'
import type { LabAccountInfo, LabConnector } from '../lab/types'
import { typedName } from './validation'

export type LabRow = typeof lab.$inferSelect
export type LabAccountRow = typeof labAccount.$inferSelect

/** A lab's name stands in chart legends and next to every result. */
const MAX_LAB_NAME_LENGTH = 60

/** Electron keeps a partition named `persist:…` on disk; each account gets one of its own. */
const SESSION_PARTITION_PREFIX = 'persist:lab-'

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
  { name: 'Хеликс', connectorId: 'helix' },
  { name: 'Гемотест', connectorId: null },
  { name: 'Инвитро', connectorId: null },
  { name: 'Другая лаборатория', connectorId: null },
]

/** Owner of labs, their chart markers and the accounts connected to their personal pages. */
export class LabService {
  constructor(
    private readonly db: Db,
    private readonly events: EventSink,
    /** The connector registry; tests put fakes in it. */
    private readonly connectors: typeof connectorFor = connectorFor,
  ) {}

  /**
   * Adds the built-in labs that are missing and points each one at the connector this version
   * ships; labs the person added are never touched.
   */
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

  /** A lab the app has no connector for: its forms are entered by hand. */
  create(name: string): Lab {
    const title = typedName(name, 'Введите название лаборатории', { maxLength: MAX_LAB_NAME_LENGTH })
    const taken = this.list().some((existing) => foldCase(existing.name) === foldCase(title))
    if (taken) throw new UserError('Такая лаборатория уже есть')
    const row = this.db
      .insert(lab)
      .values({ name: title, connectorId: null, ...this.nextMarker() })
      .returning({ id: lab.id })
      .get()
    dataChanged(this.events, 'labs')
    const created = this.list().find((existing) => existing.id === row.id)
    if (!created) throw new Error(`Lab ${row.id} was not saved`)
    return created
  }

  list(): Lab[] {
    return this.db
      .select()
      .from(lab)
      .orderBy(asc(lab.id))
      .all()
      .map(({ id, name, markerColor, markerShape, connectorId }) => ({
        id,
        name,
        markerColor,
        markerShape,
        connectable: this.connectors(connectorId) !== null,
      }))
  }

  get(id: number): LabRow | undefined {
    return this.db.select().from(lab).where(eq(lab.id, id)).get()
  }

  /** The lab and the connector that imports its personal accounts. */
  connector(labId: number): { lab: LabRow; connector: LabConnector } {
    const row = this.get(labId)
    if (!row) throw new UserError('Лаборатория не найдена')
    const connector = this.connectors(row.connectorId)
    if (!connector) {
      throw new UserError(`Подключать кабинет лаборатории «${row.name}» приложение пока не умеет`)
    }
    return { lab: row, connector }
  }

  listAccounts(): LabAccountRow[] {
    return this.db.select().from(labAccount).orderBy(asc(labAccount.id)).all()
  }

  getAccount(id: number): LabAccountRow {
    const row = this.db.select().from(labAccount).where(eq(labAccount.id, id)).get()
    if (!row) throw new UserError('Кабинет не найден')
    return row
  }

  /** A new account of a lab the app has a connector for, with a session nobody else shares. */
  createAccount(labId: number, patientId: number): LabAccountRow {
    const { lab: labRow } = this.connector(labId)
    const row = this.db
      .insert(labAccount)
      .values({
        labId,
        label: labRow.name,
        defaultPatientId: patientId,
        sessionPartition: `${SESSION_PARTITION_PREFIX}${randomUUID()}`,
      })
      .returning()
      .get()
    dataChanged(this.events, 'labs')
    return row
  }

  setAccountPatient(id: number, patientId: number): void {
    this.getAccount(id)
    this.db.update(labAccount).set({ defaultPatientId: patientId }).where(eq(labAccount.id, id)).run()
    dataChanged(this.events, 'labs')
  }

  /**
   * Takes the account's name and id from the lab's own pages, once someone is logged in. Pages that
   * name nobody leave the label the account has: its lab's name to begin with.
   */
  recordIdentity(id: number, { externalId, label }: LabAccountInfo): void {
    this.db
      .update(labAccount)
      .set(label === null ? { externalAccountId: externalId } : { externalAccountId: externalId, label })
      .where(eq(labAccount.id, id))
      .run()
  }

  markSynced(id: number, at: string): void {
    this.db.update(labAccount).set({ lastSyncAt: at }).where(eq(labAccount.id, id)).run()
  }

  /** Removes the account; its orders stay. Returns it so the caller can forget its session. */
  removeAccount(id: number): LabAccountRow {
    const row = this.getAccount(id)
    this.db.delete(labAccount).where(eq(labAccount.id, id)).run()
    dataChanged(this.events, 'labs')
    return row
  }

  /** Markers go round the palette in order of creation. */
  private nextMarker(): { markerColor: string; markerShape: MarkerShape } {
    const n = this.db.select({ n: count() }).from(lab).get()?.n ?? 0
    const marker = LAB_MARKERS[n % LAB_MARKERS.length] ?? LAB_MARKERS[0]
    if (!marker) throw new Error('LAB_MARKERS is empty')
    return { markerColor: marker.color, markerShape: marker.shape }
  }
}
