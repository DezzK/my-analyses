import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Settings live in a small JSON file next to the database, not in it: the backup folder must be
 * known even when the database itself is the thing that needs restoring.
 */
export interface Settings {
  /** Null while the person has not chosen a folder; backups then go to the default one. */
  backupDir: string | null
}

const DEFAULTS: Settings = { backupDir: null }

export class SettingsStore {
  constructor(private readonly file: string) {}

  read(): Settings {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>
      return { ...DEFAULTS, ...parsed }
    } catch {
      return { ...DEFAULTS }
    }
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.read(), ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, this.file)
    return next
  }
}
