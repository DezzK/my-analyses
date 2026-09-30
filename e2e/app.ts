import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  return { app, window, dataDir }
}

/** Saves a screenshot when SCREENSHOT_DIR is set, for a person to review the UI. */
export async function snapshot(window: Page, name: string): Promise<void> {
  const dir = process.env['SCREENSHOT_DIR']
  if (dir) await window.screenshot({ path: join(dir, `${name}.png`) })
}
