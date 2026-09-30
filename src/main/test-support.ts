import { resolve } from 'node:path'
import { openDatabase, runMigrations, type Db } from './db/client'
import type { EventSink } from './events'

/** The real migrations folder, so tests run against the schema the app ships. */
export const MIGRATIONS_DIR = resolve(__dirname, '../../drizzle')

export function createTestDb(): Db {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS_DIR, () => {})
  return db
}

export function silentEvents(): EventSink & { emitted: unknown[] } {
  const emitted: unknown[] = []
  return { emitted, emit: (event) => emitted.push(event) }
}
