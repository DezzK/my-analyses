import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { BackupInfo, BackupReason } from '@shared/api'
import type { Db } from './db/client'
import type { EventSink } from './events'
import {
  backupFileName,
  backupsToDelete,
  CHANGE_BACKUP_DELAY_MS,
  parseBackupFileName,
} from '@shared/backup-policy'
import type { SettingsStore } from './settings'

const ATTACHMENTS_SUBDIR = 'attachments'

interface BackupDeps {
  db: Db
  settings: SettingsStore
  attachmentsDir: string
  defaultDir: string
  events: EventSink
}

/** Writes a consistent, compacted copy of a live database to `target`. */
function vacuumInto(client: DatabaseSync, target: string): void {
  client.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
}

export function resolveBackupDir(settings: SettingsStore, defaultDir: string): string {
  return settings.read().backupDir ?? defaultDir
}

export class BackupService {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: BackupDeps) {}

  dir(): string {
    return resolveBackupDir(this.deps.settings, this.deps.defaultDir)
  }

  create(reason: BackupReason): BackupInfo {
    this.cancelScheduled()
    const dir = this.dir()
    mkdirSync(dir, { recursive: true })
    const file = backupFileName(new Date(), reason)
    vacuumInto(this.deps.db.$client, join(dir, file))
    this.copyNewAttachments(dir)
    for (const doomed of backupsToDelete(this.list().map(({ sizeBytes: _, ...name }) => name))) {
      rmSync(join(dir, doomed), { force: true })
    }
    const info = this.describe(dir, file)
    this.deps.events.emit({ type: 'backup-created', backup: info })
    return info
  }

  /** Coalesces a burst of changes into one backup written once things are quiet. */
  scheduleAfterChange(): void {
    this.cancelScheduled()
    this.timer = setTimeout(() => this.create('change'), CHANGE_BACKUP_DELAY_MS)
  }

  /** Writes a scheduled backup now, e.g. when the app is quitting. */
  flush(): void {
    if (this.timer) this.create('change')
  }

  list(): BackupInfo[] {
    const dir = this.dir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .map(parseBackupFileName)
      .filter((b) => b !== null)
      .map((b) => this.describe(dir, b.file))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  private describe(dir: string, file: string): BackupInfo {
    const name = parseBackupFileName(file)
    if (!name) throw new Error(`Not a backup file: ${file}`)
    return { ...name, sizeBytes: statSync(join(dir, file)).size }
  }

  private copyNewAttachments(dir: string): void {
    copyMissingFiles(this.deps.attachmentsDir, join(dir, ATTACHMENTS_SUBDIR))
  }

  private cancelScheduled(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/** Attachments are content-addressed, so a file that already exists at the target never changes. */
function copyMissingFiles(fromDir: string, toDir: string): void {
  if (!existsSync(fromDir)) return
  mkdirSync(toDir, { recursive: true })
  for (const name of readdirSync(fromDir)) {
    const dest = join(toDir, name)
    if (!existsSync(dest)) copyFileSync(join(fromDir, name), dest)
  }
}

/** Every change to stored data schedules a backup; services only report the change. */
export function backupOnDataChange(backups: BackupService): EventSink {
  return {
    emit: (event) => {
      if (event.type === 'data-changed') backups.scheduleAfterChange()
    },
  }
}

interface PendingRestore {
  file: string
}

/** Checks that `file` is an intact SQLite database before anything is overwritten with it. */
export function assertRestorable(file: string): void {
  const probe = new DatabaseSync(file, { readOnly: true })
  try {
    const row = probe.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined
    if (row?.quick_check !== 'ok') throw new Error(`Backup is damaged: ${file}`)
  } finally {
    probe.close()
  }
}

/** Records the restore; it is applied on the next start, before the database is opened. */
export function requestRestore(markerFile: string, backupFile: string): void {
  assertRestorable(backupFile)
  writeFileSync(markerFile, JSON.stringify({ file: backupFile } satisfies PendingRestore))
}

/**
 * Replaces the database with the backup named in the marker file, keeping a `pre-restore` copy
 * of the replaced database in the backup folder, and brings back attachments the backup folder
 * has and this machine lacks (a restore onto a new computer). Runs while no connection is open.
 */
export function applyPendingRestore(paths: {
  marker: string
  database: string
  attachments: string
  backupDir: string
}): void {
  if (!existsSync(paths.marker)) return
  const { file } = JSON.parse(readFileSync(paths.marker, 'utf8')) as PendingRestore
  rmSync(paths.marker)
  if (!existsSync(file)) return
  if (existsSync(paths.database)) {
    mkdirSync(paths.backupDir, { recursive: true })
    const current = new DatabaseSync(paths.database)
    try {
      vacuumInto(current, join(paths.backupDir, backupFileName(new Date(), 'pre-restore')))
    } finally {
      current.close()
    }
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${paths.database}${suffix}`, { force: true })
  copyFileSync(file, paths.database)
  copyMissingFiles(join(dirname(file), ATTACHMENTS_SUBDIR), paths.attachments)
}
