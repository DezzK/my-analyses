import { describe, expect, it } from 'vitest'
import {
  BUILTIN_UNITS,
  convert,
  createUnitResolver,
  normalizeUnitSpelling,
  UNKNOWN_UNIT_PREFIX,
  type ConversionContext,
  type UnitRowLike,
} from './units'

const rows: UnitRowLike[] = BUILTIN_UNITS.map((u, i) => ({
  id: i + 1,
  code: u.code,
  display: u.display,
  dimension: u.dimension,
  scale: u.scale,
}))

function unit(code: string): UnitRowLike {
  const row = rows.find((r) => r.code === code)
  if (!row) throw new Error(`no unit ${code}`)
  return row
}

const noFactors: ConversionContext = { canonical: null, molarMass: null, factors: new Map() }

describe('normalizeUnitSpelling', () => {
  it.each([
    ['×10⁹/л', '10*9/л'],
    ['x10^9/L', '10*9/l'],
    ['х10*9/л', '10*9/л'],
    ['*10^12/л', '10*12/л'],
    ['10^12/л', '10*12/л'],
    ['Тыс/мкл', 'тыс/мкл'],
    ['мл/мин/1,73 кв м', 'мл/мин/1,73квм'],
    ['μmol/L', 'µmol/l'],
  ])('%s → %s', (spelling, key) => {
    expect(normalizeUnitSpelling(spelling)).toBe(key)
  })

  it('gives every built-in spelling a single unit', () => {
    const owner = new Map<string, string>()
    for (const u of BUILTIN_UNITS) {
      for (const spelling of [u.code, u.display, ...u.spellings]) {
        const key = normalizeUnitSpelling(spelling)
        const seen = owner.get(key)
        expect(seen === undefined || seen === u.code, `${spelling}: ${seen} and ${u.code}`).toBe(true)
        owner.set(key, u.code)
      }
    }
  })
})

describe('createUnitResolver', () => {
  it('maps every way labs write a unit onto one row', () => {
    const resolve = createUnitResolver(rows, new Map())
    expect(resolve('10*9/л')).toBe(unit('10*9/L'))
    expect(resolve('тыс/мкл')).toBe(unit('10*9/L'))
    expect(resolve('×10⁹/л')).toBe(unit('10*9/L'))
    expect(resolve('мкМЕ/мл')).toBe(unit('uIU/mL'))
    expect(resolve('мм/час')).toBe(unit('mm/h'))
  })

  it("prefers the person's own mapping and finds rows for unknown spellings", () => {
    const unknown: UnitRowLike = {
      id: 999,
      code: `${UNKNOWN_UNIT_PREFIX}ед.акт/мл`,
      display: 'Ед.акт/мл',
      dimension: `${UNKNOWN_UNIT_PREFIX}ед.акт/мл`,
      scale: 1,
    }
    const custom = new Map([[normalizeUnitSpelling('мг%'), unit('g/L').id]])
    const resolve = createUnitResolver([...rows, unknown], custom)
    expect(resolve('мг%')).toBe(unit('g/L'))
    expect(resolve('Ед.акт/мл')).toBe(unknown)
    expect(resolve('попугаи')).toBeNull()
  })
})

describe('convert', () => {
  it('converts inside a dimension', () => {
    expect(convert(140, unit('g/L'), unit('g/dL'), noFactors)).toBeCloseTo(14)
    expect(convert(4.5, unit('10*9/L'), unit('/uL'), noFactors)).toBeCloseTo(4500)
    expect(convert(2.1, unit('uIU/mL'), unit('mIU/L'), noFactors)).toBeCloseTo(2.1)
  })

  it('bridges molar and mass concentrations through the molar mass', () => {
    const glucose = { ...noFactors, molarMass: 180.16 }
    expect(convert(5.5, unit('mmol/L'), unit('mg/dL'), glucose)).toBeCloseTo(99.088)
    expect(convert(99.088, unit('mg/dL'), unit('mmol/L'), glucose)).toBeCloseTo(5.5)
    expect(convert(5.5, unit('mmol/L'), unit('mg/dL'), noFactors)).toBeNull()
  })

  it('uses explicit factors through the canonical unit', () => {
    // Prolactin: 1 ng/mL = 21.2 mIU/L, which no dimension can know.
    const prolactin: ConversionContext = {
      canonical: unit('mIU/L'),
      molarMass: null,
      factors: new Map([[unit('ng/mL').id, 21.2]]),
    }
    expect(convert(10, unit('ng/mL'), unit('mIU/L'), prolactin)).toBeCloseTo(212)
    expect(convert(212, unit('mIU/L'), unit('ng/mL'), prolactin)).toBeCloseTo(10)
    expect(convert(10, unit('ng/mL'), unit('IU/L'), prolactin)).toBeCloseTo(0.212)
  })

  it('refuses units nothing relates', () => {
    expect(convert(7, unit('%'), unit('g/L'), noFactors)).toBeNull()
  })
})
