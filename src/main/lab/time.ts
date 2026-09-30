/** Moscow has kept UTC+3 all year since 2014. */
const MOSCOW_UTC_OFFSET_SECONDS = 3 * 3600
const MS_PER_SECOND = 1000

/** The Unix time of a moment given in epoch milliseconds, now unless told otherwise. */
export function unixSeconds(epochMs: number = Date.now()): number {
  return Math.floor(epochMs / MS_PER_SECOND)
}

/** A token about to run out is refreshed before use, so it cannot expire halfway through a sync. */
const TOKEN_MARGIN_SECONDS = 60

/** Whether a token that runs out at `expiresAt`, a Unix time, is still good to use. */
export function tokenUsable(expiresAt: number): boolean {
  return expiresAt - unixSeconds() > TOKEN_MARGIN_SECONDS
}

/** The Moscow calendar date of a Unix time, `YYYY-MM-DD`: Russian labs date samples in Moscow time. */
export function moscowDate(unixTime: number): string {
  return new Date((unixTime + MOSCOW_UTC_OFFSET_SECONDS) * MS_PER_SECOND).toISOString().slice(0, 10)
}
