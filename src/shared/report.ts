import type { ReportLayout, ReportSpec } from './api'

/**
 * The report's paper: A4 portrait with even margins. The main process gives these margins to the
 * PDF, and the report is laid out at the width left between them, so what the screen draws is
 * what the paper gets.
 */
export const REPORT_PAGE = { widthMm: 210, heightMm: 297, marginMm: 15 } as const

export const REPORT_CONTENT_WIDTH_MM = REPORT_PAGE.widthMm - 2 * REPORT_PAGE.marginMm

/** Set on the print page's root element once every block has its data and its charts are drawn. */
export const REPORT_READY_ATTRIBUTE = 'data-report-ready'

/** The layout of a new report, and of a template saved before an option existed. */
export const DEFAULT_REPORT_LAYOUT: ReportLayout = { chartsPerRow: 1 }

/** Where the UI draws a report alone, without the app around it, for the main process to print. */
export const REPORT_PRINT_ROUTE = '/print/report'
const SPEC_PARAM = 'spec'

/** The print route with the report's spec in its address. */
export function reportPrintPath(spec: ReportSpec): string {
  return `${REPORT_PRINT_ROUTE}?${new URLSearchParams({ [SPEC_PARAM]: JSON.stringify(spec) })}`
}

/** The spec `reportPrintPath` put in an address's search part; null when there is none. */
export function reportSpecFrom(search: string): ReportSpec | null {
  const raw = new URLSearchParams(search).get(SPEC_PARAM)
  return raw ? (JSON.parse(raw) as ReportSpec) : null
}
