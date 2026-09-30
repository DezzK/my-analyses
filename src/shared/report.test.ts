import { describe, expect, it } from 'vitest'
import type { ReportSpec } from './api'
import { REPORT_PRINT_ROUTE, reportPrintPath, reportSpecFrom } from './report'

describe('the print address', () => {
  it('carries the spec the main process writes to the page that reads it', () => {
    const spec: ReportSpec = {
      patientId: 3,
      from: '2025-09-30',
      to: null,
      blocks: [{ analyteId: 7, view: 'both', breakAfter: true }],
      layout: { chartsPerRow: 2 },
    }
    const [route, search] = reportPrintPath(spec).split('?')
    expect(route).toBe(REPORT_PRINT_ROUTE)
    expect(reportSpecFrom(search ?? '')).toEqual(spec)
    expect(reportSpecFrom('')).toBeNull()
  })
})
