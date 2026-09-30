import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AttachmentStore } from './attachments'
import { openDatabase, runMigrations, type Db } from './db/client'
import type { EventSink } from './events'
import { ImportService } from './import/importer'
import { connectorFor } from './lab/connectors'
import { AnalyteService } from './services/analytes'
import { LabService } from './services/labs'
import { PatientService } from './services/patients'
import { UnitService } from './services/units'

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
  const units = new UnitService(db, events)
  units.ensureBuiltins()
  const labs = new LabService(db, events, options.connectors)
  labs.ensureBuiltins()
  const patients = new PatientService(db, events, () => TEST_TODAY)
  const analytes = new AnalyteService(db, events)
  const attachments = new AttachmentStore(mkdtempSync(join(tmpdir(), 'attachments-')))
  const importer = new ImportService({ db, units, analytes, attachments, events })
  const kdl = labs.list().find((lab) => lab.name === 'KDL')
  if (!kdl) throw new Error('KDL is a built-in lab')
  const anna = patients.create({ title: 'Анна', sex: 'female', birthDate: '1990-05-14', note: null })
  return { db, events, units, labs, patients, analytes, attachments, importer, kdlId: kdl.id, anna }
}
