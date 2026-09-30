import { describe, expect, it } from 'vitest'
import {
  interpret,
  type AnalyteFacts,
  type PatientFacts,
  type ResultFacts,
  type RuleWithBounds,
} from './interpret'
import { BUILTIN_UNITS, createUnitResolver, type UnitRowLike } from './units'

const UNITS: UnitRowLike[] = BUILTIN_UNITS.map((u, i) => ({
  id: i + 1,
  code: u.code,
  display: u.display,
  dimension: u.dimension,
  scale: u.scale,
}))

function unit(code: string): UnitRowLike {
  const found = UNITS.find((u) => u.code === code)
  if (!found) throw new Error(`No built-in unit ${code}`)
  return found
}

const MMOL = unit('mmol/L')
const MG_DL = unit('mg/dL')
const U_L = unit('U/L')
const UIU_ML = unit('uIU/mL')
const GLUCOSE_MOLAR_MASS = 180.16
const KDL = 1
const OTHER_LAB = 2

const ANNA: PatientFacts = { sex: 'female', birthDate: '1990-05-14', periods: [] }

function facts(rules: RuleWithBounds[] = []): AnalyteFacts {
  return {
    conversion: { canonical: MMOL, molarMass: GLUCOSE_MOLAR_MASS, factors: new Map() },
    rules,
    units: new Map(UNITS.map((u) => [u.id, u])),
    resolveUnit: createUnitResolver(UNITS, new Map()),
  }
}

function result(overrides: Partial<ResultFacts> = {}): ResultFacts {
  return {
    rawValue: '5.40',
    unitId: MMOL.id,
    refRaw: '3.9-5.5 ммоль/л',
    labFlag: 'normal',
    labId: KDL,
    collectedOn: '2026-08-08',
    cyclePhase: null,
    ...overrides,
  }
}

let nextRuleId = 1
function rule(overrides: Partial<RuleWithBounds>): RuleWithBounds {
  return {
    id: nextRuleId++,
    labId: null,
    sex: null,
    ageFromDays: null,
    ageToDays: null,
    condition: null,
    low: null,
    high: null,
    expected: null,
    unitId: MMOL.id,
    ...overrides,
  }
}

describe('interpret', () => {
  it('shows a value as the lab wrote it and judges it by the reference on the form', () => {
    expect(interpret(result(), MMOL, ANNA, facts())).toEqual({
      value: {
        number: { value: 5.4, text: '5,40' },
        comparator: null,
        qualitative: null,
        unitId: MMOL.id,
        inTarget: true,
      },
      reference: {
        low: { value: 3.9, text: '3,9' },
        high: { value: 5.5, text: '5,5' },
        expected: null,
        source: 'lab',
        unitId: MMOL.id,
        inValueUnit: true,
      },
      deviation: 'normal',
      labDisagrees: false,
    })
  })

  it('converts into the chosen unit, keeping the precision that was measured', () => {
    const read = interpret(result(), MG_DL, ANNA, facts())
    expect(read.value).toMatchObject({
      number: { value: 97.3, text: '97,3' },
      unitId: MG_DL.id,
      inTarget: true,
    })
    expect(read.reference).toMatchObject({ low: { text: '70' }, high: { text: '99' }, unitId: MG_DL.id })
  })

  it('judges in the unit the value was reported in, not in rounded display numbers', () => {
    // 5,50 mmol/L shows as 99,1 mg/dL against a bound shown as 99, yet it is at the bound: normal.
    const read = interpret(result({ rawValue: '5.50' }), MG_DL, ANNA, facts())
    expect(read.value.number?.text).toBe('99,1')
    expect(read.deviation).toBe('normal')
    expect(interpret(result({ rawValue: '5.52' }), MG_DL, ANNA, facts()).deviation).toBe('high')
  })

  it('keeps a value in its own unit when nothing converts it into the chosen one', () => {
    const read = interpret(result({ rawValue: '31', unitId: U_L.id, refRaw: '0-40' }), MMOL, ANNA, facts())
    expect(read.value).toMatchObject({ number: { text: '31' }, unitId: U_L.id, inTarget: false })
    expect(read.reference).toMatchObject({ high: { text: '40' }, unitId: U_L.id, inValueUnit: true })
    expect(read.deviation).toBe('normal')
  })

  it('reads the unit printed inside the reference, whatever its spelling', () => {
    expect(interpret(result({ refRaw: '3,9–5,5 mmol/l' }), MMOL, ANNA, facts()).reference).toMatchObject({
      source: 'lab',
      unitId: MMOL.id,
    })
    // An unknown unit makes the lab's reference unusable; with no catalog rule there is none.
    expect(interpret(result({ refRaw: '1-2 попугая' }), MMOL, ANNA, facts()).reference).toBeNull()
  })

  it('falls back to the rule for the lab, then to the general rule', () => {
    const rules = [rule({ low: 3.3, high: 5.5 }), rule({ labId: KDL, low: 4.1, high: 5.9 })]
    // The lab's own reference comes first whenever it can be read.
    expect(interpret(result(), MMOL, ANNA, facts(rules)).reference?.source).toBe('lab')
    const noForm = { refRaw: 'см. результат в pdf заказа' }
    expect(interpret(result(noForm), MMOL, ANNA, facts(rules)).reference).toMatchObject({
      source: 'lab-rule',
      low: { text: '4,1' },
      high: { text: '5,9' },
    })
    expect(
      interpret(result({ ...noForm, labId: OTHER_LAB }), MMOL, ANNA, facts(rules)).reference,
    ).toMatchObject({
      source: 'general-rule',
      low: { text: '3,3' },
    })
  })

  it('shows stored rule bounds in their shortest spelling', () => {
    const rules = [rule({ low: 4, high: 6.1 })]
    const read = interpret(result({ refRaw: null }), MMOL, ANNA, facts(rules))
    expect(read.reference).toMatchObject({ low: { text: '4' }, high: { text: '6,1' } })
  })

  it('takes the rule for the trimester the sample was collected in', () => {
    const pregnant: PatientFacts = {
      ...ANNA,
      periods: [{ kind: 'pregnancy', startDate: '2026-03-01', endDate: '2026-12-01' }],
    }
    const rules = [
      rule({ low: 0.4, high: 4.0, unitId: UIU_ML.id }),
      rule({ low: 0.2, high: 3.0, condition: 'pregnancy_t2', unitId: UIU_ML.id }),
    ]
    // Week 22 on 08.08.2026: the second trimester.
    const tsh = result({ rawValue: '3.5', unitId: UIU_ML.id, refRaw: null, labFlag: null })
    expect(interpret(tsh, UIU_ML, pregnant, facts(rules)).deviation).toBe('high')
    expect(interpret(tsh, UIU_ML, ANNA, facts(rules)).deviation).toBe('normal')
  })

  it('judges a value reported as a bound by what it proves', () => {
    const below = result({ rawValue: '<0.1', refRaw: '0.5-2', labFlag: null })
    expect(interpret(below, MMOL, ANNA, facts())).toMatchObject({
      value: { number: { text: '0,1' }, comparator: '<' },
      deviation: 'low',
    })
    expect(interpret({ ...below, refRaw: '<5' }, MMOL, ANNA, facts()).deviation).toBe('normal')
  })

  it('compares qualitative answers by what they say was found', () => {
    const answer = (rawValue: string, labFlag: ResultFacts['labFlag']) =>
      interpret(result({ rawValue, refRaw: 'отрицательно', unitId: null, labFlag }), null, ANNA, facts())
    expect(answer('не обнаружено', 'normal')).toMatchObject({
      value: { qualitative: 'not_detected' },
      deviation: 'normal',
      labDisagrees: false,
    })
    expect(answer('обнаружено', 'abnormal')).toMatchObject({ deviation: 'abnormal', labDisagrees: false })
    expect(answer('обнаружено', 'normal').labDisagrees).toBe(true)
  })

  it('marks results the lab judged otherwise', () => {
    expect(interpret(result({ labFlag: 'high' }), MMOL, ANNA, facts()).labDisagrees).toBe(true)
    // "Abnormal" without a direction agrees with either direction.
    expect(
      interpret(result({ rawValue: '6.1', labFlag: 'abnormal' }), MMOL, ANNA, facts()).labDisagrees,
    ).toBe(false)
    expect(interpret(result({ rawValue: '6.1', labFlag: 'high' }), MMOL, ANNA, facts()).labDisagrees).toBe(
      false,
    )
  })

  it('leaves free text unjudged', () => {
    const read = interpret(result({ rawValue: '2-4 в п/з', refRaw: null }), MMOL, ANNA, facts())
    expect(read).toMatchObject({
      value: { number: null, qualitative: null },
      reference: null,
      deviation: null,
    })
  })
})
