import { daysBetween } from './dates'
import type { CyclePhase, PeriodKind, ReferenceCondition } from './enums'

/** Gestational week (counted from the first day of the last period) at which each trimester starts. */
export const SECOND_TRIMESTER_WEEK = 14
export const THIRD_TRIMESTER_WEEK = 28
const DAYS_PER_WEEK = 7

const PHASE_CONDITION: Record<CyclePhase, ReferenceCondition> = {
  follicular: 'phase_follicular',
  ovulatory: 'phase_ovulatory',
  luteal: 'phase_luteal',
}

/** Conditions that only an order's recorded cycle phase can establish. */
export const CYCLE_PHASE_CONDITIONS: readonly ReferenceCondition[] = Object.values(PHASE_CONDITION)

/** Whether a cycle phase can be asked about on `date`: not during a pregnancy or after menopause. */
export function cycleOn(date: string, periods: readonly PeriodLike[]): boolean {
  return conditionsOn(date, periods, null).size === 0
}

export interface PeriodLike {
  kind: PeriodKind
  startDate: string
  endDate: string | null
}

function covers(period: PeriodLike, date: string): boolean {
  return period.startDate <= date && (period.endDate === null || date <= period.endDate)
}

export function trimesterCondition(pregnancyStart: string, date: string): ReferenceCondition {
  const weeks = Math.floor(daysBetween(pregnancyStart, date) / DAYS_PER_WEEK)
  if (weeks >= THIRD_TRIMESTER_WEEK) return 'pregnancy_t3'
  if (weeks >= SECOND_TRIMESTER_WEEK) return 'pregnancy_t2'
  return 'pregnancy_t1'
}

/** The conditions that held when a sample was collected: from the patient's periods and the order. */
export function conditionsOn(
  date: string,
  periods: readonly PeriodLike[],
  cyclePhase: CyclePhase | null,
): Set<ReferenceCondition> {
  const conditions = new Set<ReferenceCondition>()
  for (const period of periods) {
    if (!covers(period, date)) continue
    conditions.add(period.kind === 'pregnancy' ? trimesterCondition(period.startDate, date) : 'postmenopause')
  }
  if (cyclePhase) conditions.add(PHASE_CONDITION[cyclePhase])
  return conditions
}
