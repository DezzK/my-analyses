import { describe, expect, it } from 'vitest'
import type { BackupReason } from './api'
import {
  backupFileName,
  backupsToDelete,
  KEEP_RECENT,
  KEEP_SAFETY,
  parseBackupFileName,
  type BackupName,
} from './backup-policy'

function backup(createdAt: string, reason: BackupReason = 'startup'): BackupName {
  const file = backupFileName(new Date(createdAt), reason)
  return { file, createdAt, reason }
}

describe('backup file names', () => {
  it('round-trips the time and the reason', () => {
    const file = backupFileName(new Date('2026-09-30T16:03:40.123Z'), 'pre-migration')
    expect(file).toBe('backup-2026-09-30T16-03-40.123Z-pre-migration.sqlite')
    expect(parseBackupFileName(file)).toEqual({
      file,
      createdAt: '2026-09-30T16:03:40.123Z',
      reason: 'pre-migration',
    })
  })

  it('ignores files that are not backups', () => {
    expect(parseBackupFileName('notes.txt')).toBeNull()
    expect(parseBackupFileName('backup-2026-09-30T16-03-40.123Z-weird.sqlite')).toBeNull()
  })
})

describe('backupsToDelete', () => {
  it('keeps the newest regular backups', () => {
    const days = Array.from({ length: KEEP_RECENT + 3 }, (_, i) =>
      backup(`2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`),
    )
    const doomed = backupsToDelete(days)
    // Sept 4–13 are the newest ten; Sept 1 stays as the month's keeper; Sept 2 and 3 go.
    expect(doomed).toEqual([days[2], days[1]].map((b) => b?.file))
  })

  it('keeps the first backup of every month forever', () => {
    const old = [backup('2025-01-15T10:00:00.000Z'), backup('2025-01-20T10:00:00.000Z')]
    const recent = Array.from({ length: KEEP_RECENT }, (_, i) =>
      backup(`2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`),
    )
    const doomed = backupsToDelete([...old, ...recent])
    expect(doomed).toEqual([old[1]?.file])
  })

  it('keeps safety snapshots apart from regular backups', () => {
    const snapshots = Array.from({ length: KEEP_SAFETY + 2 }, (_, i) =>
      backup(`2026-08-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`, 'pre-migration'),
    )
    const regular = Array.from({ length: KEEP_RECENT }, (_, i) =>
      backup(`2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`),
    )
    const doomed = backupsToDelete([...snapshots, ...regular])
    expect(doomed.sort()).toEqual([snapshots[0]?.file, snapshots[1]?.file].sort())
  })
})
