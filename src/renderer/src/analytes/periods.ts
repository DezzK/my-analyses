import { todayIso } from '@shared/domain/dates'

/** How far back the results of an analyte are shown. */
export const PERIODS = ['year', 'three-years', 'all'] as const
export type Period = (typeof PERIODS)[number]

export const PERIOD_LABELS: Record<Period, string> = {
  year: 'Год',
  'three-years': '3 года',
  all: 'Всё время',
}

const PERIOD_YEARS: Record<Period, number | null> = { year: 1, 'three-years': 3, all: null }

/** The first collection date inside the period, or null for all time. */
export function periodStart(period: Period, now: Date = new Date()): string | null {
  const years = PERIOD_YEARS[period]
  if (years === null) return null
  const start = new Date(now)
  start.setFullYear(now.getFullYear() - years)
  return todayIso(start)
}
