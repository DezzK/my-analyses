import { app, dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { basename, join } from 'node:path'
import type { Api, AppSettings } from '@shared/api'
import { requestRestore, type BackupService } from './backup'
import { dataPaths } from './paths'
import type { PatientService } from './services/patients'
import type { SettingsStore } from './settings'

interface Services {
  window: () => BrowserWindow | null
  settings: SettingsStore
  backups: BackupService
  patients: PatientService
}

/** The one implementation of the UI-facing API; every method delegates to the owning service. */
export function createApi(s: Services): Api {
  const settingsView = (): AppSettings => ({
    backupDir: s.backups.dir(),
    backupDirIsDefault: s.settings.read().backupDir === null,
  })

  return {
    app: {
      info: async () => ({
        version: app.getVersion(),
        dataDir: dataPaths.dataDir(),
        isPackaged: app.isPackaged,
      }),
    },
    settings: {
      get: async () => settingsView(),
      chooseBackupDir: async () => {
        const win = s.window()
        const options: OpenDialogOptions = {
          title: 'Папка для бэкапов',
          properties: ['openDirectory', 'createDirectory'],
        }
        const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        const dir = picked.filePaths[0]
        if (picked.canceled || !dir) return null
        s.settings.update({ backupDir: dir })
        s.backups.create('manual')
        return settingsView()
      },
    },
    backups: {
      list: async () => s.backups.list(),
      create: async () => s.backups.create('manual'),
      restore: async (file) => {
        // Only a file name crosses the boundary; it is resolved inside the backup folder.
        requestRestore(dataPaths.pendingRestore(), join(s.backups.dir(), basename(file)))
        setImmediate(() => {
          app.relaunch()
          app.exit(0)
        })
      },
      reveal: async () => {
        await shell.openPath(s.backups.dir())
      },
    },
    patients: {
      list: async () => s.patients.list(),
      create: async (input) => s.patients.create(input),
      update: async (id, input) => s.patients.update(id, input),
      remove: async (id) => s.patients.remove(id),
      restore: async (id) => s.patients.restore(id),
      orderCount: async (id) => s.patients.orderCount(id),
      periods: async (patientId) => s.patients.periods(patientId),
      addPeriod: async (patientId, input) => s.patients.addPeriod(patientId, input),
      updatePeriod: async (id, input) => s.patients.updatePeriod(id, input),
      removePeriod: async (id) => s.patients.removePeriod(id),
    },
  }
}
