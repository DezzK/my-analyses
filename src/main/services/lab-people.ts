import { eq } from 'drizzle-orm'
import type { AccountPerson, Patient } from '@shared/api'
import { foldCase } from '@shared/domain/text'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { labPerson } from '../db/schema'
import { inTransaction } from '../db/transaction'
import { dataChanged, type EventSink } from '../events'
import type { LabPerson, OrderRef } from '../lab/types'
import type { OrderService } from './orders'
import type { PatientService } from './patients'

/** Where an order goes: to a patient, nowhere until someone says whose it is, or nowhere at all. */
export type OrderDestination =
  | { kind: 'patient'; patientId: number; labPersonId: number | null }
  | { kind: 'waiting' }
  | { kind: 'skipped' }

type LabPersonRow = typeof labPerson.$inferSelect

/** A choice holds while its patient does: one deleted in the app takes nobody's orders. */
function chosenPatient(row: LabPersonRow, live: ReadonlySet<number>): number | null {
  return row.patientId !== null && live.has(row.patientId) ? row.patientId : null
}

/**
 * The patient a lab's person most likely is: the one born the same day, and among twins the one
 * whose name in the app is a word of the person's name. Only ever offered, never assumed.
 */
function suggestedPatient(row: LabPersonRow, patients: readonly Patient[]): number | null {
  const born = patients.filter((p) => row.birthDate !== null && p.birthDate === row.birthDate)
  if (born.length <= 1) return born[0]?.id ?? null
  const words = new Set(foldCase(row.name).split(/\s+/))
  const named = born.filter((p) =>
    foldCase(p.title)
      .split(/\s+/)
      .some((word) => words.has(word)),
  )
  return named.length === 1 ? (named[0]?.id ?? null) : null
}

/**
 * Whose each order of a lab account is. A lab that names people (an account may hold a whole
 * family's orders) has each one's orders go to the patient the person using the app chose for
 * them, once per person; until then that person's orders wait. An order the lab names nobody for
 * is the account's patient's.
 */
export class LabPeople {
  constructor(
    private readonly deps: { db: Db; events: EventSink; patients: PatientService; orders: OrderService },
  ) {}

  /** Notes the people the account's orders belong to, as the lab listed them; newcomers wait. */
  record(accountId: number, refs: readonly OrderRef[]): void {
    const seen = new Map<string, { person: LabPerson; orders: number }>()
    for (const { person } of refs) {
      if (person) seen.set(person.key, { person, orders: (seen.get(person.key)?.orders ?? 0) + 1 })
    }
    if (seen.size === 0) return
    const { db } = this.deps
    inTransaction(db, () => {
      for (const { person, orders } of seen.values()) {
        const fields = { name: person.name, birthDate: person.birthDate, orderCount: orders }
        db.insert(labPerson)
          .values({ labAccountId: accountId, personKey: person.key, ...fields })
          .onConflictDoUpdate({ target: [labPerson.labAccountId, labPerson.personKey], set: fields })
          .run()
      }
    })
    dataChanged(this.deps.events, 'labs')
  }

  /** Where the account's orders go, by the choices as they stand now. */
  router(account: { id: number; defaultPatientId: number }): (ref: OrderRef) => OrderDestination {
    const rows = this.rows(account.id)
    const live = new Set(this.deps.patients.list().map((p) => p.id))
    return ({ person }) => {
      if (!person) return { kind: 'patient', patientId: account.defaultPatientId, labPersonId: null }
      const row = rows.find((r) => r.personKey === person.key)
      if (row?.skipped) return { kind: 'skipped' }
      const patientId = row ? chosenPatient(row, live) : null
      return row && patientId !== null
        ? { kind: 'patient', patientId, labPersonId: row.id }
        : { kind: 'waiting' }
    }
  }

  list(accountId: number): AccountPerson[] {
    const rows = this.rows(accountId)
    if (rows.length === 0) return []
    const patients = this.deps.patients.list()
    const live = new Set(patients.map((p) => p.id))
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      birthDate: row.birthDate,
      orderCount: row.orderCount,
      importedCount: this.deps.orders.ofLabPerson(row.id).length,
      patientId: chosenPatient(row, live),
      skipped: row.skipped,
      suggestedPatientId: suggestedPatient(row, patients),
    }))
  }

  /**
   * Sends the person's orders to the patient from now on, along with the ones already in the app;
   * null keeps them out and deletes those. Returns the person's account.
   */
  assign(personId: number, patientId: number | null): number {
    const { db, orders } = this.deps
    const row = db.select().from(labPerson).where(eq(labPerson.id, personId)).get()
    if (!row) throw new UserError('Этого человека в кабинете уже нет')
    inTransaction(db, () => {
      const imported = orders.ofLabPerson(personId)
      if (patientId === null) orders.purge(imported)
      else orders.moveToPatient(imported, patientId)
      db.update(labPerson)
        .set({ patientId, skipped: patientId === null })
        .where(eq(labPerson.id, personId))
        .run()
    })
    dataChanged(this.deps.events, 'labs')
    return row.labAccountId
  }

  private rows(accountId: number): LabPersonRow[] {
    return this.deps.db
      .select()
      .from(labPerson)
      .where(eq(labPerson.labAccountId, accountId))
      .orderBy(labPerson.id)
      .all()
  }
}
