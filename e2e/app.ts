import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type Db } from '../src/main/db/client'
import { lab } from '../src/main/db/schema'
import type { RawOrder } from '../src/main/lab/types'
import { DATA_FILES } from '../src/main/paths'
import { createServices, type Services } from '../src/main/services'
import { DATA_DIR_ENV } from '../src/shared/env'

export interface RunningApp {
  app: ElectronApplication
  window: Page
  dataDir: string
}

/** Launches the built app (`npm run build` first) against a fresh, empty data folder. */
export async function launchApp(
  dataDir = mkdtempSync(join(tmpdir(), 'my-analyses-e2e-')),
): Promise<RunningApp> {
  const app = await electron.launch({
    args: [resolve(__dirname, '..')],
    env: { ...process.env, [DATA_DIR_ENV]: dataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  // Without animations a screenshot shows a dialog fully open, never halfway in.
  await window.emulateMedia({ reducedMotion: 'reduce' })
  return { app, window, dataDir }
}

/** Saves a screenshot when SCREENSHOT_DIR is set, for a person to review the UI. */
export async function snapshot(window: Page, name: string): Promise<void> {
  const dir = process.env['SCREENSHOT_DIR']
  if (dir) await window.screenshot({ path: join(dir, `${name}.png`) })
}

/**
 * Opens the database of a data folder whose app is closed, to prepare a state that cannot be
 * reached from the UI alone, such as a connected lab account.
 */
export function withDatabase(dataDir: string, prepare: (db: Db) => void): void {
  const db = openDatabase(join(dataDir, DATA_FILES.database))
  try {
    prepare(db)
  } finally {
    db.$client.close()
  }
}

/** Launches the app once so it creates its database, then closes it. */
export async function createDataDir(): Promise<string> {
  const first = await launchApp()
  await first.window.getByText('Мои анализы').first().waitFor()
  await first.app.close()
  return first.dataDir
}

export function labIdOf(db: Db, name: string): number {
  const id = db.select().from(lab).where(eq(lab.name, name)).get()?.id
  if (id === undefined) throw new Error(`No lab named ${name}`)
  return id
}

/**
 * Puts a patient and her orders into a closed app's data folder through the app's own import,
 * then runs `more` over the same database for what the UI would otherwise do first.
 */
export function seedImports(
  dataDir: string,
  ordersByLab: Record<string, RawOrder[]>,
  more: (db: Db, services: Services, patientId: number) => void = () => {},
): void {
  withDatabase(dataDir, (db) => {
    const services = createServices({
      db,
      events: { emit: () => {} },
      attachmentsDir: join(dataDir, DATA_FILES.attachments),
    })
    const anna = services.patients.create({
      title: 'Анна',
      sex: 'female',
      birthDate: '1990-05-14',
      note: null,
    })
    for (const [labName, orders] of Object.entries(ordersByLab)) {
      const target = {
        labId: labIdOf(db, labName),
        labAccountId: null,
        patientId: anna.id,
        connectorVersion: 'e2e',
      }
      services.importer.importOrders(target, orders)
    }
    more(db, services, anna.id)
  })
}
