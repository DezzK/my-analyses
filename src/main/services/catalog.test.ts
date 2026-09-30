import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalyteInput, RuleInput } from '@shared/api'
import { ageToDays } from '@shared/domain/age'
import { analyte, analyteMerge, result, unit } from '../db/schema'
import type { RawResult } from '../lab/types'
import { createTestServices } from '../test-support'

type App = ReturnType<typeof createTestServices>

function raw(
  labCode: string,
  labName: string,
  value: string,
  unitText: string,
  reference: string,
): RawResult {
  return { labCode, labName, value, printed: `${value} ${unitText}`, reference, flag: null }
}

/** Imports one order per lab: KDL's TSH and ferritin, Helix's TSH under its own code. */
function seed(app: App) {
  const helixId = app.labs.list().find((lab) => lab.name === 'Хеликс')?.id ?? -1
  const target = { labAccountId: null, patientId: app.anna.id, connectorVersion: 'test' }
  app.importer.importOrders({ ...target, labId: app.kdlId }, [
    {
      externalKey: 'k1',
      collectedOn: '2026-08-08',
      results: [
        raw('TSH-K', 'ТТГ', '2.1', 'мкМЕ/мл', '0.4-4.0 мкМЕ/мл'),
        raw('FER-K', 'Ферритин', '40', 'нг/мл', '10-120 нг/мл'),
      ],
      rawPayload: 'k1',
      pdf: null,
    },
  ])
  app.importer.importOrders({ ...target, labId: helixId }, [
    {
      externalKey: 'h1',
      collectedOn: '2026-09-01',
      results: [raw('TSH-H', 'Тиреотропный гормон', '2.4', 'мкМЕ/мл', '0.35-4.94 мкМЕ/мл')],
      rawPayload: 'h1',
      pdf: null,
    },
  ])
  const id = (name: string) => app.db.select().from(analyte).where(eq(analyte.name, name)).get()?.id ?? -1
  const unitId = (code: string) => app.db.select().from(unit).where(eq(unit.code, code)).get()?.id ?? -1
  return { helixId, kdlTsh: id('ТТГ'), helixTsh: id('Тиреотропный гормон'), ferritin: id('Ферритин'), unitId }
}

function input(overrides: Partial<AnalyteInput> = {}): AnalyteInput {
  return {
    name: 'Витамин D',
    specimen: 'serum',
    description: null,
    valueKind: 'numeric',
    canonicalUnitId: null,
    molarMass: null,
    reviewed: true,
    ...overrides,
  }
}

describe('the catalog', () => {
  let app: App
  let ids: ReturnType<typeof seed>

  beforeEach(() => {
    app = createTestServices()
    ids = seed(app)
  })

  it('lists analytes alphabetically with their result counts and lab codes', () => {
    expect(app.analytes.list().map((a) => [a.name, a.resultCount, a.codes.map((c) => c.code)])).toEqual([
      ['Тиреотропный гормон', 1, ['TSH-H']],
      ['ТТГ', 1, ['TSH-K']],
      ['Ферритин', 1, ['FER-K']],
    ])
  })

  it('creates an analyte by hand, reviewed and findable by its synonyms', () => {
    const ngMl = ids.unitId('ng/mL')
    const created = app.analytes.create(input({ canonicalUnitId: ngMl }))
    expect(created).toMatchObject({ name: 'Витамин D', reviewed: true })
    expect(app.analytes.card(created.id).units.map((u) => u.unitId)).toEqual([ngMl])
    app.analytes.addAlias(created.id, '25-OH D')
    expect(app.analytes.search('25-oh', null).map((h) => h.id)).toEqual([created.id])
    expect(() => app.analytes.addAlias(created.id, 'витамин d')).toThrow('уже есть')
    const alias = app.analytes.card(created.id).aliases[0]
    app.analytes.removeAlias(alias?.id ?? -1)
    expect(app.analytes.search('25-oh', null)).toEqual([])
  })

  it('keeps the lab codes imports rely on', () => {
    const code = app.analytes.card(ids.kdlTsh).aliases.find((a) => a.labCode === 'TSH-K')
    expect(() => app.analytes.removeAlias(code?.id ?? -1)).toThrow('Код лаборатории')
  })

  it('checks what the card saves', () => {
    const card = app.analytes.card(ids.ferritin)
    const base = { ...input(), name: card.name, canonicalUnitId: card.canonicalUnitId }
    expect(() => app.analytes.update(ids.ferritin, { ...base, name: '  ' })).toThrow('Введите название')
    expect(() => app.analytes.update(ids.ferritin, { ...base, molarMass: 0 })).toThrow('Молярная масса')
    expect(() => app.analytes.update(ids.ferritin, { ...base, canonicalUnitId: ids.unitId('g/L') })).toThrow(
      'Основной может быть только',
    )
    app.analytes.update(ids.ferritin, { ...base, description: 'Запасы железа' })
    expect(app.analytes.card(ids.ferritin)).toMatchObject({ description: 'Запасы железа', reviewed: true })
  })

  it('allows units with factors and keeps those that results are in', () => {
    const card = app.analytes.card(ids.ferritin)
    const canonical = card.canonicalUnitId ?? -1
    const ugL = ids.unitId('ug/L')
    expect(() => app.analytes.setUnit(ids.ferritin, canonical, 2)).toThrow('У основной единицы')
    expect(() => app.analytes.setUnit(ids.ferritin, ugL, -1)).toThrow('больше нуля')
    app.analytes.setUnit(ids.ferritin, ugL, 1)
    expect(app.analytes.card(ids.ferritin).units).toEqual(
      expect.arrayContaining([{ unitId: ugL, factor: 1, resultCount: 0 }]),
    )
    // The canonical unit cannot change while factors are set relative to it.
    expect(() =>
      app.analytes.update(ids.ferritin, { ...input(), name: 'Ферритин', canonicalUnitId: ugL }),
    ).toThrow('коэффициенты')
    expect(() => app.analytes.removeUnit(ids.ferritin, canonical)).toThrow('основная единица')
    app.analytes.removeUnit(ids.ferritin, ugL)
    expect(app.analytes.card(ids.ferritin).units.map((u) => u.unitId)).toEqual([canonical])
  })
})

describe('merging analytes', () => {
  let app: App
  let ids: ReturnType<typeof seed>

  beforeEach(() => {
    app = createTestServices()
    ids = seed(app)
  })

  it('moves results, codes, rules and panel places into the target, and puts them back', () => {
    const uiu = app.analytes.card(ids.helixTsh).canonicalUnitId
    const rule = app.rules.create(
      ids.helixTsh,
      rule_({ labId: ids.helixId, low: 0.35, high: 4.94, unitId: uiu }),
    )
    const panel = app.panels.save(null, 'Щитовидная железа', [ids.helixTsh, ids.ferritin])
    const helixResult = app.db.select().from(result).where(eq(result.analyteId, ids.helixTsh)).get()

    const mergeId = app.merges.merge(ids.helixTsh, ids.kdlTsh)
    expect(app.analytes.get(ids.helixTsh)).toBeUndefined()
    expect(app.analytes.findByLabCode(ids.helixId, 'TSH-H')?.id).toBe(ids.kdlTsh)
    expect(app.analytes.search('тиреотропный', null).map((h) => h.id)).toEqual([ids.kdlTsh])
    expect(app.db.select().from(result).where(eq(result.analyteId, ids.kdlTsh)).all()).toHaveLength(2)
    expect(app.rules.list(ids.kdlTsh).map((r) => r.id)).toEqual([rule.id])
    expect(app.panels.list()[0]?.analyteIds).toEqual([ids.kdlTsh, ids.ferritin])
    expect(app.merges.list(ids.kdlTsh)).toEqual([
      expect.objectContaining({ sourceName: 'Тиреотропный гормон' }),
    ])

    app.merges.unmerge(mergeId)
    expect(app.analytes.get(ids.helixTsh)?.name).toBe('Тиреотропный гормон')
    expect(
      app.db
        .select()
        .from(result)
        .where(eq(result.id, helixResult?.id ?? -1))
        .get()?.analyteId,
    ).toBe(ids.helixTsh)
    expect(app.analytes.findByLabCode(ids.helixId, 'TSH-H')?.id).toBe(ids.helixTsh)
    expect(app.rules.list(ids.helixTsh).map((r) => r.id)).toEqual([rule.id])
    expect(app.panels.list()[0]?.analyteIds).toEqual([ids.helixTsh, ids.ferritin])
    expect(app.merges.list(ids.kdlTsh)).toEqual([])
  })

  it('drops the duplicate panel place and gives it back on undo', () => {
    app.panels.save(null, 'ТТГ дважды', [ids.kdlTsh, ids.helixTsh])
    const mergeId = app.merges.merge(ids.helixTsh, ids.kdlTsh)
    expect(app.panels.list()[0]?.analyteIds).toEqual([ids.kdlTsh])
    app.merges.unmerge(mergeId)
    expect(app.panels.list()[0]?.analyteIds).toEqual([ids.kdlTsh, ids.helixTsh])
  })

  it('moves report blocks like panel places, each shown as it was', () => {
    const layout = { chartsPerRow: 1 } as const
    const both = app.reports.saveTemplate(
      null,
      'ТТГ дважды',
      [
        { analyteId: ids.kdlTsh, view: 'table', breakAfter: false },
        { analyteId: ids.helixTsh, view: 'chart', breakAfter: true },
      ],
      layout,
    )
    const helix = app.reports.saveTemplate(
      null,
      'Хеликс',
      [{ analyteId: ids.helixTsh, view: 'chart', breakAfter: true }],
      layout,
    )
    const blocksOf = (id: number) => app.reports.templates().find((t) => t.id === id)?.blocks

    const mergeId = app.merges.merge(ids.helixTsh, ids.kdlTsh)
    expect(blocksOf(both.id)).toEqual([{ analyteId: ids.kdlTsh, view: 'table', breakAfter: false }])
    expect(blocksOf(helix.id)).toEqual([{ analyteId: ids.kdlTsh, view: 'chart', breakAfter: true }])

    app.merges.unmerge(mergeId)
    expect(blocksOf(both.id)).toEqual(both.blocks)
    expect(blocksOf(helix.id)).toEqual(helix.blocks)
  })

  it('undoes a merge whose panel or template is gone since', () => {
    const panel = app.panels.save(null, 'ТТГ дважды', [ids.kdlTsh, ids.helixTsh])
    const template = app.reports.saveTemplate(
      null,
      'ТТГ дважды',
      [
        { analyteId: ids.kdlTsh, view: 'both', breakAfter: false },
        { analyteId: ids.helixTsh, view: 'both', breakAfter: false },
      ],
      { chartsPerRow: 1 },
    )
    const mergeId = app.merges.merge(ids.helixTsh, ids.kdlTsh)
    app.panels.remove(panel.id)
    app.reports.removeTemplate(template.id)

    app.merges.unmerge(mergeId)
    expect(app.analytes.get(ids.helixTsh)?.name).toBe('Тиреотропный гормон')
    expect(app.panels.list()).toEqual([])
    expect(app.reports.templates()).toEqual([])
  })

  it('undoes a merge recorded before report templates kept their blocks as rows', () => {
    const mergeId = app.merges.merge(ids.helixTsh, ids.kdlTsh)
    const merge = eq(analyteMerge.id, mergeId)
    const { reportBlocks: _, ...older } = JSON.parse(
      app.db.select().from(analyteMerge).where(merge).get()?.record ?? '{}',
    ) as Record<string, unknown>
    app.db
      .update(analyteMerge)
      .set({ record: JSON.stringify(older) })
      .where(merge)
      .run()

    app.merges.unmerge(mergeId)
    expect(app.analytes.get(ids.helixTsh)?.name).toBe('Тиреотропный гормон')
  })

  it('refuses to merge an analyte into itself', () => {
    expect(() => app.merges.merge(ids.kdlTsh, ids.kdlTsh)).toThrow('с самим собой')
  })
})

function rule_(overrides: Partial<RuleInput>): RuleInput {
  return {
    labId: null,
    sex: null,
    ageFromDays: null,
    ageToDays: null,
    condition: null,
    low: null,
    high: null,
    expected: null,
    unitId: null,
    note: null,
    ...overrides,
  }
}

describe('reference rules', () => {
  let app: App
  let ids: ReturnType<typeof seed>
  let uiu: number | null

  beforeEach(() => {
    app = createTestServices()
    ids = seed(app)
    uiu = app.analytes.card(ids.kdlTsh).canonicalUnitId
  })

  it('refuses a second rule for the same lab, sex, condition and ages', () => {
    const adults = { ageFromDays: ageToDays(18, 'years'), low: 0.4, high: 4, unitId: uiu }
    app.rules.create(ids.kdlTsh, rule_(adults))
    expect(() =>
      app.rules.create(ids.kdlTsh, rule_({ ...adults, ageFromDays: ageToDays(30, 'years') })),
    ).toThrow('уже есть')
    // A child's range, a condition or a lab's own rule do not clash with it.
    app.rules.create(ids.kdlTsh, rule_({ ...adults, ageFromDays: null, ageToDays: ageToDays(18, 'years') }))
    app.rules.create(ids.kdlTsh, rule_({ ...adults, condition: 'pregnancy_t1', high: 2.5 }))
    const own = app.rules.create(ids.kdlTsh, rule_({ ...adults, labId: app.kdlId }))
    // A rule does not clash with itself when edited.
    app.rules.update(own.id, rule_({ ...adults, labId: app.kdlId, high: 4.2 }))
    expect(app.rules.list(ids.kdlTsh)).toHaveLength(4)
  })

  it('checks bounds, units and conditions', () => {
    const bad = (overrides: Partial<RuleInput>) => () => app.rules.create(ids.kdlTsh, rule_(overrides))
    expect(bad({})).toThrow('границы нормы или ожидаемый ответ')
    expect(bad({ low: 5, high: 1, unitId: uiu })).toThrow('Нижняя граница больше верхней')
    expect(bad({ low: 1 })).toThrow('Укажите единицу')
    expect(bad({ low: 1, unitId: ids.unitId('g/L') })).toThrow('одной из единиц показателя')
    expect(bad({ low: 1, unitId: uiu, sex: 'male', condition: 'postmenopause' })).toThrow('только у женщин')
    expect(bad({ low: 1, unitId: uiu, ageFromDays: 100, ageToDays: 10 })).toThrow('«от» должен быть меньше')
    // An expected answer carries no unit.
    const qualitative = app.rules.create(ids.kdlTsh, rule_({ expected: 'negative', unitId: uiu }))
    expect(qualitative.unitId).toBeNull()
  })

  it("offers the labs' own references as rules to start from", () => {
    expect(app.rules.labReferences(ids.kdlTsh)).toEqual([
      expect.objectContaining({ labId: app.kdlId, low: 0.4, high: 4, unitId: uiu, count: 1 }),
    ])
  })
})

describe('panels', () => {
  let app: App
  let ids: ReturnType<typeof seed>

  beforeEach(() => {
    app = createTestServices()
    ids = seed(app)
  })

  it('keeps the order of analytes, and names unique', () => {
    const saved = app.panels.save(null, 'Щитовидная железа', [ids.ferritin, ids.kdlTsh, ids.ferritin])
    expect(saved.analyteIds).toEqual([ids.ferritin, ids.kdlTsh])
    expect(() => app.panels.save(null, 'щитовидная железа', [ids.kdlTsh])).toThrow('уже есть')
    expect(() => app.panels.save(null, 'Пустой', [])).toThrow('хотя бы один')
    app.panels.save(saved.id, 'Щитовидная железа', [ids.kdlTsh])
    expect(app.panels.list()).toEqual([{ id: saved.id, name: 'Щитовидная железа', analyteIds: [ids.kdlTsh] }])
    app.panels.remove(saved.id)
    expect(app.panels.list()).toEqual([])
  })
})
