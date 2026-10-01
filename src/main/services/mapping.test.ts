import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { result, unit } from '../db/schema'
import type { RawOrder, RawResult } from '../lab/types'
import { createTestServices } from '../test-support'

type App = ReturnType<typeof createTestServices>

function raw(
  labCode: string,
  labName: string,
  printed: string,
  reference: string,
  flag: RawResult['flag'] = null,
) {
  return { labCode, labName, value: null, printed, reference, flag }
}

function order(externalKey: string, collectedOn: string, results: RawResult[]): RawOrder {
  return { externalKey, collectedOn, results, rawPayload: externalKey, forms: [] }
}

describe('the mapping queue', () => {
  let app: App
  let helixId: number
  const kdl = () => ({
    labId: app.kdlId,
    labAccountId: null,
    patientId: app.anna.id,
    connectorVersion: 'test',
  })

  beforeEach(() => {
    app = createTestServices()
    helixId = app.labs.list().find((lab) => lab.name === 'Хеликс')?.id ?? -1
    app.importer.importOrders(kdl(), [
      order('k1', '2026-08-08', [
        raw('TSH', 'Тиреотропный гормон (ТТГ)', '2.1 мкМЕ/мл', '0.4-4.0 мкМЕ/мл'),
        raw('AB', 'Антитела к ТПО', '12 Ед.акт/мл', '<35 Ед.акт/мл'),
        raw('GLU', 'Глюкоза', '5.2 ммоль/л', '3.9-5.5 ммоль/л', 'high'),
      ]),
    ])
  })

  it('lists what imports created that the dictionary does not know, and takes accepted analytes off it', () => {
    const queue = app.mapping.queue(app.anna.id)
    // TSH and glucose are the dictionary's; it knows the antibodies in units, not in «Ед.акт/мл».
    expect(queue.analytes.map((a) => a.name)).toEqual(['Антитела к ТПО'])
    expect(queue.units).toEqual([
      expect.objectContaining({ display: 'Ед.акт/мл', resultCount: 1, analyteNames: ['Антитела к ТПО'] }),
    ])
    app.analytes.setReviewed(
      queue.analytes.map((a) => a.id),
      true,
    )
    expect(app.mapping.queue(app.anna.id).analytes).toEqual([])
    app.analytes.setReviewed([queue.analytes[0]?.id ?? -1], false)
    expect(app.mapping.queue(app.anna.id).analytes).toHaveLength(1)
  })

  it("lists the dictionary's merges by the analyte they went into, until the person looks at them", () => {
    app.importer.importOrders({ ...kdl(), labId: helixId }, [
      order('h1', '2026-09-01', [raw('H-TSH', 'Тиреотропный гормон', '2.4 мкМЕ/мл', '0.35-4.94 мкМЕ/мл')]),
    ])
    const { merges } = app.mapping.queue(app.anna.id)
    expect(merges).toEqual([
      {
        targetId: app.analytes.findByLabCode(app.kdlId, 'TSH')?.id,
        targetName: 'Тиреотропный гормон (ТТГ)',
        merged: [
          {
            mergeId: expect.any(Number),
            name: 'Тиреотропный гормон',
            codes: [{ labId: helixId, code: 'H-TSH', analysis: null }],
          },
        ],
      },
    ])
    const mergeIds = merges.flatMap((m) => m.merged.map((one) => one.mergeId))
    app.merges.setReviewed(mergeIds, true)
    expect(app.mapping.queue(app.anna.id).merges).toEqual([])
    app.merges.setReviewed(mergeIds, false)
    expect(app.mapping.queue(app.anna.id).merges).toHaveLength(1)
  })

  it('maps an unknown spelling onto a unit, for the stored results and for every later import', () => {
    const [unknown] = app.mapping.queue(app.anna.id).units
    const uml = app.db.select().from(unit).where(eq(unit.code, 'U/mL')).get()
    if (!unknown || !uml) throw new Error('fixture')
    app.units.map(unknown.id, uml.id)
    expect(app.db.select().from(result).where(eq(result.unitId, uml.id)).all()).toHaveLength(1)
    expect(app.db.select().from(unit).where(eq(unit.id, unknown.id)).get()).toBeUndefined()
    expect(app.units.resolve('ед.акт/мл')?.id).toBe(uml.id)
    expect(app.mapping.queue(app.anna.id).units).toEqual([])
    expect(() => app.units.map(uml.id, unknown.id)).toThrow('уже сопоставлена')
  })

  it('keeps an unknown spelling as a unit of its own when told to', () => {
    const [unknown] = app.mapping.queue(app.anna.id).units
    app.units.accept(unknown?.id ?? -1)
    expect(app.mapping.queue(app.anna.id).units).toEqual([])
    expect(app.units.resolve('Ед.акт/мл')?.id).toBe(unknown?.id)
  })

  it("suggests the same analyte from another lab by the words of its name, never the lab's own", () => {
    app.importer.importOrders({ ...kdl(), labId: helixId }, [
      order('h1', '2026-09-01', [
        raw('H-TPO', 'Антитела к тиреопероксидазе', '15 Ед.акт/мл', '<35 Ед.акт/мл'),
        // Shares a word with Helix's anti-TPO, but Helix does not measure one thing under two codes.
        raw('H-TG', 'Антитела к тиреоглобулину', '20 Ед.акт/мл', '<115 Ед.акт/мл'),
      ]),
    ])
    const helixTpo = app.analytes.findByLabCode(helixId, 'H-TPO')
    expect(app.mapping.suggestions(helixTpo?.id ?? -1).map((s) => s.name)).toEqual(['Антитела к ТПО'])
    const kdlTpo = app.analytes.findByLabCode(app.kdlId, 'AB')
    expect(app.mapping.suggestions(kdlTpo?.id ?? -1).map((s) => s.name)).toEqual([
      'Антитела к тиреоглобулину',
      'Антитела к тиреопероксидазе',
    ])
  })

  it('never suggests an analyte of another specimen, whose analysis names its findings alike', () => {
    const gemotestId = app.labs.list().find((lab) => lab.name === 'Гемотест')?.id ?? -1
    app.importer.importOrders(kdl(), [
      order('k2', '2026-09-02', [{ ...raw('S-DET', 'Детрит', 'много', ''), specimen: 'stool' }]),
    ])
    app.importer.importOrders({ ...kdl(), labId: helixId }, [
      order('h2', '2026-09-03', [
        { ...raw('H-DET', 'Детрит', 'немного', ''), analysis: 'Общий анализ мочи' },
      ]),
    ])
    app.importer.importOrders({ ...kdl(), labId: gemotestId }, [
      order('g2', '2026-09-04', [raw('G-DET', 'Детрит', 'немного', '')]),
    ])
    const helix = app.analytes.findByLabCode(helixId, 'H-DET')
    // Gemotest's names no analysis, so its specimen is unknown and it may still be the one.
    expect(app.mapping.suggestions(helix?.id ?? -1).map((s) => s.id)).toEqual([
      app.analytes.findByLabCode(gemotestId, 'G-DET')?.id,
    ])
  })

  it('asks for the cycle phase of orders whose norms depend on it, except in pregnancy', () => {
    app.importer.importOrders(kdl(), [
      order('k2', '2026-09-10', [raw('PRG', 'Прогестерон', '12 нмоль/л', '')]),
      order('k3', '2026-10-20', [raw('PRG', 'Прогестерон', '40 нмоль/л', '')]),
    ])
    expect(app.mapping.queue(app.anna.id).phaseOrders).toEqual([])
    const progesterone = app.analytes.findByLabCode(app.kdlId, 'PRG')
    const unitId = progesterone?.canonicalUnitId ?? null
    app.rules.create(progesterone?.id ?? -1, {
      labId: null,
      sex: 'female',
      ageFromDays: null,
      ageToDays: null,
      condition: 'phase_luteal',
      low: 2.2,
      high: 99,
      expected: null,
      unitId,
      note: null,
    })
    const waiting = app.mapping.queue(app.anna.id).phaseOrders
    expect(waiting.map((o) => o.collectedOn)).toEqual(['2026-10-20', '2026-09-10'])

    app.orders.setCyclePhase(waiting[0]?.id ?? -1, 'luteal')
    app.patients.addPeriod(app.anna.id, { kind: 'pregnancy', startDate: '2026-08-20', endDate: null })
    expect(app.mapping.queue(app.anna.id).phaseOrders).toEqual([])
    expect(() => app.orders.setCyclePhase(waiting[1]?.id ?? -1, 'luteal')).toThrow('беременность')
  })

  it('never asks a man for a cycle phase', () => {
    const petr = app.patients.create({ title: 'Пётр', sex: 'male', birthDate: '1988-01-02', note: null })
    app.importer.importOrders({ ...kdl(), patientId: petr.id }, [
      order('p1', '2026-09-10', [raw('PRG', 'Прогестерон', '1 нмоль/л', '')]),
    ])
    const progesterone = app.analytes.findByLabCode(app.kdlId, 'PRG')
    app.rules.create(progesterone?.id ?? -1, {
      labId: null,
      sex: null,
      ageFromDays: null,
      ageToDays: null,
      condition: 'phase_luteal',
      low: 2.2,
      high: 99,
      expected: null,
      unitId: progesterone?.canonicalUnitId ?? null,
      note: null,
    })
    expect(app.mapping.queue(petr.id).phaseOrders).toEqual([])
  })

  it("lists the patient's results the lab judged otherwise", () => {
    // The lab flagged 5,2 as high against its own 3,9–5,5.
    expect(app.mapping.queue(app.anna.id).disagreements.map((r) => r.analyteName)).toEqual(['Глюкоза'])
  })
})
