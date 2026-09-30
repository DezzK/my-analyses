import { formatNumber, parseDecimal } from '@shared/domain/numbers'

/** A number as typed, with a comma or a point: null when empty, undefined when unreadable. */
export function readDecimal(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseDecimal(trimmed)?.value
}

/** A stored number back in a text field. */
export function decimalText(value: number | null): string {
  return value === null ? '' : formatNumber(value)
}

export const NOT_A_NUMBER = 'Введите число, например 5,4'
