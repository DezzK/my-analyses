/** Moscow has kept UTC+3 all year since 2014. */
const MOSCOW_UTC_OFFSET_SECONDS = 3 * 3600
const MS_PER_SECOND = 1000

/** The Unix time of a moment given in epoch milliseconds, now unless told otherwise. */
export function unixSeconds(epochMs: number = Date.now()): number {
  return Math.floor(epochMs / MS_PER_SECOND)
}

/** The Moscow calendar date of a Unix time, `YYYY-MM-DD`: Russian labs date samples in Moscow time. */
export function moscowDate(unixTime: number): string {
  return new Date((unixTime + MOSCOW_UTC_OFFSET_SECONDS) * MS_PER_SECOND).toISOString().slice(0, 10)
}
