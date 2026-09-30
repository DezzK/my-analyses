import type { ReferenceCondition, Sex } from './enums'
import { DECIMAL_PATTERN, parseDecimal } from './numbers'
import {
  isUpperBound,
  normalizeWords,
  parseQualitative,
  QUALITATIVE_POLARITY,
  readBound,
  type ParsedValue,
  type QualitativeCode,
} from './values'

/** A reference range as a lab printed it, read into bounds; the unit is left as text. */
export type ParsedReference =
  | { kind: 'range'; low: number | null; high: number | null; unitText: string | null }
  | { kind: 'qualitative'; expected: QualitativeCode }

const DASHES = /[‐‑‒–—−]/g
const RANGE = new RegExp(`^(?:от\\s*)?(${DECIMAL_PATTERN})\\s*(?:-|до)\\s*(${DECIMAL_PATTERN})\\s*(.*)$`)
const LEADING_NUMBER = new RegExp(`^(${DECIMAL_PATTERN})\\s*(.*)$`)

/** What follows the bounds is a unit only if it does not open a comment: "(не обнаружено)". */
function unitOf(rest: string | undefined): string | null {
  const text = (rest ?? '').trim()
  return text && !/^[()]/.test(text) ? text : null
}

function num(text: string | undefined): number | null {
  return parseDecimal(text ?? '')?.value ?? null
}

/**
 * Reads "3,9–5,5 ммоль/л", "<5 мг/л", ">60", "отрицательно". Returns null for what cannot be
 * read — "см. результат в pdf заказа", tables of zones — and the raw text is kept elsewhere.
 */
export function parseReference(raw: string | null | undefined): ParsedReference | null {
  if (!raw) return null
  const text = normalizeWords(raw.replace(DASHES, '-'))
  const range = RANGE.exec(text)
  if (range) {
    const [low, high] = [num(range[1]), num(range[2])]
    if (low !== null && high !== null && low <= high) {
      return { kind: 'range', low, high, unitText: unitOf(range[3]) }
    }
  }
  const bound = readBound(text)
  const edge = bound && LEADING_NUMBER.exec(bound.rest)
  const limit = num(edge?.[1])
  if (bound && edge && limit !== null) {
    const unitText = unitOf(edge[2])
    return isUpperBound(bound.comparator)
      ? { kind: 'range', low: null, high: limit, unitText }
      : { kind: 'range', low: limit, high: null, unitText }
  }
  const expected = parseQualitative(text)
  if (expected) return { kind: 'qualitative', expected }
  return null
}

/** Bounds (or an expected answer) in the unit of the value they are compared with. */
export interface ReferenceBounds {
  low: number | null
  high: number | null
  expected: QualitativeCode | null
}

export type Deviation = 'high' | 'low' | 'normal' | 'abnormal'

/**
 * Bounds belong to the norm. A value reported as a bound ("<0,1") is judged by what it proves:
 * below a low bound it cannot reach, inside the range when every value it allows is inside,
 * undetermined (null) otherwise. A lower bound of zero or less constrains nothing measurable.
 */
export function evaluate(value: ParsedValue, ref: ReferenceBounds): Deviation | null {
  if (value.kind === 'qualitative') {
    if (ref.expected === null) return null
    return QUALITATIVE_POLARITY[value.code] === QUALITATIVE_POLARITY[ref.expected] ? 'normal' : 'abnormal'
  }
  if (value.kind !== 'numeric') return null
  const { low, high } = ref
  if (low === null && high === null) return null
  const v = value.value
  switch (value.comparator) {
    case null:
      if (low !== null && v < low) return 'low'
      if (high !== null && v > high) return 'high'
      return 'normal'
    case '<':
    case '<=': {
      const provesLow = low !== null && (value.comparator === '<' ? v <= low : v < low)
      if (provesLow) return 'low'
      if (high !== null && v > high) return null
      if (low !== null && low > 0) return null
      return 'normal'
    }
    case '>':
    case '>=': {
      const provesHigh = high !== null && (value.comparator === '>' ? v >= high : v > high)
      if (provesHigh) return 'high'
      if (high !== null) return null
      if (low !== null && v < low) return null
      return 'normal'
    }
  }
}

/** A reference rule of the catalog, as far as choosing one needs it. */
export interface RuleLike {
  id: number
  labId: number | null
  sex: Sex | null
  ageFromDays: number | null
  ageToDays: number | null
  condition: ReferenceCondition | null
}

/** Who and what a result is about, on its collection date. */
export interface ReferenceContext {
  labId: number
  sex: Sex
  ageDays: number
  conditions: ReadonlySet<ReferenceCondition>
}

export type ReferenceSource = 'lab' | 'lab-rule' | 'general-rule'

function applies(rule: RuleLike, ctx: ReferenceContext): boolean {
  return (
    (rule.sex === null || rule.sex === ctx.sex) &&
    (rule.ageFromDays === null || ctx.ageDays >= rule.ageFromDays) &&
    (rule.ageToDays === null || ctx.ageDays < rule.ageToDays) &&
    (rule.condition === null || ctx.conditions.has(rule.condition))
  )
}

function ageSpan(rule: RuleLike): number {
  return (rule.ageToDays ?? Number.POSITIVE_INFINITY) - (rule.ageFromDays ?? 0)
}

/** More specific first: a condition, then a sex, then the narrowest age range; older rule on a tie. */
function bySpecificity(a: RuleLike, b: RuleLike): number {
  const condition = Number(b.condition !== null) - Number(a.condition !== null)
  if (condition !== 0) return condition
  const sex = Number(b.sex !== null) - Number(a.sex !== null)
  if (sex !== 0) return sex
  const span = ageSpan(a) - ageSpan(b)
  if (span !== 0) return span
  return a.id - b.id
}

/**
 * The rule that sets the norm for a result the lab printed no usable reference for: the most
 * specific rule of the result's own lab, else the most specific general rule, else none.
 */
export function chooseRule<R extends RuleLike>(
  rules: readonly R[],
  ctx: ReferenceContext,
): { rule: R; source: Exclude<ReferenceSource, 'lab'> } | null {
  const fitting = rules.filter((r) => applies(r, ctx))
  const ownLab = fitting.filter((r) => r.labId === ctx.labId).sort(bySpecificity)[0]
  if (ownLab) return { rule: ownLab, source: 'lab-rule' }
  const general = fitting.filter((r) => r.labId === null).sort(bySpecificity)[0]
  if (general) return { rule: general, source: 'general-rule' }
  return null
}
