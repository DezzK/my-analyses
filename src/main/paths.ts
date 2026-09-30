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

export const dataPaths = {
  dataDir: () => app.getPath('userData'),
  database: () => join(app.getPath('userData'), 'data.sqlite'),
  attachments: () => join(app.getPath('userData'), 'attachments'),
  settings: () => join(app.getPath('userData'), 'settings.json'),
  pendingRestore: () => join(app.getPath('userData'), 'restore-pending.json'),
  defaultBackups: () => join(app.getPath('userData'), 'backups'),
  migrations: () =>
    app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle'),
}
