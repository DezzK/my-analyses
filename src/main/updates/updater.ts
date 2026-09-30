/** A platform's way of putting a newer version of the app in place; `UpdateService` drives it. */
export interface Updater {
  /** The newer version published, or null when this one is the newest. */
  check(): Promise<string | null>
  /** Fetches the version `check` found and makes sure it is ours and intact; `share` runs 0 to 1. */
  download(progress: (share: number) => void): Promise<void>
  /** Puts the downloaded version in place when the app quits; `restart` quits now and opens it. */
  install(restart: boolean): void
}
