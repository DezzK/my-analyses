/**
 * Calendar dates are plain `YYYY-MM-DD` strings everywhere: a sample is collected on a civil date,
 * not at an instant, so no time zone ever enters the arithmetic below.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length

/** The date of an ISO moment: `2015-03-01T08:30:00.000Z` → `2015-03-01`. */
export function datePart(isoMoment: string): string {
  return isoMoment.slice(0, ISO_DATE_LENGTH)
}
const MS_PER_DAY = 86_400_000

/** Days since 1970-01-01 of a valid ISO date, or null. */
export function epochDay(iso: string): number | null {
  const m = ISO_DATE.exec(iso)
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null
  }
  return ms / MS_PER_DAY
}

export function isIsoDate(value: string): boolean {
  return epochDay(value) !== null
}

export function isoFromEpochDay(day: number): string {
  return datePart(new Date(day * MS_PER_DAY).toISOString())
}

/** Whole days from `from` to `to`; both must be valid ISO dates. */
export function daysBetween(from: string, to: string): number {
  const a = epochDay(from)
  const b = epochDay(to)
  if (a === null || b === null) throw new Error(`Invalid ISO date: ${a === null ? from : to}`)
  return b - a
}

/** Today's date in the local calendar of the machine. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** `DD.MM.YYYY`, the way dates are written in Russian lab forms. */
export function formatDateRu(iso: string): string {
  const m = ISO_DATE.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

const DATE_RU = /^(\d{2})\.(\d{2})\.(\d{4})(?!\d)/

/** The ISO date a lab names in either way labs write dates (`2015-03-01T00:00:00`, `01.03.2015`); null if neither. */
export function isoFromLabDate(text: string): string | null {
  const iso = datePart(text.trim())
  return isIsoDate(iso) ? iso : isoFromDateRu(text)
}

/** The ISO date of one written as `formatDateRu` writes it, a time after it or not; null if none. */
export function isoFromDateRu(text: string): string | null {
  const m = DATE_RU.exec(text.trim())
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  return isIsoDate(iso) ? iso : null
}
