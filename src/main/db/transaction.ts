import type { Db } from './client'

/**
 * Runs `fn` as one SQLite transaction on the app's single connection, so services called inside
 * it (each using that connection) commit or roll back together.
 */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.$client.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.$client.exec('COMMIT')
    return result
  } catch (error) {
    db.$client.exec('ROLLBACK')
    throw error
  }
}
