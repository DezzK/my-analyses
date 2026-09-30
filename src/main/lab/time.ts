/** Moscow has kept UTC+3 all year since 2014. */
const MOSCOW_UTC_OFFSET_SECONDS = 3 * 3600
const MS_PER_SECOND = 1000

/** The Moscow calendar date of a Unix time, `YYYY-MM-DD`: Russian labs date samples in Moscow time. */
export function moscowDate(unixSeconds: number): string {
  return new Date((unixSeconds + MOSCOW_UTC_OFFSET_SECONDS) * MS_PER_SECOND).toISOString().slice(0, 10)
}
