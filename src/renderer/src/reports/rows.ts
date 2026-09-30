import type { ReportBlock } from '@shared/api'

/**
 * The report's rows: consecutive chart blocks stand side by side, as many as the layout allows,
 * and a page break after a block ends its row. Every other block has a row of its own.
 */
export function rowsOf(blocks: readonly ReportBlock[], chartsPerRow: number): ReportBlock[][] {
  const rows: ReportBlock[][] = []
  for (const block of blocks) {
    const last = rows.at(-1)
    const joins =
      block.view === 'chart' &&
      last !== undefined &&
      last.length < chartsPerRow &&
      last.every((b) => b.view === 'chart' && !b.breakAfter)
    if (joins) last.push(block)
    else rows.push([block])
  }
  return rows
}
