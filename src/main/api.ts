import { app, dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Api, AppSettings } from '@shared/api'
import { UserError } from '@shared/errors'
import { FORM_EXTENSIONS, formExtensionOf } from './attachments'
import { requestRestore, type BackupService } from './backup'
import type { SyncService } from './import/sync'
import { dataPaths } from './paths'
import type { ReportPrinter } from './report-printer'
import type { Services as DataServices } from './services'
import type { SettingsStore } from './settings'
import type { UpdateService } from './updates/update-service'

interface Services extends DataServices {
  window: () => BrowserWindow | null
  settings: SettingsStore
  backups: BackupService
  sync: SyncService
  printer: ReportPrinter
  updates: UpdateService
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
    updates: {
      status: async () => s.updates.status(),
      check: () => s.updates.check(),
      restart: async () => s.updates.restart(),
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
      map: async (unitId, targetId) => s.units.map(unitId, targetId),
      accept: async (unitId) => s.units.accept(unitId),
    },
    mapping: {
      queue: async (patientId) => s.mapping.queue(patientId),
      setReviewed: async (analyteIds, reviewed) => s.analytes.setReviewed(analyteIds, reviewed),
      suggestions: async (analyteId) => s.mapping.suggestions(analyteId),
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
    reports: {
      templates: async () => s.reports.templates(),
      saveTemplate: async (templateId, title, blocks, layout) =>
        s.reports.saveTemplate(templateId, title, blocks, layout),
      removeTemplate: async (templateId) => s.reports.removeTemplate(templateId),
      preview: async (spec) => {
        s.reports.checkSpec(spec)
        await s.printer.preview(spec)
      },
      savePdf: async (spec, fileName) => {
        s.reports.checkSpec(spec)
        return s.printer.save(spec, fileName)
      },
    },
    panels: {
      list: async () => s.panels.list(),
      save: async (panelId, name, analyteIds) => s.panels.save(panelId, name, analyteIds),
      remove: async (panelId) => s.panels.remove(panelId),
    },
    orders: {
      list: async (patientId) => s.orders.list(patientId),
      get: async (orderId) => s.orders.get(orderId),
      setCyclePhase: async (orderId, phase) => s.orders.setCyclePhase(orderId, phase),
      create: async (order) => s.orders.create(order),
      check: async (order) => s.orders.check(order),
      update: async (orderId, header) => s.orders.update(orderId, header),
      remove: async (orderId) => s.orders.remove(orderId),
      undoRemove: async (token) => s.orders.undoRemove(token),
      addResult: async (orderId, input) => s.orders.addResult(orderId, input),
      updateResult: async (resultId, input) => s.orders.updateResult(resultId, input),
      removeResult: async (resultId) => s.orders.removeResult(resultId),
      openForm: async (orderId, index) => {
        const failure = await shell.openPath(s.orders.formPath(orderId, index))
        if (failure) throw new Error(failure)
      },
    },
    forms: {
      pick: async () => {
        const win = s.window()
        const options: OpenDialogOptions = {
          title: 'Бланк заказа',
          properties: ['openFile'],
          filters: [{ name: 'PDF или фото бланка', extensions: [...FORM_EXTENSIONS] }],
        }
        const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        const file = picked.filePaths[0]
        if (picked.canceled || !file) return null
        const extension = formExtensionOf(file)
        if (!extension) throw new UserError('Бланк — это PDF или фотография')
        return { key: s.attachments.store(await readFile(file), extension), name: basename(file) }
      },
    },
    labs: {
      list: async () => s.labs.list(),
      create: async (name) => s.labs.create(name),
      accounts: async () => s.sync.accounts(),
      connect: (labId, patientId) => s.sync.connect(labId, patientId),
      login: (accountId) => s.sync.login(accountId),
      setPatient: async (accountId, patientId) => s.labs.setAccountPatient(accountId, patientId),
      assignPerson: async (personId, patientId) => s.sync.assignPerson(personId, patientId),
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
