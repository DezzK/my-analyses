/**
 * Lab values are decimal strings whose precision means something: "5.40" was measured to three
 * significant digits, "5.4" to two. Numbers are parsed together with that precision and are
 * printed back with it, in the Russian style (decimal comma, no digit grouping).
 */

export interface ParsedNumber {
  value: number
  /** Digits after the decimal separator as written. */
  decimals: number
  /** Significant digits as written; an integer's trailing zeros count ("120" → 3). */
  sigDigits: number
}

/** A decimal as labs write it: optional sign, a point or a comma. Other patterns embed this one. */
export const DECIMAL_PATTERN = '[+-]?\\d+(?:[.,]\\d+)?'
const NUMBER = new RegExp(`^${DECIMAL_PATTERN}$`)

export function parseDecimal(text: string): ParsedNumber | null {
  const trimmed = text.trim()
  if (!NUMBER.test(trimmed)) return null
  const [whole = '', fraction = ''] = trimmed.replace(/^[+-]/, '').split(/[.,]/)
  const value = Number(trimmed.replace(',', '.'))
  const digits = `${whole}${fraction}`.replace(/^0+/, '')
  return { value, decimals: fraction.length, sigDigits: Math.max(1, digits.length) }
}

/** Enough significant digits to spell any stored double without its binary noise (0.1 + 0.2 → 0.3). */
const STORED_PRECISION = 15
const storedSpelling = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  maximumSignificantDigits: STORED_PRECISION,
})

/** A number read back from storage, with the precision its shortest spelling shows: 4.0 → "4". */
export function numberFromStored(value: number): ParsedNumber {
  return parseDecimal(storedSpelling.format(value)) ?? { value, decimals: 0, sigDigits: STORED_PRECISION }
}

export function roundSignificant(value: number, sigDigits: number): number {
  if (value === 0 || !Number.isFinite(value)) return value
  const magnitude = Math.floor(Math.log10(Math.abs(value)))
  const factor = 10 ** (sigDigits - 1 - magnitude)
  return Math.round(value * factor) / factor
}

/** Decimals needed to show `value` with `sigDigits` significant digits. */
function decimalsFor(value: number, sigDigits: number): number {
  if (value === 0) return Math.max(0, sigDigits - 1)
  const magnitude = Math.floor(Math.log10(Math.abs(value)))
  return Math.max(0, sigDigits - 1 - magnitude)
}

const formatters = new Map<number, Intl.NumberFormat>()

/** `5,40`: a fixed number of decimals, a decimal comma and no grouping, as labs print them. */
export function formatDecimal(value: number, decimals: number): string {
  let formatter = formatters.get(decimals)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    })
    formatters.set(decimals, formatter)
  }
  return formatter.format(value)
}

/** A computed value (after a unit conversion) shown with the precision of the value it came from. */
export function formatSignificant(value: number, sigDigits: number): string {
  const rounded = roundSignificant(value, sigDigits)
  return formatDecimal(rounded, decimalsFor(rounded, sigDigits))
}
