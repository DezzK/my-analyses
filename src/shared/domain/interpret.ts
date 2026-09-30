import { ageInDays } from './age'
import { conditionsOn, type PeriodLike } from './conditions'
import type { CyclePhase, LabFlag, Sex } from './enums'
import {
  formatDecimal,
  formatSignificant,
  numberFromStored,
  roundSignificant,
  type ParsedNumber,
} from './numbers'
import {
  chooseRule,
  evaluate,
  parseReference,
  type Deviation,
  type ReferenceSource,
  type RuleLike,
} from './references'
import { convert, type ConversionContext, type UnitInfo } from './units'
import { parseValue, type Comparator, type QualitativeCode } from './values'

/**
 * Reading one stored result the way every screen shows it: the value in the unit the person
 * chose, the reference that applies to it, and whether the value deviates. Tables, charts and
 * reports all call this, so they never disagree.
 */

/** A catalog rule with its bounds. */
export interface RuleWithBounds extends RuleLike {
  low: number | null
  high: number | null
  expected: QualitativeCode | null
  unitId: number | null
}

/** A stored result and the order it belongs to. */
export interface ResultFacts {
  rawValue: string
  unitId: number | null
  refRaw: string | null
  labFlag: LabFlag | null
  labId: number
  collectedOn: string
  cyclePhase: CyclePhase | null
}

export interface PatientFacts {
  sex: Sex
  birthDate: string
  periods: readonly PeriodLike[]
}

/** Everything about one analyte that reading its results needs. */
export interface AnalyteFacts {
  conversion: ConversionContext
  rules: readonly RuleWithBounds[]
  units: ReadonlyMap<number, UnitInfo>
  /** The unit a spelling printed inside a lab's reference range stands for. */
  resolveUnit: (spelling: string) => UnitInfo | null
}

/** A number as shown: its text keeps the precision the lab measured with; `value` is for charts. */
export interface ShownNumber {
  value: number
  text: string
}

export interface ShownValue {
  number: ShownNumber | null
  comparator: Comparator | null
  qualitative: QualitativeCode | null
  /** The unit `number` is in: the target, unless the value could not be brought into it. */
  unitId: number | null
  inTarget: boolean
}

export interface ShownReference {
  low: ShownNumber | null
  high: ShownNumber | null
  expected: QualitativeCode | null
  source: ReferenceSource
  /** The unit the bounds are in: the value's, unless they could not be brought into it. */
  unitId: number | null
  inValueUnit: boolean
}

export interface Interpretation {
  value: ShownValue
  reference: ShownReference | null
  deviation: Deviation | null
  /** The lab judged the result otherwise: a reading error on our side, or a disputable reference. */
  labDisagrees: boolean
}

/** Our verdicts that agree with each flag a lab can set. */
const AGREEING: Record<LabFlag, readonly Deviation[]> = {
  high: ['high'],
  low: ['low'],
  normal: ['normal'],
  abnormal: ['abnormal', 'high', 'low'],
}

/** A reference before it is shown: bounds as written, in the unit they were written in. */
interface FoundReference {
  low: ParsedNumber | null
  high: ParsedNumber | null
  expected: QualitativeCode | null
  unit: UnitInfo | null
  source: ReferenceSource
}

function sameUnit(a: UnitInfo | null, b: UnitInfo | null): boolean {
  return (a?.id ?? null) === (b?.id ?? null)
}

/** `n` in `to`, exactly; null when nothing relates the two units. */
function convertExact(n: ParsedNumber, from: UnitInfo | null, to: UnitInfo | null, ctx: ConversionContext) {
  if (sameUnit(from, to)) return n.value
  if (!from || !to) return null
  return convert(n.value, from, to, ctx)
}

/** `n` in `to` for display: as written when the unit does not change, else rounded to its precision. */
function express(
  n: ParsedNumber,
  from: UnitInfo | null,
  to: UnitInfo | null,
  ctx: ConversionContext,
): ShownNumber | null {
  const converted = convertExact(n, from, to, ctx)
  if (converted === null) return null
  if (sameUnit(from, to)) return { value: n.value, text: formatDecimal(n.value, n.decimals) }
  return { value: roundSignificant(converted, n.sigDigits), text: formatSignificant(converted, n.sigDigits) }
}

/** Both bounds of `ref` converted by `one`, or null when a bound that exists cannot be. */
function mapBounds<T>(
  ref: FoundReference,
  one: (n: ParsedNumber) => T | null,
): { low: T | null; high: T | null } | null {
  const low = ref.low ? one(ref.low) : null
  const high = ref.high ? one(ref.high) : null
  if ((ref.low && low === null) || (ref.high && high === null)) return null
  return { low, high }
}

/** The lab's own reference, when it can be read and its unit is known. */
function labReference(
  result: ResultFacts,
  reported: UnitInfo | null,
  facts: AnalyteFacts,
): FoundReference | null {
  const parsed = parseReference(result.refRaw)
  if (!parsed) return null
  if (parsed.kind === 'qualitative') {
    return { low: null, high: null, expected: parsed.expected, unit: reported, source: 'lab' }
  }
  const unit = parsed.unitText === null ? reported : facts.resolveUnit(parsed.unitText)
  if (parsed.unitText !== null && !unit) return null
  return { low: parsed.low, high: parsed.high, expected: null, unit, source: 'lab' }
}

/** The catalog rule for this lab, patient and collection date. */
function ruleReference(
  result: ResultFacts,
  patient: PatientFacts,
  facts: AnalyteFacts,
): FoundReference | null {
  const chosen = chooseRule(facts.rules, {
    labId: result.labId,
    sex: patient.sex,
    ageDays: ageInDays(patient.birthDate, result.collectedOn),
    conditions: conditionsOn(result.collectedOn, patient.periods, result.cyclePhase),
  })
  if (!chosen) return null
  const { rule, source } = chosen
  return {
    low: rule.low === null ? null : numberFromStored(rule.low),
    high: rule.high === null ? null : numberFromStored(rule.high),
    expected: rule.expected,
    unit: rule.unitId === null ? null : (facts.units.get(rule.unitId) ?? null),
    source,
  }
}

/**
 * Reads a result for display in `target` (null: in the unit it was reported in). The reference
 * comes from the lab's form first, then from the catalog rules for the lab, then from the
 * general rules; the deviation is judged in the unit the value was reported in, so a failed
 * conversion never changes a verdict.
 */
export function interpret(
  result: ResultFacts,
  target: UnitInfo | null,
  patient: PatientFacts,
  facts: AnalyteFacts,
): Interpretation {
  const ctx = facts.conversion
  const parsed = parseValue(result.rawValue)
  const reported = result.unitId === null ? null : (facts.units.get(result.unitId) ?? null)
  const wanted = target ?? reported

  let value: ShownValue = {
    number: null,
    comparator: null,
    qualitative: null,
    unitId: reported?.id ?? null,
    inTarget: true,
  }
  if (parsed.kind === 'numeric') {
    const inWanted = express(parsed, reported, wanted, ctx)
    value = {
      number: inWanted ?? express(parsed, reported, reported, ctx),
      comparator: parsed.comparator,
      qualitative: null,
      unitId: (inWanted ? wanted : reported)?.id ?? null,
      inTarget: inWanted !== null,
    }
  } else if (parsed.kind === 'qualitative') {
    value = { ...value, qualitative: parsed.code }
  }

  const found = labReference(result, reported, facts) ?? ruleReference(result, patient, facts)
  let reference: ShownReference | null = null
  let deviation: Deviation | null = null
  if (found) {
    const shownUnit = value.inTarget ? wanted : reported
    const inValueUnit = mapBounds(found, (n) => express(n, found.unit, shownUnit, ctx))
    const asWritten = mapBounds(found, (n) => express(n, found.unit, found.unit, ctx))
    const bounds = inValueUnit ?? asWritten
    reference = {
      low: bounds?.low ?? null,
      high: bounds?.high ?? null,
      expected: found.expected,
      source: found.source,
      unitId: (inValueUnit ? shownUnit : found.unit)?.id ?? null,
      inValueUnit: inValueUnit !== null,
    }
    const judged = mapBounds(found, (n) => convertExact(n, found.unit, reported, ctx))
    if (judged || found.expected !== null) {
      deviation = evaluate(parsed, {
        low: judged?.low ?? null,
        high: judged?.high ?? null,
        expected: found.expected,
      })
    }
  }

  const labDisagrees =
    result.labFlag !== null && deviation !== null && !AGREEING[result.labFlag].includes(deviation)
  return { value, reference, deviation, labDisagrees }
}
