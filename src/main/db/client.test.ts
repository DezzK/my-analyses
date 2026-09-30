import { describe, expect, it, vi } from 'vitest'
import { patient } from './schema'
import { openDatabase, pendingMigrations, runMigrations } from './client'
import { MIGRATIONS_DIR } from '../test-support'

describe('runMigrations', () => {
  it('migrates a fresh database without a snapshot', () => {
    const db = openDatabase(':memory:')
    const snapshot = vi.fn()
    runMigrations(db, MIGRATIONS_DIR, snapshot)
    expect(snapshot).not.toHaveBeenCalled()
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([])
  })

  it('snapshots a database that holds data before applying a new migration', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS_DIR, () => {})
    db.insert(patient).values({ title: 'Анна', sex: 'female', birthDate: '1990-05-14' }).run()
    // Forget the last migration, as a database from the previous app version would.
    db.$client.exec('DROP TABLE analyte_search')
    db.$client.exec('DELETE FROM __drizzle_migrations WHERE id = (SELECT max(id) FROM __drizzle_migrations)')
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toHaveLength(1)

    const snapshot = vi.fn()
    runMigrations(db, MIGRATIONS_DIR, snapshot)
    expect(snapshot).toHaveBeenCalledOnce()
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([])
  })
})
