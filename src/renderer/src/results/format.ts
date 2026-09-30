import type { ResultRow, Unit } from '@shared/api'
import type { ShownReference } from '@shared/domain/interpret'
import type { Deviation } from '@shared/domain/references'
import type { Comparator } from '@shared/domain/values'
import { QUALITATIVE_LABELS } from '../labels'

const COMPARATOR_SIGNS: Record<Comparator, string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥' }

/** The marks the original spec puts next to a value above or below its norm; bold does the rest. */
export const DEVIATION_MARKS: Record<Deviation, string> = {
  high: '(+)',
  low: '(−)',
  abnormal: '',
  normal: '',
}

const NO_VALUE = '—'

/** "<0,1", "5,40", "отрицательно" or the lab's own text. */
export function valueText(row: ResultRow): string {
  const { number, comparator, qualitative } = row.read.value
  if (number) return `${comparator ? COMPARATOR_SIGNS[comparator] : ''}${number.text}`
  if (qualitative) return QUALITATIVE_LABELS[qualitative]
  return row.rawValue
}

/** "3,9–5,5", "< 5", "> 60" or the expected answer, the way labs print references. */
export function referenceText(reference: ShownReference | null): string {
  if (!reference) return NO_VALUE
  if (reference.expected) return QUALITATIVE_LABELS[reference.expected]
  const { low, high } = reference
  if (low && high) return `${low.text}–${high.text}`
  if (high) return `< ${high.text}`
  if (low) return `> ${low.text}`
  return NO_VALUE
}

export function unitText(unitId: number | null, units: ReadonlyMap<number, Unit>): string {
  return unitId === null ? '' : (units?.get(unitId)?.display ?? '')
}
