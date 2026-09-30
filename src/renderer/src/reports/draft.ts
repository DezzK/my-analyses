import { useMemo } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import type { ReportBlock, ReportLayout } from '@shared/api'
import { DEFAULT_REPORT_LAYOUT } from '@shared/report'
import type { Period } from '../analytes/periods'
import { useCatalog } from '../queries'

/** The report being built, kept between visits; the patient is always the current one. */
export interface ReportDraft {
  blocks: ReportBlock[]
  layout: ReportLayout
  period: Period
}

const DRAFT_KEY = 'my-analyses:report-draft'
const EMPTY: ReportDraft = { blocks: [], layout: DEFAULT_REPORT_LAYOUT, period: 'all' }

export function useReportDraft() {
  const [stored, setDraft] = useLocalStorage<ReportDraft>({
    key: DRAFT_KEY,
    defaultValue: EMPTY,
    getInitialValueInEffect: false,
  })
  const { data: catalog } = useCatalog()
  // An analyte merged into another leaves the catalog, and its block leaves the draft.
  const draft = useMemo(() => {
    if (!catalog) return stored
    const known = new Set(catalog.map((entry) => entry.id))
    return { ...stored, blocks: stored.blocks.filter((block) => known.has(block.analyteId)) }
  }, [stored, catalog])
  return [draft, setDraft] as const
}

/** The draft with the analyte added at the end, shown both ways, unless it is there already. */
export function withAnalyte(draft: ReportDraft, analyteId: number): ReportDraft {
  if (draft.blocks.some((block) => block.analyteId === analyteId)) return draft
  return { ...draft, blocks: [...draft.blocks, { analyteId, view: 'both', breakAfter: false }] }
}
