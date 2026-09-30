import { autoUpdater, type ProgressInfo } from 'electron-updater'
import type { Updater } from './updater'

/**
 * Windows and Linux updates through electron-updater: the NSIS installer or the AppImage of the
 * latest release, checked against the SHA-512 its `latest.yml` or `latest-linux.yml` states,
 * replaces the app when it quits.
 */
export class AutoUpdater implements Updater {
  constructor() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
  }

  async check(): Promise<string | null> {
    const result = await autoUpdater.checkForUpdates()
    return result?.isUpdateAvailable ? result.updateInfo.version : null
  }

  async download(progress: (share: number) => void): Promise<void> {
    const listener = (info: ProgressInfo) => progress(info.percent / 100)
    autoUpdater.on('download-progress', listener)
    try {
      await autoUpdater.downloadUpdate()
    } finally {
      autoUpdater.off('download-progress', listener)
    }
  }

  install(restart: boolean): void {
    // Without a restart, `autoInstallOnAppQuit` installs it on the way out.
    if (restart) autoUpdater.quitAndInstall(true, true)
  }
}
