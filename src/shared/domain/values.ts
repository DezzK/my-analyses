import { DECIMAL_PATTERN, parseDecimal } from './numbers'
import { foldCase } from './text'

/**
 * What a result says, read from the string a lab printed or a person typed: a number (possibly a
 * bound, "<0,1"), a qualitative answer ("отрицательно") or free text ("2–4 в п/з", "1:160").
 */

export const COMPARATORS = ['<', '<=', '>', '>='] as const
export type Comparator = (typeof COMPARATORS)[number]

export const QUALITATIVE_CODES = [
  'negative',
  'positive',
  'not_detected',
  'detected',
  'doubtful',
  'trace',
] as const
export type QualitativeCode = (typeof QUALITATIVE_CODES)[number]

export type ParsedValue =
  | {
      kind: 'numeric'
      value: number
      /** Set when the lab reported only a bound: `<` 0.1 means "below 0.1". */
      comparator: Comparator | null
      decimals: number
      sigDigits: number
    }
  | { kind: 'qualitative'; code: QualitativeCode }
  | { kind: 'text' }

/** Lowercase, ё → е, single spaces, no trailing period: how every vocabulary here is matched. */
export function normalizeWords(text: string): string {
  return foldCase(text).replace(/\s+/g, ' ').trim().replace(/\.$/, '')
}

const QUALITATIVE_WORDS: Record<QualitativeCode, readonly string[]> = {
  negative: ['отрицательно', 'отрицательный', 'отрицательная', 'отриц', 'neg', 'negative'],
  positive: ['положительно', 'положительный', 'положительная', 'полож', 'pos', 'positive'],
  not_detected: [
    'не обнаружено',
    'не обнаружены',
    'не обнаружен',
    'не обнаружена',
    'не выявлено',
    'не выявлены',
    'не выявлен',
    'отсутствует',
    'отсутствуют',
    'not detected',
  ],
  detected: ['обнаружено', 'обнаружены', 'обнаружен', 'обнаружена', 'выявлено', 'выявлены', 'detected'],
  doubtful: ['сомнительно', 'сомнительный', 'погранично', 'пограничный'],
  trace: ['следы', 'следовые количества'],
}

const QUALITATIVE_BY_WORD = new Map<string, QualitativeCode>(
  Object.entries(QUALITATIVE_WORDS).flatMap(([code, words]) =>
    words.map((word) => [word, code as QualitativeCode] as const),
  ),
)

/** Whether the thing looked for was found; two codes with the same polarity agree. */
export type Polarity = 'absent' | 'present' | 'doubtful'

export const QUALITATIVE_POLARITY: Record<QualitativeCode, Polarity> = {
  negative: 'absent',
  not_detected: 'absent',
  positive: 'present',
  detected: 'present',
  trace: 'present',
  doubtful: 'doubtful',
}

/** Words and signs that turn a number into a bound, in values and in reference ranges alike. */
const BOUND_WORDS: Record<string, Comparator> = {
  '<': '<',
  '<=': '<=',
  '≤': '<=',
  '>': '>',
  '>=': '>=',
  '≥': '>=',
  менее: '<',
  меньше: '<',
  до: '<=',
  более: '>',
  больше: '>',
  свыше: '>',
  от: '>=',
}

/** Longest first, so `<=` is not read as `<` followed by `=`. */
const BOUND_ALTERNATION = Object.keys(BOUND_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|')
const BOUND = new RegExp(`^(${BOUND_ALTERNATION})\\s*(.+)$`)

/** "<0,1 мг/л" → `<` and "0,1 мг/л"; null when the text does not start with a bound. */
export function readBound(text: string): { comparator: Comparator; rest: string } | null {
  const m = BOUND.exec(text)
  const comparator = BOUND_WORDS[m?.[1] ?? '']
  return m && comparator ? { comparator, rest: m[2] ?? '' } : null
}

export function isUpperBound(comparator: Comparator): boolean {
  return comparator === '<' || comparator === '<='
}

export function parseQualitative(text: string): QualitativeCode | null {
  return QUALITATIVE_BY_WORD.get(normalizeWords(text)) ?? null
}

export function parseValue(raw: string): ParsedValue {
  const text = normalizeWords(raw)
  const exact = parseDecimal(text)
  if (exact) return { kind: 'numeric', comparator: null, ...exact }
  const bound = readBound(text)
  const number = bound && parseDecimal(bound.rest)
  if (bound && number) return { kind: 'numeric', comparator: bound.comparator, ...number }
  const code = parseQualitative(text)
  if (code) return { kind: 'qualitative', code }
  return { kind: 'text' }
}

/** The number part of a printed value and what follows it: "5.40 ммоль/л" → "5.40", "ммоль/л". */
export interface SplitValue {
  valueText: string
  unitText: string | null
}

const LEADING_NUMBER = new RegExp(
  `^(?<number>(?:${BOUND_ALTERNATION})?\\s*${DECIMAL_PATTERN})\\s*(?<rest>.*)$`,
  'i',
)
/** A unit starts with a letter, a percent sign, a micro sign, a slash or a power of ten. */
const UNIT_START = /^(?:[\p{L}%µμ/]|(?:[x×х*]\s*)?10\s*[*^⁰¹²³⁴⁵⁶⁷⁸⁹])/u

export function splitValueAndUnit(printed: string): SplitValue {
  const text = printed.replace(/\s+/g, ' ').trim()
  const m = LEADING_NUMBER.exec(text)
  if (!m?.groups) return { valueText: text, unitText: null }
  const number = (m.groups['number'] ?? '').trim()
  const rest = (m.groups['rest'] ?? '').trim()
  if (!rest) return { valueText: number, unitText: null }
  if (UNIT_START.test(rest)) return { valueText: number, unitText: rest }
  return { valueText: text, unitText: null }
}
