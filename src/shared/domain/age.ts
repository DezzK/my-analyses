import { daysBetween } from './dates'

/** Average calendar year and month in days: reference rules count age in days. */
export const DAYS_PER_YEAR = 365.25
export const DAYS_PER_MONTH = DAYS_PER_YEAR / 12

/** Units an age limit of a reference rule is stated in. */
export const AGE_UNITS = ['years', 'months', 'days'] as const
export type AgeUnit = (typeof AGE_UNITS)[number]

const DAYS_IN: Record<AgeUnit, number> = { years: DAYS_PER_YEAR, months: DAYS_PER_MONTH, days: 1 }

/** Age in days on `onDate`: reference rules are keyed by it, so infants get week-level precision. */
export function ageInDays(birthDate: string, onDate: string): number {
  return daysBetween(birthDate, onDate)
}

/** Completed years on `onDate`, the way age is said aloud. */
export function ageInYears(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number]
  const hadBirthday = m > bm || (m === bm && d >= bd)
  return y - by - (hadBirthday ? 0 : 1)
}

/** An age limit stated in years, months or days, as the days a rule stores. */
export function ageToDays(value: number, unit: AgeUnit): number {
  return Math.round(value * DAYS_IN[unit])
}

/** The largest unit that states a stored limit as a whole number: 6574 days → 18 years. */
export function daysToAge(days: number): { value: number; unit: AgeUnit } {
  for (const unit of ['years', 'months'] as const) {
    const value = Math.round(days / DAYS_IN[unit])
    if (value > 0 && ageToDays(value, unit) === days) return { value, unit }
  }
  return { value: days, unit: 'days' }
}
