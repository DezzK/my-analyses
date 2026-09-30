import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalyteInput, ReportBlock, ReportSpec } from '@shared/api'
import { reportBlock } from '../db/schema'
import { createTestServices } from '../test-support'

type App = ReturnType<typeof createTestServices>

/** An id no row has. */
const UNKNOWN_ID = 12345

function analyteNamed(name: string): AnalyteInput {
  return {
    name,
    specimen: 'serum',
    description: null,
    valueKind: 'numeric',
    canonicalUnitId: null,
    molarMass: null,
    reviewed: true,
  }
}

describe('report templates', () => {
  let app: App
  let glucose: number
  let tsh: number
  const block = (analyteId: number, overrides: Partial<ReportBlock> = {}): ReportBlock => ({
    analyteId,
    view: 'both',
    breakAfter: false,
    ...overrides,
  })

  beforeEach(() => {
    app = createTestServices()
    glucose = app.analytes.create(analyteNamed('Глюкоза')).id
    tsh = app.analytes.create(analyteNamed('ТТГ')).id
  })

  it('keeps blocks in order with how each is shown, and lists templates by title', () => {
    const blocks = [block(tsh, { view: 'chart', breakAfter: true }), block(glucose, { view: 'table' })]
    const thyroid = app.reports.saveTemplate(null, '  Щитовидная железа ', blocks, { chartsPerRow: 2 })
    const sugar = app.reports.saveTemplate(null, 'Глюкоза за год', [block(glucose)], { chartsPerRow: 1 })
    expect(thyroid).toEqual({
      id: thyroid.id,
      title: 'Щитовидная железа',
      blocks,
      layout: { chartsPerRow: 2 },
    })
    expect(app.reports.templates().map((t) => t.title)).toEqual(['Глюкоза за год', 'Щитовидная железа'])

    app.reports.saveTemplate(sugar.id, 'Сахар', [block(glucose), block(tsh)], { chartsPerRow: 1 })
    expect(app.reports.templates().find((t) => t.id === sugar.id)?.blocks).toEqual([
      block(glucose),
      block(tsh),
    ])

    app.reports.removeTemplate(thyroid.id)
    expect(app.reports.templates().map((t) => t.title)).toEqual(['Сахар'])
    expect(app.db.select().from(reportBlock).all()).toHaveLength(2)
  })

  it('refuses a template it could not build a report from', () => {
    const layout = { chartsPerRow: 1 } as const
    app.reports.saveTemplate(null, 'Щитовидная железа', [block(tsh)], layout)
    expect(() => app.reports.saveTemplate(null, 'щитовидная железа', [block(tsh)], layout)).toThrow(
      'уже есть',
    )
    expect(() => app.reports.saveTemplate(null, ' ', [block(tsh)], layout)).toThrow('Введите название')
    expect(() => app.reports.saveTemplate(null, 'Пустой', [], layout)).toThrow('хотя бы один')
    expect(() => app.reports.saveTemplate(null, 'Дважды', [block(tsh), block(tsh)], layout)).toThrow(
      'уже есть в отчёте',
    )
    expect(() => app.reports.saveTemplate(null, 'Нет такого', [block(-1)], layout)).toThrow('не найден')
    expect(() =>
      app.reports.saveTemplate(null, 'Вид', [{ ...block(tsh), view: 'pie' as ReportBlock['view'] }], layout),
    ).toThrow('Неизвестный вид')
    expect(() => app.reports.saveTemplate(null, 'Три в ряд', [block(tsh)], { chartsPerRow: 3 as 1 })).toThrow(
      'Графиков в ряд',
    )
    expect(() => app.reports.saveTemplate(UNKNOWN_ID, 'Нет такого', [block(tsh)], layout)).toThrow(
      'Шаблон не найден',
    )
    expect(() => app.reports.removeTemplate(UNKNOWN_ID)).toThrow('Шаблон не найден')
  })

  it('checks a report before it is drawn', () => {
    const spec: ReportSpec = {
      patientId: app.anna.id,
      from: '2025-01-01',
      to: '2026-01-01',
      blocks: [block(glucose)],
      layout: { chartsPerRow: 1 },
    }
    expect(() => app.reports.checkSpec(spec)).not.toThrow()
    expect(() => app.reports.checkSpec({ ...spec, patientId: UNKNOWN_ID })).toThrow()
    expect(() => app.reports.checkSpec({ ...spec, from: '2026-02-01' })).toThrow('заканчивается раньше')
    expect(() => app.reports.checkSpec({ ...spec, blocks: [] })).toThrow('хотя бы один')
  })
})
