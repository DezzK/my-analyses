import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { dictionaryLink, unit } from '../db/schema'
import { MOLAR_MASS } from '../dictionary/entries'
import type { RawOrder, RawResult } from '../lab/types'
import { createTestServices } from '../test-support'

type App = ReturnType<typeof createTestServices>

function raw(labCode: string, labName: string, printed: string): RawResult {
  return { labCode, labName, value: null, printed, reference: null, flag: null }
}

function order(externalKey: string, collectedOn: string, results: RawResult[]): RawOrder {
  return { externalKey, collectedOn, results, rawPayload: externalKey, forms: [] }
}

describe('the analyte dictionary', () => {
  let app: App
  let helixId: number
  const into = (labId: number) => ({
    labId,
    labAccountId: null,
    patientId: app.anna.id,
    connectorVersion: 'test',
  })
  const analyteOf = (labId: number, code: string) => app.analytes.findByLabCode(labId, code)

  beforeEach(() => {
    app = createTestServices()
    helixId = app.labs.list().find((lab) => lab.name === 'Хеликс')?.id ?? -1
  })

  it("links a lab's analyte to its entry and merges another lab's into it, for the person to confirm", () => {
    const kdl = app.importer.importOrders(into(app.kdlId), [
      order('k1', '2026-08-08', [raw('TES', 'Тестостерон', '15.2 нмоль/л')]),
    ])
    expect(kdl).toMatchObject({ analytesCreated: 1, analytesRecognized: 1 })
    const testosterone = analyteOf(app.kdlId, 'TES')
    // Known, it does not wait in the queue, and takes the molar mass that converts its units.
    expect(testosterone).toMatchObject({ reviewed: true, molarMass: MOLAR_MASS.testosterone })

    const helix = app.importer.importOrders(into(helixId), [
      order('h1', '2026-09-01', [raw('H-TES', 'Тестостерон общий', '4.1 нг/мл')]),
    ])
    expect(helix).toMatchObject({ analytesCreated: 1, analytesRecognized: 1 })
    expect(analyteOf(helixId, 'H-TES')?.id).toBe(testosterone?.id)
    expect(app.merges.list(testosterone?.id ?? -1)).toEqual([
      expect.objectContaining({ sourceName: 'Тестостерон общий', reviewed: false }),
    ])
    const rows = app.results.forAnalyte(testosterone?.id ?? -1, app.anna.id).rows
    expect(rows.map((row) => row.read.value.inTarget)).toEqual([true, true])
  })

  it('never merges two analytes with results in one order, whatever their names', () => {
    const stats = app.importer.importOrders(into(app.kdlId), [
      order('k1', '2026-08-08', [
        raw('GLU', 'Глюкоза', '5.2 ммоль/л'),
        raw('U-GLU', 'Глюкоза', '0.1 ммоль/л'),
      ]),
    ])
    expect(stats).toMatchObject({ analytesCreated: 2, analytesRecognized: 1 })
    expect(analyteOf(app.kdlId, 'U-GLU')?.id).not.toBe(analyteOf(app.kdlId, 'GLU')?.id)
    expect(app.mapping.queue(app.anna.id).analytes.map((a) => a.codes[0]?.code)).toEqual(['U-GLU'])
    // Nor later, when it is applied to everything.
    expect(app.dictionary.apply()).toEqual({ linked: 0, merged: 0, apart: 1 })
  })

  it("merges an analysis's findings across labs, and never across specimens", () => {
    const dnkomId = app.labs.list().find((lab) => lab.name === 'ДНКОМ')?.id ?? -1
    // KDL says the specimen through its catalog's section, DNKOM through the analysis.
    app.importer.importOrders(into(app.kdlId), [
      order('k1', '2026-06-01', [
        { ...raw('U-LEU', 'Лейкоциты', '2-4 в п/зр'), specimen: 'urine' },
        { ...raw('S-LEU', 'Лейкоциты', 'единичные в п/зр'), specimen: 'stool' },
      ]),
    ])
    app.importer.importOrders(into(dnkomId), [
      order('d1', '2026-07-01', [
        { ...raw('D-LEU', 'Лейкоциты', '0-1 в п/зр'), analysis: 'Общий анализ мочи' },
      ]),
    ])
    app.importer.importOrders(into(helixId), [
      order('h1', '2026-08-01', [raw('H-LEU', 'Лейкоциты', '1-2 в п/зр')]),
    ])

    const kdlUrine = analyteOf(app.kdlId, 'U-LEU')
    expect(analyteOf(dnkomId, 'D-LEU')?.id).toBe(kdlUrine?.id)
    expect(analyteOf(app.kdlId, 'S-LEU')?.id).not.toBe(kdlUrine?.id)
    // Of no analysis known, the same name is no one's.
    expect(analyteOf(helixId, 'H-LEU')).toMatchObject({ specimen: null, reviewed: false })
  })

  it('never merges again what the person split', () => {
    const tsh = (labCode: string, name: string) => raw(labCode, name, '2.1 мкМЕ/мл')
    app.importer.importOrders(into(app.kdlId), [order('k1', '2026-08-08', [tsh('TSH', 'ТТГ')])])
    app.importer.importOrders(into(helixId), [
      order('h1', '2026-09-01', [tsh('H-TSH', 'Тиреотропный гормон')]),
    ])
    const [merge] = app.merges.list(analyteOf(app.kdlId, 'TSH')?.id ?? -1)
    app.merges.unmerge(merge?.id ?? -1)
    expect(analyteOf(helixId, 'H-TSH')).toMatchObject({ name: 'Тиреотропный гормон', separated: true })

    expect(app.dictionary.apply()).toEqual({ linked: 0, merged: 0, apart: 0 })
    app.importer.importOrders(into(helixId), [
      order('h2', '2026-09-20', [tsh('H-TSH', 'Тиреотропный гормон')]),
    ])
    expect(analyteOf(helixId, 'H-TSH')?.id).not.toBe(analyteOf(app.kdlId, 'TSH')?.id)
  })

  it('takes in analytes imported before it knew them, into the one the person looked at', () => {
    const mmol = app.db.select().from(unit).where(eq(unit.code, 'mmol/L')).get()?.id ?? null
    const imported = (labId: number, labCode: string, name: string) =>
      app.analytes.createFromLab({
        labId,
        labCode,
        name,
        valueKind: 'numeric',
        unitId: mmol,
        context: { analysis: null, specimen: null },
      })
    imported(app.kdlId, 'GLU', 'Глюкоза')
    const helix = imported(helixId, 'H-GLU', 'Глюкоза плазмы')
    // The person looked at Helix's glucose and gave it a molar mass of their own.
    const molarMass = 180
    const { name, specimen, valueKind, canonicalUnitId } = helix
    app.analytes.update(helix.id, {
      name,
      specimen,
      description: null,
      valueKind,
      canonicalUnitId,
      molarMass,
      reviewed: true,
    })

    expect(app.dictionary.apply()).toEqual({ linked: 1, merged: 1, apart: 0 })
    expect(analyteOf(app.kdlId, 'GLU')).toMatchObject({ id: helix.id, molarMass })
    expect(app.dictionary.apply()).toEqual({ linked: 0, merged: 0, apart: 0 })
  })

  it("merges the entry's analyte into one the person looked at with more results", () => {
    // KDL's HDL went by a name the dictionary did not know, and the person accepted it as is.
    app.importer.importOrders(into(app.kdlId), [
      order('k1', '2026-06-01', [raw('HDL', 'HDL-холестерол', '1.4 ммоль/л')]),
      order('k2', '2026-07-01', [raw('HDL', 'HDL-холестерол', '1.5 ммоль/л')]),
    ])
    const kdl = analyteOf(app.kdlId, 'HDL')
    if (!kdl) throw new Error('fixture')
    app.analytes.setReviewed([kdl.id], true)
    app.importer.importOrders(into(helixId), [
      order('h1', '2026-08-01', [raw('H-HDL', 'Холестерин ЛПВП', '1.3 ммоль/л')]),
    ])
    expect(analyteOf(helixId, 'H-HDL')?.id).not.toBe(kdl.id)

    // Renamed, KDL's is the entry's too; Helix's, linked first, joins it.
    const { specimen, valueKind, canonicalUnitId, molarMass } = kdl
    app.analytes.update(kdl.id, {
      name: 'Холестерин-ЛПВП',
      specimen,
      description: null,
      valueKind,
      canonicalUnitId,
      molarMass,
      reviewed: true,
    })
    expect(app.dictionary.apply()).toEqual({ linked: 0, merged: 1, apart: 0 })
    expect(analyteOf(helixId, 'H-HDL')?.id).toBe(kdl.id)
    const link = app.db.select().from(dictionaryLink).where(eq(dictionaryLink.entryKey, 'hdl')).get()
    expect(link?.analyteId).toBe(kdl.id)
  })

  it('moves an entry with the analyte merged by hand, and gives it back when that is undone', () => {
    app.importer.importOrders(into(app.kdlId), [
      order('k1', '2026-08-08', [raw('FER', 'Ферритин', '40 нг/мл')]),
    ])
    const ferritin = analyteOf(app.kdlId, 'FER')
    const mine = app.analytes.create({
      name: 'Запасы железа',
      specimen: null,
      description: null,
      valueKind: 'numeric',
      canonicalUnitId: ferritin?.canonicalUnitId ?? null,
      molarMass: null,
      reviewed: true,
    })
    const linkOf = () =>
      app.db.select().from(dictionaryLink).where(eq(dictionaryLink.entryKey, 'ferritin')).get()

    const mergeId = app.merges.merge(ferritin?.id ?? -1, mine.id)
    expect(linkOf()?.analyteId).toBe(mine.id)
    app.importer.importOrders(into(helixId), [
      order('h1', '2026-09-01', [raw('H-FER', 'Ферритин', '35 нг/мл')]),
    ])
    expect(analyteOf(helixId, 'H-FER')?.id).toBe(mine.id)

    app.merges.unmerge(mergeId)
    expect(linkOf()?.analyteId).toBe(ferritin?.id)
  })
})
