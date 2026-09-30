import { useEffect } from 'react'
import { useAnalyteCard, useUnits } from '../queries'

/** What a result's value field suggests typing. */
export const VALUE_PLACEHOLDER = '5,4 · <0,1 · отрицательно'

/**
 * The units a result of the analyte can be typed in, as select options. Until a unit is chosen,
 * the one the analyte is shown in is chosen for the person.
 */
export function useResultUnits(
  analyteId: number | null,
  unitId: string | null,
  choose: (unitId: string) => void,
): { value: string; label: string }[] {
  const units = useUnits()
  const { data: card } = useAnalyteCard(analyteId)
  const usual = card?.shownUnitId ?? null
  useEffect(() => {
    if (unitId === null && usual !== null) choose(String(usual))
  }, [unitId, usual, choose])
  return (card?.units ?? []).map((u) => ({
    value: String(u.unitId),
    label: units.get(u.unitId)?.display ?? '',
  }))
}
