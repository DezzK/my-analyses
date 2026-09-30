import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, runMigrations, type Db } from './db/client'
import type { EventSink } from './events'
import type { connectorFor } from './lab/connectors'
import { createServices } from './services'

/** The real migrations folder, so tests run against the schema the app ships. */
export const MIGRATIONS_DIR = resolve(__dirname, '../../drizzle')

/** "Today" in tests that depend on it. */
export const TEST_TODAY = '2026-09-30'

export function createTestDb(): Db {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS_DIR, () => {})
  return db
}

export function silentEvents(): EventSink & { emitted: unknown[] } {
  const emitted: unknown[] = []
  return { emitted, emit: (event) => emitted.push(event) }
}

/**
 * The main-process services over a fresh in-memory database, wired as the app wires them, with
 * the built-in units and labs and one patient, Anna.
 */
export function createTestServices(options: { connectors?: typeof connectorFor } = {}) {
  const db = createTestDb()
  const events = silentEvents()
  const services = createServices({
    db,
    events,
    attachmentsDir: mkdtempSync(join(tmpdir(), 'attachments-')),
    connectors: options.connectors,
    today: () => TEST_TODAY,
  })
  services.units.ensureBuiltins()
  services.labs.ensureBuiltins()
  const kdl = services.labs.list().find((lab) => lab.name === 'KDL')
  if (!kdl) throw new Error('KDL is a built-in lab')
  const anna = services.patients.create({ title: 'Анна', sex: 'female', birthDate: '1990-05-14', note: null })
  return { ...services, db, events, kdlId: kdl.id, anna }
}
