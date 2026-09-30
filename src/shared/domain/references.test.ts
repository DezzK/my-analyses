import { describe, expect, it } from 'vitest'
import type { ReferenceCondition } from './enums'
import { chooseRule, evaluate, parseReference, type ReferenceContext, type RuleLike } from './references'
import { parseValue } from './values'

describe('parseReference', () => {
  it.each([
    ['3.9-5.5 ммоль/л', { kind: 'range', low: 3.9, high: 5.5, unitText: 'ммоль/л' }],
    ['3,9 – 5,5', { kind: 'range', low: 3.9, high: 5.5, unitText: null }],
    ['3.9-5.5 ммоль/л.', { kind: 'range', low: 3.9, high: 5.5, unitText: 'ммоль/л' }],
    ['0 - 5', { kind: 'range', low: 0, high: 5, unitText: null }],
    ['от 5 до 10 мг/л', { kind: 'range', low: 5, high: 10, unitText: 'мг/л' }],
    ['<5 мг/л', { kind: 'range', low: null, high: 5, unitText: 'мг/л' }],
    ['≤ 5', { kind: 'range', low: null, high: 5, unitText: null }],
    ['до 5', { kind: 'range', low: null, high: 5, unitText: null }],
    ['>60', { kind: 'range', low: 60, high: null, unitText: null }],
    ['<5 (не обнаружено)', { kind: 'range', low: null, high: 5, unitText: null }],
    ['отрицательно', { kind: 'qualitative', expected: 'negative' }],
  ])('reads %s', (raw, expected) => {
    const ref = parseReference(raw)
    const values =
      ref?.kind === 'range' ? { ...ref, low: ref.low?.value ?? null, high: ref.high?.value ?? null } : ref
    expect(values).toEqual(expected)
  })

  it('keeps the precision the lab printed each bound with', () => {
    expect(parseReference('0.40-4.0 мкМЕ/мл')).toEqual({
      kind: 'range',
      low: { value: 0.4, decimals: 2, sigDigits: 2 },
      high: { value: 4, decimals: 1, sigDigits: 2 },
      unitText: 'мкМЕ/мл',
    })
  })

  it.each([null, '', 'см. результат в pdf заказа', '5 - 3', 'фолликулярная фаза: 3,5–12,5'])(
    'cannot read %s',
    (raw) => {
      expect(parseReference(raw)).toBeNull()
    },
  )
})

describe('evaluate', () => {
  const range = (low: number | null, high: number | null) => ({ low, high, expected: null })

  it.each([
    ['6', range(3.9, 5.5), 'high'],
    ['3', range(3.9, 5.5), 'low'],
    ['5.5', range(3.9, 5.5), 'normal'],
    ['3.9', range(3.9, 5.5), 'normal'],
    ['<0.1', range(0.5, 2), 'low'],
    ['<0.1', range(null, 5), 'normal'],
    ['<0.1', range(0, 5), 'normal'],
    ['<10', range(null, 5), null],
    ['<1', range(0.5, 2), null],
    ['<=0.5', range(0.5, 2), null],
    ['>1000', range(null, 100), 'high'],
    ['>60', range(60, null), 'normal'],
    ['>90', range(90, 120), null],
    ['>=100', range(null, 100), null],
    ['5', range(null, null), null],
  ])('%s against %o is %s', (raw, ref, expected) => {
    expect(evaluate(parseValue(raw), ref)).toBe(expected)
  })

  it('compares qualitative answers by what they say was found', () => {
    const negative = { low: null, high: null, expected: 'negative' as const }
    expect(evaluate(parseValue('не обнаружено'), negative)).toBe('normal')
    expect(evaluate(parseValue('положительно'), negative)).toBe('abnormal')
    expect(evaluate(parseValue('отрицательно'), range(0, 5))).toBeNull()
    expect(evaluate(parseValue('2-4 в п/з'), negative)).toBeNull()
  })
})

describe('chooseRule', () => {
  const YEAR = 365
  const rule = (id: number, over: Partial<RuleLike>): RuleLike => ({
    id,
    labId: null,
    sex: null,
    ageFromDays: null,
    ageToDays: null,
    condition: null,
    ...over,
  })
  const rules = [
    rule(1, {}),
    rule(2, { sex: 'female' }),
    rule(3, { sex: 'female', ageFromDays: 18 * YEAR, ageToDays: 45 * YEAR }),
    rule(4, { sex: 'female', condition: 'pregnancy_t2' }),
    rule(5, { labId: 7 }),
  ]
  const ctx = (over: Partial<ReferenceContext>): ReferenceContext => ({
    labId: 1,
    sex: 'female',
    ageDays: 30 * YEAR,
    conditions: new Set<ReferenceCondition>(),
    ...over,
  })

  it("lets a lab's exception win for that lab's results", () => {
    expect(chooseRule(rules, ctx({ labId: 7 }))).toEqual({ rule: rules[4], source: 'lab-rule' })
  })

  it('picks the most specific general rule', () => {
    expect(chooseRule(rules, ctx({}))?.rule.id).toBe(3)
    expect(chooseRule(rules, ctx({ conditions: new Set(['pregnancy_t2']) }))?.rule.id).toBe(4)
    expect(chooseRule(rules, ctx({ sex: 'male' }))?.rule.id).toBe(1)
    expect(chooseRule(rules, ctx({ ageDays: 50 * YEAR }))?.rule.id).toBe(2)
    expect(chooseRule(rules, ctx({})))?.toMatchObject({ source: 'general-rule' })
  })

  it('treats the upper age bound as exclusive', () => {
    expect(chooseRule(rules, ctx({ ageDays: 45 * YEAR }))?.rule.id).toBe(2)
    expect(chooseRule(rules, ctx({ ageDays: 45 * YEAR - 1 }))?.rule.id).toBe(3)
  })

  it('finds nothing when no rule fits', () => {
    expect(chooseRule([rule(9, { sex: 'male' })], ctx({}))).toBeNull()
  })
})
