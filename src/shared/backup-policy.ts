/** Quiet time after the last change before a backup is written; an import is one burst. */
export const CHANGE_BACKUP_DELAY_MS = 30_000
/** Regular backups kept regardless of age. */
export const KEEP_RECENT = 10
/** Snapshots taken right before a migration or a restore, kept apart from regular backups. */
export const KEEP_SAFETY = 5

const SAFETY_REASONS = ['pre-migration', 'pre-restore'] as const
export const BACKUP_REASONS = ['startup', 'change', 'manual', ...SAFETY_REASONS] as const
export type BackupReason = (typeof BACKUP_REASONS)[number]

const FILE_PREFIX = 'backup-'
const FILE_SUFFIX = '.sqlite'
const NAME = new RegExp(
  `^${FILE_PREFIX}(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.\\d{3}Z)-([a-z-]+)${FILE_SUFFIX.replace('.', '\\.')}$`,
)

function isSafety(reason: BackupReason): boolean {
  return (SAFETY_REASONS as readonly BackupReason[]).includes(reason)
}

export interface BackupName {
  file: string
  createdAt: string
  reason: BackupReason
}

/** `backup-2026-09-30T16-03-40.123Z-startup.sqlite`: sortable, file-system safe, self-describing. */
export function backupFileName(createdAt: Date, reason: BackupReason): string {
  return `${FILE_PREFIX}${createdAt.toISOString().replaceAll(':', '-')}-${reason}${FILE_SUFFIX}`
}

export function parseBackupFileName(file: string): BackupName | null {
  const m = NAME.exec(file)
  if (!m) return null
  const reason = m[2] as BackupReason
  if (!BACKUP_REASONS.includes(reason)) return null
  const [date, time] = (m[1] as string).split('T') as [string, string]
  return { file, createdAt: `${date}T${time.replaceAll('-', ':')}`, reason }
}

/**
 * Files to delete: regular backups beyond the newest KEEP_RECENT, except the oldest backup of
 * each calendar month, which stays forever; safety snapshots beyond the newest KEEP_SAFETY.
 */
export function backupsToDelete(backups: readonly BackupName[]): string[] {
  const newestFirst = [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const regular = newestFirst.filter((b) => !isSafety(b.reason))
  const safety = newestFirst.filter((b) => isSafety(b.reason))

  const firstOfMonth = new Map<string, BackupName>()
  for (const b of regular) firstOfMonth.set(b.createdAt.slice(0, 7), b) // oldest wins: list is newest first
  const monthly = new Set([...firstOfMonth.values()].map((b) => b.file))

  const doomedRegular = regular.slice(KEEP_RECENT).filter((b) => !monthly.has(b.file))
  const doomedSafety = safety.slice(KEEP_SAFETY)
  return [...doomedRegular, ...doomedSafety].map((b) => b.file)
}
