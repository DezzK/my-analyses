import type { Db } from './client'

/**
 * Runs `fn` as one SQLite transaction on the app's single connection, so services called inside
 * it (each using that connection) commit or roll back together. Called inside another, it joins
 * that one: the outer call commits or rolls back for both.
 */
export function inTransaction<T>(db: Db, fn: () => T): T {
  if (db.$client.isTransaction) return fn()
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
