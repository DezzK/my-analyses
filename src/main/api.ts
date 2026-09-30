import { app, dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { basename, join } from 'node:path'
import type { Api, AppSettings } from '@shared/api'
import { requestRestore, type BackupService } from './backup'
import type { SyncService } from './import/sync'
import { dataPaths } from './paths'
import type { Services as DataServices } from './services'
import type { SettingsStore } from './settings'

interface Services extends DataServices {
  window: () => BrowserWindow | null
  settings: SettingsStore
  backups: BackupService
  sync: SyncService
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
    units: {
      list: async () => s.units.list(),
    },
    analytes: {
      search: async (query, patientId) => s.analytes.search(query, patientId),
      results: async (analyteId, patientId) => s.results.forAnalyte(analyteId, patientId),
      setDisplayUnit: async (analyteId, unitId) => s.analytes.setDisplayUnit(analyteId, unitId),
      list: async () => s.analytes.list(),
      card: async (analyteId) => s.analytes.card(analyteId),
      create: async (input) => s.analytes.create(input),
      update: async (analyteId, input) => s.analytes.update(analyteId, input),
      addAlias: async (analyteId, alias) => s.analytes.addAlias(analyteId, alias),
      removeAlias: async (aliasId) => s.analytes.removeAlias(aliasId),
      setUnit: async (analyteId, unitId, factor) => s.analytes.setUnit(analyteId, unitId, factor),
      removeUnit: async (analyteId, unitId) => s.analytes.removeUnit(analyteId, unitId),
      merge: async (sourceId, targetId) => s.merges.merge(sourceId, targetId),
      merges: async (analyteId) => s.merges.list(analyteId),
      unmerge: async (mergeId) => s.merges.unmerge(mergeId),
    },
    rules: {
      list: async (analyteId) => s.rules.list(analyteId),
      create: async (analyteId, input) => s.rules.create(analyteId, input),
      update: async (ruleId, input) => s.rules.update(ruleId, input),
      remove: async (ruleId) => s.rules.remove(ruleId),
      labReferences: async (analyteId) => s.rules.labReferences(analyteId),
    },
    panels: {
      list: async () => s.panels.list(),
      save: async (panelId, name, analyteIds) => s.panels.save(panelId, name, analyteIds),
      remove: async (panelId) => s.panels.remove(panelId),
    },
    orders: {
      list: async (patientId) => s.orders.list(patientId),
      get: async (orderId) => s.orders.get(orderId),
      openForm: async (orderId) => {
        const failure = await shell.openPath(s.orders.formPath(orderId))
        if (failure) throw new Error(failure)
      },
    },
    labs: {
      list: async () => s.labs.list(),
      accounts: async () => s.sync.accounts(),
      connect: (labId, patientId) => s.sync.connect(labId, patientId),
      login: (accountId) => s.sync.login(accountId),
      setPatient: async (accountId, patientId) => s.labs.setAccountPatient(accountId, patientId),
      disconnect: (accountId) => s.sync.disconnect(accountId),
    },
    sync: {
      account: (accountId) => s.sync.syncAccount(accountId),
      all: () => s.sync.syncAll(),
      history: async (accountId) => s.sync.history(accountId),
      progress: async () => s.sync.currentProgress(),
    },
  }
}
