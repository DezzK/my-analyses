import { describe, expect, it } from 'vitest'
import { parseValue, splitValueAndUnit } from './values'

describe('parseValue', () => {
  it.each([
    ['5.40', { kind: 'numeric', value: 5.4, comparator: null, decimals: 2, sigDigits: 3 }],
    ['<0.1', { kind: 'numeric', value: 0.1, comparator: '<', decimals: 1, sigDigits: 1 }],
    ['< 0,1', { kind: 'numeric', value: 0.1, comparator: '<', decimals: 1, sigDigits: 1 }],
    ['≤5', { kind: 'numeric', value: 5, comparator: '<=', decimals: 0, sigDigits: 1 }],
    ['менее 0.5', { kind: 'numeric', value: 0.5, comparator: '<', decimals: 1, sigDigits: 1 }],
    ['>1000', { kind: 'numeric', value: 1000, comparator: '>', decimals: 0, sigDigits: 4 }],
    ['до 5', { kind: 'numeric', value: 5, comparator: '<=', decimals: 0, sigDigits: 1 }],
  ])('reads %s as a number', (raw, expected) => {
    expect(parseValue(raw)).toEqual(expected)
  })

  it.each([
    ['Отрицательно', 'negative'],
    ['НЕ ОБНАРУЖЕНО', 'not_detected'],
    ['не обнаружены.', 'not_detected'],
    ['обнаружено', 'detected'],
    ['Положительный', 'positive'],
    ['следы', 'trace'],
  ])('reads %s as a qualitative answer', (raw, code) => {
    expect(parseValue(raw)).toEqual({ kind: 'qualitative', code })
  })

  it.each(['2-4 в п/з', '1:160', '++', 'единичные', 'доза'])('keeps %s as text', (raw) => {
    expect(parseValue(raw)).toEqual({ kind: 'text' })
  })
})

describe('splitValueAndUnit', () => {
  it.each([
    ['5.40 ммоль/л', '5.40', 'ммоль/л'],
    ['7.2 %', '7.2', '%'],
    ['4.5 10*9/л', '4.5', '10*9/л'],
    ['4,5 ×10⁹/л', '4,5', '×10⁹/л'],
    ['<0.1 мг/л', '<0.1', 'мг/л'],
    ['5,1', '5,1', null],
    ['2-4 в п/з', '2-4 в п/з', null],
    ['1:160', '1:160', null],
    ['не обнаружено', 'не обнаружено', null],
    ['12 (в норме)', '12 (в норме)', null],
    ['2 000 1/мл', '2 000', '1/мл'],
    ['9,99 10^12/л', '9,99', '10^12/л'],
  ])('splits %s', (printed, valueText, unitText) => {
    expect(splitValueAndUnit(printed)).toEqual({ valueText, unitText })
  })
})
