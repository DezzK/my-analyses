import { app, shell, type BrowserWindow, type WebPreferences } from 'electron'
import { join } from 'node:path'

/** How every window of the app's own UI runs: sandboxed, with only the preload's bridge. */
export function appWindowPreferences(): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false,
  }
}

/** Loads the UI into `window`, at `route` of its hash router. */
export function loadRenderer(window: BrowserWindow, route?: string): Promise<void> {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServer) return window.loadURL(route ? `${devServer}#${route}` : devServer)
  return window.loadFile(join(__dirname, '../renderer/index.html'), route ? { hash: route } : undefined)
}

/** Keeps a window where the app put it: links open in the person's browser, nothing navigates away. */
export function lockNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
}
