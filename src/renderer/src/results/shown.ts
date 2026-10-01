import type { ResultRow } from '@shared/api'

/** The results collected between `from` and `to`, both days included; null leaves that side open. */
export function collectedBetween<T extends Pick<ResultRow, 'collectedOn'>>(
  rows: readonly T[],
  from: string | null,
  to: string | null = null,
): T[] {
  return rows.filter(
    (row) => (from === null || row.collectedOn >= from) && (to === null || row.collectedOn <= to),
  )
}

/** Whether the results hold numbers a chart can plot. */
export function isPlottable(rows: readonly Pick<ResultRow, 'read'>[]): boolean {
  return rows.some((row) => row.read.value.number !== null)
}
