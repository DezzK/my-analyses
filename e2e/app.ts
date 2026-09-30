import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DATA_FILES } from '../src/main/paths'
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
export function withDatabase(dataDir: string, prepare: (db: ReturnType<typeof drizzle>) => void): void {
  const client = new DatabaseSync(join(dataDir, DATA_FILES.database))
  try {
    prepare(drizzle({ client }))
  } finally {
    client.close()
  }
}
