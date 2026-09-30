import { daysBetween } from './dates'

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
