import { app } from 'electron'
import { join } from 'node:path'
import { DATA_DIR_ENV } from '@shared/env'

/** Data folder under the OS app-data directory; ASCII so every tool copes with the path. */
const DATA_DIR = 'my-analyses'

/** Must run before `app.whenReady()`: development builds keep their data apart from real data. */
export function configureDataDir(): void {
  const override = process.env[DATA_DIR_ENV]
  const name = app.isPackaged ? DATA_DIR : `${DATA_DIR}-dev`
  app.setPath('userData', override || join(app.getPath('appData'), name))
}

/** What the data folder holds; end-to-end tests prepare data folders with the same names. */
export const DATA_FILES = {
  database: 'data.sqlite',
  attachments: 'attachments',
  settings: 'settings.json',
  pendingRestore: 'restore-pending.json',
  defaultBackups: 'backups',
} as const

const inDataDir = (name: string) => join(app.getPath('userData'), name)

export const dataPaths = {
  dataDir: () => app.getPath('userData'),
  database: () => inDataDir(DATA_FILES.database),
  attachments: () => inDataDir(DATA_FILES.attachments),
  settings: () => inDataDir(DATA_FILES.settings),
  pendingRestore: () => inDataDir(DATA_FILES.pendingRestore),
  defaultBackups: () => inDataDir(DATA_FILES.defaultBackups),
  migrations: () =>
    app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle'),
}
