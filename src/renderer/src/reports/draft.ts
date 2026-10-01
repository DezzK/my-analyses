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

/** The draft with the analytes added at the end in their order, shown both ways; ones there already stay where they are. */
export function withAnalytes(draft: ReportDraft, analyteIds: readonly number[]): ReportDraft {
  const present = new Set(draft.blocks.map((block) => block.analyteId))
  const added = [...new Set(analyteIds)].filter((id) => !present.has(id))
  if (added.length === 0) return draft
  const blocks = added.map((analyteId) => ({ analyteId, view: 'both' as const, breakAfter: false }))
  return { ...draft, blocks: [...draft.blocks, ...blocks] }
}
