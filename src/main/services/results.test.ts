import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../db/client'
import { analyte, unit } from '../db/schema'
import type { RawOrder, RawResult } from '../lab/types'
import { createTestServices } from '../test-support'
import type { AnalyteService } from './analytes'
import type { OrderService } from './orders'
import type { ResultReader } from './results'

const GLUCOSE_CODE = '1.1.A1.1'
const GLUCOSE_MOLAR_MASS = 180.16

function glucose(value: string): RawResult {
  return {
    labCode: GLUCOSE_CODE,
    labName: 'Глюкоза',
    value,
    printed: `${value} ммоль/л`,
    reference: '3.9-5.5 ммоль/л',
    flag: null,
  }
}

const BILE_ACIDS: RawResult = {
  labCode: '1.9.C1.1',
  labName: 'Жёлчные кислоты',
  value: '4.1',
  printed: '4.1 мкмоль/л',
  reference: '0-10 мкмоль/л',
  flag: 'normal',
}

function order(externalKey: string, collectedOn: string, results: RawResult[], pdf = false): RawOrder {
  return {
    externalKey,
    collectedOn,
    results,
    rawPayload: JSON.stringify({ collectedOn, results }),
    pdf: pdf ? new TextEncoder().encode(`%PDF ${externalKey}`) : null,
  }
}

describe('reading results', () => {
  let db: Db
  let analytes: AnalyteService
  let reader: ResultReader
  let orders: OrderService
  let annaId: number
  let glucoseId: number

  beforeEach(() => {
    const app = createTestServices()
    ;({ db, analytes } = app)
    annaId = app.anna.id
    app.importer.importOrders(
      { labId: app.kdlId, labAccountId: null, patientId: annaId, connectorVersion: 'test' },
      [
        order('2:1', '2025-03-01', [glucose('5.1')]),
        order('2:2', '2026-08-08', [glucose('6.20'), BILE_ACIDS], true),
      ],
    )
    reader = app.results
    orders = app.orders
    const row = db.select().from(analyte).where(eq(analyte.name, 'Глюкоза')).get()
    if (!row) throw new Error('The import created glucose')
    glucoseId = row.id
  })

  it("shows a patient's results for an analyte newest first, judged against their reference", () => {
    const view = reader.forAnalyte(glucoseId, annaId)
    expect(view.analyte).toMatchObject({ name: 'Глюкоза', reviewed: false })
    expect(view.analyte.aliases).toEqual([expect.objectContaining({ labCode: GLUCOSE_CODE })])
    expect(view.rows.map((r) => [r.collectedOn, r.read.value.number?.text, r.read.deviation])).toEqual([
      ['2026-08-08', '6,20', 'high'],
      ['2025-03-01', '5,1', 'normal'],
    ])
  })

  it('shows every result in the unit the person chose for the analyte', () => {
    const mgDl = db.select().from(unit).where(eq(unit.code, 'mg/dL')).get()
    if (!mgDl) throw new Error('mg/dL is a built-in unit')
    db.update(analyte).set({ molarMass: GLUCOSE_MOLAR_MASS }).where(eq(analyte.id, glucoseId)).run()
    db.run(`INSERT INTO analyte_unit (analyte_id, unit_id) VALUES (${glucoseId}, ${mgDl.id})`)

    analytes.setDisplayUnit(glucoseId, mgDl.id)
    const view = reader.forAnalyte(glucoseId, annaId)
    expect(view.unitId).toBe(mgDl.id)
    expect(view.units.every((u) => u.convertible)).toBe(true)
    expect(view.rows[0]?.read.value).toMatchObject({ number: { text: '112' }, unitId: mgDl.id })
    expect(view.rows[0]?.read.reference).toMatchObject({ low: { text: '70' }, high: { text: '99' } })

    const foreign = db.select().from(unit).where(eq(unit.code, 'U/L')).get()
    expect(() => analytes.setDisplayUnit(glucoseId, foreign?.id ?? -1)).toThrow('не относится к показателю')
  })

  it('summarizes orders with their deviations and opens one with its results', () => {
    const list = orders.list(annaId)
    expect(list.map((o) => [o.collectedOn, o.resultCount, o.deviationCount, o.hasForm])).toEqual([
      ['2026-08-08', 2, 1, true],
      ['2025-03-01', 1, 0, false],
    ])
    const latest = orders.get(list[0]?.id ?? -1)
    expect(latest.results.map((r) => r.analyteName)).toEqual(['Глюкоза', 'Жёлчные кислоты'])
    expect(orders.formPath(latest.id)).toMatch(/\.pdf$/)
    expect(() => orders.formPath(list[1]?.id ?? -1)).toThrow('нет бланка')
  })
})

describe('analyte search', () => {
  let analytes: AnalyteService
  let annaId: number
  let otherId: number

  beforeEach(() => {
    const app = createTestServices()
    analytes = app.analytes
    annaId = app.anna.id
    otherId = app.patients.create({ title: 'Пётр', sex: 'male', birthDate: '1988-01-02', note: null }).id
    const target = { labId: app.kdlId, labAccountId: null, connectorVersion: 'test' }
    app.importer.importOrders({ ...target, patientId: annaId }, [
      order('2:1', '2026-08-08', [glucose('5.1')]),
    ])
    app.importer.importOrders({ ...target, patientId: otherId }, [order('2:2', '2026-08-09', [BILE_ACIDS])])
  })

  it('finds by part of the name, ignoring case and ё', () => {
    expect(analytes.search('ГЛЮК', annaId).map((h) => h.name)).toEqual(['Глюкоза'])
    expect(analytes.search('желчн', annaId).map((h) => h.name)).toEqual(['Жёлчные кислоты'])
  })

  it('finds by lab code and says what matched', () => {
    expect(analytes.search('A1.1', annaId)).toEqual([
      expect.objectContaining({ name: 'Глюкоза', matched: GLUCOSE_CODE }),
    ])
  })

  it("puts the patient's own analytes first, with how many results they have", () => {
    const hits = analytes.search('.1', otherId)
    expect(hits.map((h) => [h.name, h.resultCount, h.lastCollectedOn])).toEqual([
      ['Жёлчные кислоты', 1, '2026-08-09'],
      ['Глюкоза', 0, null],
    ])
  })

  it('takes wildcards in the query literally', () => {
    expect(analytes.search('%', annaId)).toEqual([])
    expect(analytes.search('   ', annaId)).toEqual([])
  })
})
