import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { labOrder } from '../db/schema'
import type { LabPerson, OrderRef, RawOrder } from '../lab/types'
import { createTestServices } from '../test-support'

/** Made-up people of one lab account, named as a lab names them. */
const ANNA: LabPerson = { key: 'profile-1', name: 'Иванова Анна Петровна', birthDate: '1990-05-14' }
const PETER: LabPerson = { key: 'profile-2', name: 'Иванов Пётр Сергеевич', birthDate: '2015-03-01' }

function ref(externalKey: string, person?: LabPerson): OrderRef {
  return { externalKey, collectedOn: '2026-07-15', data: null, ...(person ? { person } : {}) }
}

function order(externalKey: string, collectedOn = '2026-07-15'): RawOrder {
  const glucose = {
    labCode: 'GLU',
    labName: 'Глюкоза',
    value: '5.4',
    printed: '5.4 ммоль/л',
    reference: null,
    flag: null,
  }
  return { externalKey, collectedOn, results: [glucose], rawPayload: externalKey, forms: [] }
}

describe('LabPeople', () => {
  let app: ReturnType<typeof createTestServices>
  let accountId: number
  let peter: number

  beforeEach(() => {
    app = createTestServices()
    accountId = app.labs.createAccount(app.kdlId, app.anna.id).id
    peter = app.patients.create({ title: 'Пётр', sex: 'male', birthDate: '2015-03-01', note: null }).id
  })

  /** Imports orders for the person as a sync would, into the patient chosen for them. */
  function importFor(personId: number, patientId: number, ...orders: RawOrder[]): void {
    app.importer.importOrders(
      { labId: app.kdlId, labAccountId: accountId, patientId, labPersonId: personId, connectorVersion: 't' },
      orders,
    )
  }

  function personOf(person: LabPerson) {
    const found = app.people.list(accountId).find((p) => p.name === person.name)
    if (!found) throw new Error(`${person.name} is not recorded`)
    return found
  }

  it("notes the account's people as the lab lists them, each waiting for a choice", () => {
    app.people.record(accountId, [ref('1', ANNA), ref('2', PETER), ref('3', PETER), ref('4')])
    expect(app.people.list(accountId)).toEqual([
      {
        id: expect.any(Number),
        name: ANNA.name,
        birthDate: ANNA.birthDate,
        orderCount: 1,
        importedCount: 0,
        patientId: null,
        skipped: false,
        suggestedPatientId: app.anna.id,
      },
      expect.objectContaining({
        name: PETER.name,
        orderCount: 2,
        patientId: null,
        suggestedPatientId: peter,
      }),
    ])
    // The lab renamed her and listed one more order.
    const renamed = { ...ANNA, name: 'Петрова Анна Петровна' }
    app.people.record(accountId, [ref('1', renamed), ref('5', renamed)])
    expect(app.people.list(accountId)[0]).toMatchObject({ name: 'Петрова Анна Петровна', orderCount: 2 })
  })

  it("routes an order by its person's choice, and an order of nobody to the account's patient", () => {
    app.people.record(accountId, [ref('1', ANNA), ref('2', PETER)])
    const route = () => app.people.router({ id: accountId, defaultPatientId: app.anna.id })
    expect(route()(ref('1', ANNA))).toEqual({ kind: 'waiting' })
    expect(route()(ref('9'))).toEqual({ kind: 'patient', patientId: app.anna.id, labPersonId: null })

    const anna = personOf(ANNA)
    app.people.assign(anna.id, app.anna.id)
    app.people.assign(personOf(PETER).id, null)
    expect(route()(ref('1', ANNA))).toEqual({ kind: 'patient', patientId: app.anna.id, labPersonId: anna.id })
    expect(route()(ref('2', PETER))).toEqual({ kind: 'skipped' })

    // A patient deleted in the app takes nobody's orders: the person waits for a new choice.
    app.patients.remove(app.anna.id)
    expect(route()(ref('1', ANNA))).toEqual({ kind: 'waiting' })
    expect(personOf(ANNA).patientId).toBeNull()
  })

  it('offers the patient born the same day, and tells twins apart by name', () => {
    const twinsBorn = '2018-06-02'
    const namesakesBorn = '2019-01-01'
    const maria = app.patients.create({ title: 'Мария', sex: 'female', birthDate: twinsBorn, note: null })
    app.patients.create({ title: 'Дарья', sex: 'female', birthDate: twinsBorn, note: null })
    app.patients.create({ title: 'Маша', sex: 'female', birthDate: namesakesBorn, note: null })
    app.patients.create({ title: 'Вторая Маша', sex: 'female', birthDate: namesakesBorn, note: null })
    app.people.record(accountId, [
      ref('1', { key: 'twin', name: 'Иванова Мария Петровна', birthDate: twinsBorn }),
      ref('2', { key: 'nickname', name: 'Иванова Мария Петровна', birthDate: namesakesBorn }),
      ref('3', { key: 'stranger', name: 'Сидоров Олег', birthDate: '1975-11-30' }),
      ref('4', { key: 'unknown-birth', name: 'Иванов Пётр', birthDate: null }),
    ])
    expect(app.people.list(accountId).map((p) => p.suggestedPatientId)).toEqual([maria.id, null, null, null])
  })

  it('moves a person’s orders to the patient chosen instead, and deletes them when kept out', () => {
    app.people.record(accountId, [ref('a', ANNA), ref('b', ANNA)])
    const anna = personOf(ANNA)
    app.people.assign(anna.id, app.anna.id)
    importFor(anna.id, app.anna.id, order('a'), order('b'))
    const [first] = app.people.list(accountId)
    expect(first?.importedCount).toBe(2)
    const imported = app.db.select().from(labOrder).all()
    app.orders.setCyclePhase(imported[0]?.id ?? -1, 'follicular')

    // She was Peter all along: the orders follow, without a cycle phase a boy cannot have had.
    app.people.assign(anna.id, peter)
    const moved = app.db.select().from(labOrder).all()
    expect(moved.map((o) => [o.patientId, o.cyclePhase])).toEqual([
      [peter, null],
      [peter, null],
    ])

    app.people.assign(anna.id, null)
    expect(app.db.select().from(labOrder).all()).toEqual([])
    expect(personOf(ANNA)).toMatchObject({ skipped: true, patientId: null, importedCount: 0 })
  })

  it('refuses a choice that cannot be, and leaves everything as it was', () => {
    app.people.record(accountId, [ref('a', ANNA)])
    const anna = personOf(ANNA)
    app.people.assign(anna.id, app.anna.id)
    importFor(anna.id, app.anna.id, order('a', '2010-01-10'))
    // Peter was born after the sample was taken.
    expect(() => app.people.assign(anna.id, peter)).toThrow('Дата сдачи раньше даты рождения пациента')
    expect(personOf(ANNA).patientId).toBe(app.anna.id)
    expect(app.db.select().from(labOrder).where(eq(labOrder.patientId, app.anna.id)).all()).toHaveLength(1)
    expect(() => app.people.assign(-1, peter)).toThrow('Этого человека в кабинете уже нет')
  })
})
