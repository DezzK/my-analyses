import { existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AttachmentStore } from '../attachments'
import type { OrderForms } from '../services/order-forms'
import type { Db } from '../db/client'
import { analyte, labOrder, result, unit } from '../db/schema'
import type { RawOrder, RawResult } from '../lab/types'
import { createTestServices } from '../test-support'
import type { ImportService, ImportTarget } from './importer'

const GLUCOSE: RawResult = {
  labCode: '1.1.A1.1',
  labName: 'Глюкоза',
  value: '5.40',
  printed: '5.40 ммоль/л',
  reference: '3.9-5.5 ммоль/л',
  flag: 'normal',
}
const RESULTS: RawResult[] = [
  GLUCOSE,
  {
    labCode: '1.1.A1.2',
    labName: 'Гемоглобин',
    value: '142',
    printed: '142 г/л',
    reference: '120-140',
    flag: 'high',
  },
  {
    labCode: '1.1.A1.3',
    labName: 'ТТГ',
    value: '2.1',
    printed: '2.1',
    reference: '0.4-4.0 мкМЕ/мл',
    flag: 'normal',
  },
  {
    labCode: '2.1.B1.1',
    labName: 'Белок в моче',
    value: null,
    printed: 'не обнаружено',
    reference: null,
    flag: null,
  },
  {
    labCode: '9.9.C1.1',
    labName: 'Антитела',
    value: '12',
    printed: '12 Ед.акт/мл',
    reference: null,
    flag: null,
  },
]

function order(results: RawResult[], externalKey = '5:1001'): RawOrder {
  return {
    externalKey,
    collectedOn: '2026-08-08',
    results,
    rawPayload: JSON.stringify(results),
    forms: [],
  }
}

describe('ImportService', () => {
  let db: Db
  let importer: ImportService
  let attachments: AttachmentStore
  let forms: OrderForms
  let target: ImportTarget

  beforeEach(() => {
    const app = createTestServices()
    ;({ db, importer, attachments, forms } = app)
    target = { labId: app.kdlId, labAccountId: null, patientId: app.anna.id, connectorVersion: 'test' }
  })

  it('stores a new order, its results and a new analyte per test code', () => {
    const stats = importer.importOrders(target, [order(RESULTS)])
    expect(stats).toMatchObject({ ordersAdded: 1, resultsAdded: 5, analytesCreated: 5, unknownUnits: 1 })

    const rows = db.select().from(result).all()
    const glucose = rows.find((r) => r.externalKey === GLUCOSE.labCode)
    expect(glucose).toMatchObject({ rawValue: '5.40', refRaw: '3.9-5.5 ммоль/л', labFlag: 'normal' })
    const glucoseUnit = db
      .select()
      .from(unit)
      .where(eq(unit.id, glucose?.unitId ?? -1))
      .get()
    expect(glucoseUnit?.code).toBe('mmol/L')

    // The unit came from the reference when the printed value had none.
    const tsh = rows.find((r) => r.externalKey === '1.1.A1.3')
    expect(
      db
        .select()
        .from(unit)
        .where(eq(unit.id, tsh?.unitId ?? -1))
        .get()?.code,
    ).toBe('uIU/mL')

    const protein = db.select().from(analyte).where(eq(analyte.name, 'Белок в моче')).get()
    expect(protein).toMatchObject({ specimen: 'urine', valueKind: 'qualitative', reviewed: false })
    expect(rows.find((r) => r.externalKey === '2.1.B1.1')?.rawValue).toBe('не обнаружено')
  })

  it('changes nothing when the lab reports the same order again', () => {
    importer.importOrders(target, [order(RESULTS)])
    const stats = importer.importOrders(target, [order(RESULTS)])
    expect(stats).toMatchObject({ ordersUnchanged: 1, ordersAdded: 0, resultsAdded: 0, analytesCreated: 0 })
    expect(db.select().from(labOrder).all()).toHaveLength(1)
  })

  it("applies the lab's correction but keeps a result the person edited", () => {
    importer.importOrders(target, [order(RESULTS)])
    const corrected = [{ ...GLUCOSE, value: '5.60', printed: '5.60 ммоль/л' }, ...RESULTS.slice(1)]
    expect(importer.importOrders(target, [order(corrected)])).toMatchObject({
      ordersUpdated: 1,
      resultsUpdated: 1,
    })

    db.update(result)
      .set({ rawValue: '5.5', userEdited: true })
      .where(eq(result.externalKey, GLUCOSE.labCode))
      .run()
    const again = [{ ...GLUCOSE, value: '5.70', printed: '5.70 ммоль/л' }, ...RESULTS.slice(1)]
    expect(importer.importOrders(target, [order(again)])).toMatchObject({
      resultsKeptEdited: 1,
      resultsUpdated: 0,
    })
    expect(db.select().from(result).where(eq(result.externalKey, GLUCOSE.labCode)).get()?.rawValue).toBe(
      '5.5',
    )
  })

  it('maps a known test code of a later order onto the same analyte', () => {
    importer.importOrders(target, [order(RESULTS)])
    const stats = importer.importOrders(target, [order([GLUCOSE], '5:1002')])
    expect(stats).toMatchObject({ ordersAdded: 1, analytesCreated: 0 })
    expect(
      new Set(
        db
          .select()
          .from(result)
          .all()
          .map((r) => r.analyteId),
      ).size,
    ).toBe(5)
  })

  it("keeps every original form next to the order, in the lab's order, until the lab sends others", () => {
    const pdfs = (...texts: string[]) => texts.map((text) => new TextEncoder().encode(`%PDF-1.7 ${text}`))
    importer.importOrders(target, [{ ...order(RESULTS), forms: pdfs('first sample', 'second sample') }])
    const orderId = db.select().from(labOrder).get()?.id ?? -1
    const stored = forms.of(orderId)
    expect(stored).toHaveLength(2)
    expect(
      stored.every((file) => /^[0-9a-f]{64}\.pdf$/.test(file) && existsSync(attachments.path(file))),
    ).toBe(true)
    expect(importer.needsForms(target.labId, order(RESULTS))).toBe(false)

    // A later import that fetched no forms keeps the stored ones; one that fetched new ones replaces them.
    expect(importer.importOrders(target, [order(RESULTS)]).ordersUnchanged).toBe(1)
    expect(forms.of(orderId)).toEqual(stored)
    importer.importOrders(target, [{ ...order(RESULTS), forms: pdfs('reissued') }])
    expect(forms.of(orderId)).toHaveLength(1)
  })

  it('indexes new analytes for search by name and lab code', () => {
    importer.importOrders(target, [order(RESULTS)])
    const find = (q: string) =>
      db.$client.prepare('SELECT analyte_id FROM analyte_search WHERE analyte_search MATCH ?').all(q)
    expect(find('глюкоз')).toHaveLength(1)
    expect(find('"1.1.A1.2"')).toHaveLength(1)
  })
})
