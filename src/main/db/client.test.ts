import { cpSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    // The previous app version shipped every migration but the newest.
    const previous = mkdtempSync(join(tmpdir(), 'migrations-'))
    const shipped = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())
    for (const { name } of shipped.sort((a, b) => a.name.localeCompare(b.name)).slice(0, -1)) {
      cpSync(join(MIGRATIONS_DIR, name), join(previous, name), { recursive: true })
    }
    const db = openDatabase(':memory:')
    runMigrations(db, previous, () => {})
    db.insert(patient).values({ title: 'Анна', sex: 'female', birthDate: '1990-05-14' }).run()
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toHaveLength(1)

    const snapshot = vi.fn()
    runMigrations(db, MIGRATIONS_DIR, snapshot)
    expect(snapshot).toHaveBeenCalledOnce()
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([])
  })
})
