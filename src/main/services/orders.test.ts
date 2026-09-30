import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ManualOrder, ResultInput } from '@shared/api'
import { labOrder, result, unit } from '../db/schema'
import { createTestServices, TEST_TODAY } from '../test-support'

type App = ReturnType<typeof createTestServices>

describe('entering orders by hand', () => {
  let app: App
  let glucose: number
  let crp: number
  let mmol: number
  let mgDl: number
  let mgL: number

  const unitId = (code: string) => app.db.select().from(unit).where(eq(unit.code, code)).get()?.id ?? -1

  function order(results: ResultInput[], overrides: Partial<ManualOrder> = {}): ManualOrder {
    return {
      patientId: app.anna.id,
      labId: app.kdlId,
      collectedOn: '2026-09-01',
      collectedTime: null,
      cyclePhase: null,
      note: null,
      formFile: null,
      results,
      ...overrides,
    }
  }

  function row(analyteId: number, rawValue: string, unit: number | null): ResultInput {
    return { analyteId, rawValue, unitId: unit, refRaw: null, note: null }
  }

  beforeEach(() => {
    app = createTestServices()
    mmol = unitId('mmol/L')
    mgDl = unitId('mg/dL')
    mgL = unitId('mg/L')
    glucose = app.analytes.create({
      name: 'Глюкоза',
      specimen: 'blood',
      description: null,
      valueKind: 'numeric',
      canonicalUnitId: mmol,
      molarMass: 180.16,
      reviewed: true,
    }).id
    app.analytes.setUnit(glucose, mgDl, null)
    crp = app.analytes.create({
      name: 'С-реактивный белок',
      specimen: 'serum',
      description: null,
      valueKind: 'numeric',
      canonicalUnitId: mgL,
      molarMass: null,
      reviewed: true,
    }).id
  })

  it('stores results as typed and reads them like a lab’s', () => {
    const id = app.orders.create(
      order([{ ...row(glucose, ' 5,40 ', mmol), refRaw: '3,9–5,5' }, row(crp, '<0,1', mgL)]),
    )
    const details = app.orders.get(id)
    expect(details).toMatchObject({ source: 'manual', resultCount: 2 })
    expect(
      details.results.map((r) => [r.rawValue, r.read.value.number?.text, r.read.value.comparator]),
    ).toEqual([
      ['5,40', '5,40', null],
      ['<0,1', '0,1', '<'],
    ])
    expect(details.results[0]?.read.reference).toMatchObject({ source: 'lab', low: { text: '3,9' } })
  })

  it('refuses what cannot be right', () => {
    const create = (o: ManualOrder) => () => app.orders.create(o)
    expect(create(order([]))).toThrow('хотя бы один')
    expect(create(order([row(glucose, '5', mmol)], { collectedOn: '2999-01-01' }))).toThrow('в будущем')
    expect(create(order([row(glucose, '5', mmol)], { collectedOn: '1980-01-01' }))).toThrow(
      'раньше даты рождения',
    )
    expect(create(order([row(glucose, '5', mmol)], { collectedTime: '25:00' }))).toThrow('ЧЧ:ММ')
    expect(create(order([row(glucose, '5', mgL)]))).toThrow('не относится к «Глюкоза»')
    expect(create(order([row(glucose, '5', null)]))).toThrow('укажите единицу')
    expect(create(order([row(glucose, '  ', mmol)]))).toThrow('введите значение')
    expect(create(order([row(glucose, '5', mmol), row(glucose, '6', mmol)]))).toThrow(
      'Строка 2: «Глюкоза» уже есть',
    )
    const petr = app.patients.create({ title: 'Пётр', sex: 'male', birthDate: '1988-01-02', note: null })
    expect(create(order([row(glucose, '5', mmol)], { patientId: petr.id, cyclePhase: 'luteal' }))).toThrow(
      'только у женщин',
    )
    // A qualitative answer needs no unit.
    expect(app.orders.create(order([row(crp, 'не обнаружено', null)]))).toBeGreaterThan(0)
  })

  it('warns about a value ten times off the previous one, comparing in one unit', () => {
    app.orders.create(order([row(glucose, '5,4', mmol)], { collectedOn: '2026-08-01' }))
    const check = (value: string, unit: number) =>
      app.orders.check(order([row(crp, '3', mgL), row(glucose, value, unit)]))
    expect(check('5,9', mmol)).toEqual([])
    // 97 mg/dL is 5,4 mmol/L: the same value in another unit.
    expect(check('97', mgDl)).toEqual([])
    expect(check('54', mmol)).toEqual([{ row: 1, message: expect.stringContaining('В 10 раз') }])
    expect(check('54', mmol)[0]?.message).toContain('5,4 ммоль/л от 01.08.2026')
  })

  it('corrects results, keeping a lab’s corrected result from being overwritten', () => {
    app.importer.importOrders(
      { labId: app.kdlId, labAccountId: null, patientId: app.anna.id, connectorVersion: 'test' },
      [
        {
          externalKey: 'k1',
          collectedOn: '2026-08-08',
          results: [
            {
              labCode: 'CRP',
              labName: 'СРБ',
              value: '4',
              printed: '4 мг/л',
              reference: '<5 мг/л',
              flag: null,
            },
          ],
          rawPayload: 'k1',
          pdf: null,
        },
      ],
    )
    const imported = app.db.select().from(result).where(eq(result.externalKey, 'CRP')).get()
    if (!imported) throw new Error('fixture')
    app.orders.updateResult(imported.id, {
      ...row(imported.analyteId, '14', imported.unitId),
      refRaw: '<5 мг/л',
    })
    expect(app.db.select().from(result).where(eq(result.id, imported.id)).get()).toMatchObject({
      rawValue: '14',
      userEdited: true,
    })

    const manual = app.orders.create(order([row(glucose, '5', mmol)]))
    const typed = app.orders.get(manual).results[0]
    app.orders.updateResult(typed?.id ?? -1, row(glucose, '5,1', mmol))
    expect(
      app.db
        .select()
        .from(result)
        .where(eq(result.id, typed?.id ?? -1))
        .get()?.userEdited,
    ).toBe(false)

    expect(() => app.orders.addResult(manual, row(glucose, '6', mmol))).toThrow('уже есть')
    app.orders.addResult(manual, row(crp, '2', mgL))
    app.orders.removeResult(typed?.id ?? -1)
    expect(app.orders.get(manual).results.map((r) => r.analyteName)).toEqual(['С-реактивный белок'])
  })

  it('deletes an order and brings it back once', () => {
    const id = app.orders.create(order([row(glucose, '5', mmol), row(crp, '1', mgL)], { note: 'натощак' }))
    const token = app.orders.remove(id)
    expect(app.db.select().from(labOrder).where(eq(labOrder.id, id)).get()).toBeUndefined()
    app.orders.undoRemove(token)
    expect(app.orders.get(id)).toMatchObject({ note: 'натощак', resultCount: 2 })
    expect(() => app.orders.undoRemove(token)).toThrow('уже не вернуть')
  })

  it('corrects the order itself', () => {
    const id = app.orders.create(order([row(glucose, '5', mmol)]))
    const other = app.labs.create('Лаборатория у дома')
    app.orders.update(id, {
      ...order([]),
      labId: other.id,
      collectedOn: TEST_TODAY,
      collectedTime: '08:30',
      note: ' натощак ',
    })
    expect(app.orders.get(id)).toMatchObject({
      labId: other.id,
      collectedOn: TEST_TODAY,
      collectedTime: '08:30',
      note: 'натощак',
    })
    expect(() => app.labs.create('лаборатория у ДОМА')).toThrow('уже есть')
    expect(other.markerShape).not.toBe(app.labs.list()[0]?.markerShape)
  })

  it('never lets an unknown file name stand for a form', () => {
    expect(() =>
      app.orders.create(order([row(glucose, '5', mmol)], { formFile: '../../etc/passwd' })),
    ).toThrow('Not an attachment key')
    const key = app.attachments.store(new TextEncoder().encode('photo'), 'jpg')
    const id = app.orders.create(order([row(glucose, '5', mmol)], { formFile: key }))
    expect(app.orders.formPath(id)).toMatch(/\.jpg$/)
  })
})
