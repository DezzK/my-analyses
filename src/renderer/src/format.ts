import { ageInDays, ageInYears, DAYS_PER_MONTH } from '@shared/domain/age'
import { formatDateRu, todayIso } from '@shared/domain/dates'
import { AGE_UNIT_FORMS } from './labels'

export { formatDateRu as formatDate }

/** Russian noun form for a count: 1 год, 2 года, 5 лет. */
export function plural(n: number, forms: readonly [one: string, few: string, many: string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

export function formatAge(birthDate: string, on: string = todayIso()): string {
  const years = ageInYears(birthDate, on)
  if (years >= 1) return `${years} ${plural(years, AGE_UNIT_FORMS.years)}`
  const months = Math.floor(ageInDays(birthDate, on) / DAYS_PER_MONTH)
  return `${months} ${plural(months, AGE_UNIT_FORMS.months)}`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatBytes(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`
}
