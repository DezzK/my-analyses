import { app, net } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { MAC_ARCHES } from '@shared/release'
import { MacUpdater } from './mac-updater'
import type { Updater } from './updater'
import { AutoUpdater } from './auto-updater'

const execFileAsync = promisify(execFile)

/** This system's updater; none in a development build, which is never replaced. */
export function createUpdater(): Updater | null {
  if (!app.isPackaged) return null
  if (process.platform === 'win32') return new AutoUpdater()
  // electron-updater replaces an AppImage only; a Linux build unpacked anywhere else stays as it is.
  if (process.platform === 'linux') return process.env['APPIMAGE'] ? new AutoUpdater() : null
  const arch = MAC_ARCHES.find((known) => known === process.arch)
  if (process.platform !== 'darwin' || !arch) return null
  return new MacUpdater({
    fetch: (url) => net.fetch(url, { cache: 'no-store' }),
    run: (command, args) => execFileAsync(command, args, { encoding: 'utf8' }),
    spawnDetached: (command, args) => spawn(command, args, { detached: true, stdio: 'ignore' }).unref(),
    // The executable sits in `<bundle>/Contents/MacOS/`.
    bundle: resolve(app.getPath('exe'), '../../..'),
    stagingDir: join(app.getPath('temp'), 'my-analyses-update'),
    currentVersion: app.getVersion(),
    arch,
    pid: process.pid,
    quit: () => app.quit(),
    onQuit: (listener) => app.once('will-quit', listener),
  })
}
