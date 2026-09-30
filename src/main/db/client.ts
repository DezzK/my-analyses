import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

export function openDatabase(file: string) {
  const client = new DatabaseSync(file)
  client.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)
  return drizzle({ client })
}

export type Db = ReturnType<typeof openDatabase>

export class DatabaseCorruptError extends Error {
  override readonly name = 'DatabaseCorruptError'
}

/** Throws DatabaseCorruptError unless SQLite's own consistency check passes. */
export function checkIntegrity(db: Db): void {
  const rows = db.$client.prepare('PRAGMA quick_check').all() as { quick_check: string }[]
  const problems = rows.map((r) => r.quick_check).filter((s) => s !== 'ok')
  if (problems.length > 0) throw new DatabaseCorruptError(problems.slice(0, 5).join('; '))
}

const MIGRATIONS_TABLE = '__drizzle_migrations'

/** Names of the migrations in `folder` this database has not applied yet. */
export function pendingMigrations(db: Db, folder: string): string[] {
  const local = readMigrationFiles({ migrationsFolder: folder }).map((m) => m.name)
  const tracked = db.$client
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE)
  if (!tracked) return local
  const applied = new Set(
    (db.$client.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all() as { name: string }[]).map(
      (r) => r.name,
    ),
  )
  return local.filter((name) => !applied.has(name))
}

/**
 * Applies pending migrations. When the database already holds data, `snapshot` runs first, so an
 * update of the app can never be the way a person loses their data.
 */
export function runMigrations(db: Db, folder: string, snapshot: () => void): void {
  const pending = pendingMigrations(db, folder)
  if (pending.length === 0) return
  const hasData = db.$client
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'patient'")
    .get()
  if (hasData) snapshot()
  migrate(db, { migrationsFolder: folder })
}
