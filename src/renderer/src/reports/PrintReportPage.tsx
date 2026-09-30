import { useEffect } from 'react'
import { useQueries } from '@tanstack/react-query'
import { REPORT_READY_ATTRIBUTE, reportSpecFrom } from '@shared/report'
import { analyteResultsQuery, usePatients } from '../queries'
import { ReportDocument } from './ReportDocument'

/**
 * The report alone, for the main process to print to PDF: once every block has its data, it waits
 * for the charts to draw and says it is ready.
 */
export function PrintReportPage() {
  // Read from the address as the main process wrote it, not as the router parsed it.
  const spec = reportSpecFrom(window.location.hash.split('?')[1] ?? '')
  const { data: patients = [] } = usePatients()
  const patient = patients.find((p) => p.id === spec?.patientId)
  const results = useQueries({
    queries: (spec?.blocks ?? []).map((block) => analyteResultsQuery(block.analyteId, spec?.patientId ?? 0)),
  })
  const loaded = patient !== undefined && results.every((r) => r.isSuccess)

  useEffect(() => {
    if (!loaded) return
    // Two frames: one for the charts to mount, one for them to draw.
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => document.documentElement.setAttribute(REPORT_READY_ATTRIBUTE, ''))
    })
    return () => cancelAnimationFrame(outer)
  }, [loaded])

  if (!spec || !patient) return null
  return <ReportDocument spec={spec} patient={patient} />
}
