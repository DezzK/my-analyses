import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { join } from 'node:path'
import { createApi } from './api'
import {
  applyPendingRestore,
  backupOnDataChange,
  BackupService,
  requestRestore,
  resolveBackupDir,
} from './backup'
import { checkIntegrity, DatabaseCorruptError, openDatabase, runMigrations } from './db/client'
import { fanOut, WindowEvents } from './events'
import { SyncService } from './import/sync'
import { registerApi } from './ipc'
import { LabBrowser } from './lab/browser'
import { configureDataDir, dataPaths } from './paths'
import { appWindowPreferences, loadRenderer, lockNavigation } from './renderer-window'
import { ReportPrinter } from './report-printer'
import { createServices } from './services'
import { SettingsStore } from './settings'
import { createUpdater } from './updates'
import { UpdateService } from './updates/update-service'
import { TrustedWindows } from './windows'

const APP_TITLE = 'Мои анализы'
/** Mantine's page background in each scheme, so the window never flashes the wrong color. */
const WINDOW_BACKGROUND = { dark: '#242424', light: '#ffffff' }

configureDataDir()

let mainWindow: BrowserWindow | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.whenReady().then(start).catch(fail)
}

function fail(error: unknown): void {
  console.error(error)
  dialog.showErrorBox(APP_TITLE, error instanceof Error ? error.message : String(error))
  app.exit(1)
}

async function start(): Promise<void> {
  const settings = new SettingsStore(dataPaths.settings())
  const backupDir = resolveBackupDir(settings, dataPaths.defaultBackups())
  applyPendingRestore({
    marker: dataPaths.pendingRestore(),
    database: dataPaths.database(),
    attachments: dataPaths.attachments(),
    backupDir,
  })

  const db = openDatabase(dataPaths.database())
  const windowEvents = new WindowEvents()
  const backups = new BackupService({
    db,
    settings,
    attachmentsDir: dataPaths.attachments(),
    defaultDir: dataPaths.defaultBackups(),
    events: windowEvents,
  })

  try {
    checkIntegrity(db)
  } catch (error) {
    if (!(error instanceof DatabaseCorruptError)) throw error
    db.$client.close()
    await offerRestoreFromLatest(backups)
    return
  }
  runMigrations(db, dataPaths.migrations(), () => backups.create('pre-migration'))

  const events = fanOut(windowEvents, backupOnDataChange(backups))
  const services = createServices({ db, events, attachmentsDir: dataPaths.attachments() })
  const { patients, units, labs, people, importer, dictionary } = services
  patients.purgeRemoved()
  units.ensureBuiltins()
  labs.ensureBuiltins()
  // Analytes imported before the dictionary knew them, or before it grew, join their entry.
  dictionary.apply()
  const sync = new SyncService({
    db,
    labs,
    people,
    importer,
    sessions: new LabBrowser(() => mainWindow),
    events,
  })
  sync.recoverInterrupted()

  const updates = new UpdateService({ updater: createUpdater(), events: windowEvents })

  const windows = new TrustedWindows()
  const printer = new ReportPrinter({ windows, parent: () => mainWindow })
  const window = createMainWindow()
  mainWindow = window
  windows.trust(window.webContents)
  // Login and sync windows of the embedded browser must not keep the app running on their own.
  window.on('closed', () => {
    mainWindow = null
    app.quit()
  })
  windowEvents.attach(window.webContents)
  registerApi(
    createApi({ ...services, window: () => mainWindow, settings, backups, sync, printer, updates }),
    (event) => windows.isTrusted(event),
  )
  void loadRenderer(window)

  backups.create('startup')
  app.on('before-quit', () => backups.flush())
  updates.schedule()
}

async function offerRestoreFromLatest(backups: BackupService): Promise<void> {
  const latest = backups.list().find((b) => b.reason !== 'pre-restore')
  if (!latest) {
    dialog.showErrorBox(APP_TITLE, 'База данных повреждена, а бэкапов не найдено.')
    app.exit(1)
    return
  }
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: APP_TITLE,
    message: 'База данных повреждена',
    detail: `Можно восстановить её из последнего бэкапа от ${new Date(latest.createdAt).toLocaleString('ru-RU')}. Повреждённая база сохранится рядом с бэкапами.`,
    buttons: ['Восстановить', 'Выйти'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    requestRestore(dataPaths.pendingRestore(), join(backups.dir(), latest.file))
    app.relaunch()
  }
  app.exit(0)
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_TITLE,
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: appWindowPreferences(),
  })
  window.once('ready-to-show', () => window.show())
  lockNavigation(window)
  return window
}
