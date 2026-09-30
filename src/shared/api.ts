import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { patient, patientPeriod } from '@main/db/schema'
import type { BackupReason } from './backup-policy'

export type { BackupReason }

/**
 * The contract between the main process and the UI: every method the UI can call.
 * The main process implements this interface once (`src/main/api.ts`); the preload script
 * forwards calls by their dotted path (`patients.list`), so the two sides cannot drift apart.
 */

export const API_CHANNEL = 'api'
export const EVENT_CHANNEL = 'app-event'

export type Patient = Omit<InferSelectModel<typeof patient>, 'deletedAt'>
export type PatientInput = Pick<InferInsertModel<typeof patient>, 'title' | 'sex' | 'birthDate' | 'note'>
export type PatientPeriod = InferSelectModel<typeof patientPeriod>
export type PatientPeriodInput = Pick<
  InferInsertModel<typeof patientPeriod>,
  'kind' | 'startDate' | 'endDate'
>

export interface BackupInfo {
  file: string
  createdAt: string
  reason: BackupReason
  sizeBytes: number
}

export interface AppSettings {
  backupDir: string
  backupDirIsDefault: boolean
}

export interface AppInfo {
  version: string
  dataDir: string
  isPackaged: boolean
}

export interface Api {
  app: {
    info(): Promise<AppInfo>
  }
  settings: {
    get(): Promise<AppSettings>
    /** Opens a folder picker; null when the person canceled it. */
    chooseBackupDir(): Promise<AppSettings | null>
  }
  backups: {
    list(): Promise<BackupInfo[]>
    create(): Promise<BackupInfo>
    /** Restores the database from a backup file and restarts the app. */
    restore(file: string): Promise<void>
    reveal(): Promise<void>
  }
  patients: {
    list(): Promise<Patient[]>
    create(input: PatientInput): Promise<Patient>
    update(id: number, input: PatientInput): Promise<Patient>
    /** Hides the patient at once; the row is purged on a later start unless restored. */
    remove(id: number): Promise<void>
    restore(id: number): Promise<void>
    orderCount(id: number): Promise<number>
    periods(patientId: number): Promise<PatientPeriod[]>
    addPeriod(patientId: number, input: PatientPeriodInput): Promise<PatientPeriod>
    updatePeriod(id: number, input: PatientPeriodInput): Promise<PatientPeriod>
    removePeriod(id: number): Promise<void>
  }
}

/** What an import did, counted for the person and kept with each sync run. */
export interface SyncStats {
  ordersAdded: number
  ordersUpdated: number
  ordersUnchanged: number
  resultsAdded: number
  resultsUpdated: number
  /** Results the person corrected by hand; the lab's newer version was not applied over them. */
  resultsKeptEdited: number
  analytesCreated: number
  unknownUnits: number
}

/** Groups of data a change can touch; the UI refetches whatever depends on them. */
export type DataScope = 'patients' | 'periods' | 'labs' | 'orders' | 'catalog' | 'sync'

export type AppEvent =
  { type: 'data-changed'; scopes: DataScope[] } | { type: 'backup-created'; backup: BackupInfo }
