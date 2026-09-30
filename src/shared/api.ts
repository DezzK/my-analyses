import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { lab, patient, patientPeriod } from '@main/db/schema'
import type { BackupReason } from './backup-policy'
import type { SyncStage, SyncStatus } from './domain/enums'

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

export type Lab = Pick<InferSelectModel<typeof lab>, 'id' | 'name' | 'markerColor' | 'markerShape'> & {
  /** The app has a connector for this lab, so its personal account can be connected. */
  connectable: boolean
}

/** A lab's personal account connected to the app, and how its latest sync went. */
export interface LabAccount {
  id: number
  labId: number
  /** The account holder's name as the lab shows it, or the lab's name until the first login. */
  label: string
  /** Whose results the account holds; imported orders go to this patient. */
  patientId: number | null
  lastSyncAt: string | null
  lastRun: SyncRun | null
}

export interface SyncRun {
  id: number
  accountId: number
  startedAt: string
  finishedAt: string | null
  status: SyncStatus
  stats: SyncStats | null
  /** What went wrong, when the status is `error`. */
  error: string | null
}

export interface SyncProgress {
  accountId: number
  stage: SyncStage
  /** Orders fetched so far out of `total`, during the `orders` stage. */
  done: number
  total: number
}

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
  labs: {
    list(): Promise<Lab[]>
    accounts(): Promise<LabAccount[]>
    /**
     * Opens the lab's site for the person to log in. Once they have, the account is kept and its
     * first sync starts; if they close the window first, nothing is kept and the result is null.
     */
    connect(labId: number, patientId: number): Promise<LabAccount | null>
    /** Opens an account's site again to renew its login; a sync starts once the person is in. */
    login(accountId: number): Promise<boolean>
    setPatient(accountId: number, patientId: number): Promise<void>
    /** Forgets the account and its login; orders imported from it stay. */
    disconnect(accountId: number): Promise<void>
  }
  sync: {
    /** Imports what is new in the account; joins a sync of it that is already running. */
    account(accountId: number): Promise<SyncRun>
    all(): Promise<SyncRun[]>
    history(accountId: number): Promise<SyncRun[]>
    progress(): Promise<SyncProgress[]>
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
  | { type: 'data-changed'; scopes: DataScope[] }
  | { type: 'backup-created'; backup: BackupInfo }
  /** Every sync running right now; an empty list once the last one has finished. */
  | { type: 'sync-progress'; progress: SyncProgress[] }
