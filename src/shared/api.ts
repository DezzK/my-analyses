import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { analyte, lab, patient, patientPeriod, referenceRule, unit } from '@main/db/schema'
import type { BackupReason } from './backup-policy'
import type {
  CyclePhase,
  LabFlag,
  OrderSource,
  Specimen,
  SyncStage,
  SyncStatus,
  ValueKind,
} from './domain/enums'
import type { Interpretation } from './domain/interpret'
import type { QualitativeCode } from './domain/values'

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

export type Unit = Pick<InferSelectModel<typeof unit>, 'id' | 'code' | 'display' | 'reviewed'>

/** An analyte found by search, with how much of it the patient has. */
export interface AnalyteHit {
  id: number
  name: string
  specimen: Specimen | null
  /** The synonym or lab code that matched, when it was not the name. */
  matched: string | null
  resultCount: number
  lastCollectedOn: string | null
}

export interface AnalyteSummary {
  id: number
  name: string
  specimen: Specimen | null
  description: string | null
  valueKind: ValueKind
  reviewed: boolean
  aliases: { id: number; alias: string; labId: number | null; labCode: string | null }[]
}

/** An analyte as the catalog lists it. */
export interface CatalogEntry {
  id: number
  name: string
  specimen: Specimen | null
  reviewed: boolean
  canonicalUnitId: number | null
  resultCount: number
  /** Lab codes the analyte is imported by. */
  codes: { labId: number | null; code: string }[]
}

/** Everything the analyte's card edits. */
export interface AnalyteCard extends AnalyteSummary {
  canonicalUnitId: number | null
  displayUnitId: number | null
  /** The unit results are shown in: the one the person chose, else the canonical one. */
  shownUnitId: number | null
  molarMass: number | null
  resultCount: number
  /** The analyte's units: `factor` converts into the canonical unit where dimensions cannot. */
  units: { unitId: number; factor: number | null; resultCount: number }[]
}

export type AnalyteInput = Pick<
  InferSelectModel<typeof analyte>,
  'name' | 'specimen' | 'description' | 'valueKind' | 'canonicalUnitId' | 'molarMass' | 'reviewed'
>

/** A merge of another analyte into this one that can still be undone. */
export interface AnalyteMerge {
  id: number
  sourceName: string
  createdAt: string
}

export type ReferenceRule = Omit<InferSelectModel<typeof referenceRule>, 'createdAt' | 'expected'> & {
  expected: QualitativeCode | null
}
export type RuleInput = Omit<ReferenceRule, 'id' | 'analyteId'>

/** A reference a lab printed next to the analyte's results, read into bounds, to start a rule from. */
export interface LabReference {
  labId: number
  text: string
  low: number | null
  high: number | null
  expected: QualitativeCode | null
  unitId: number | null
  count: number
  lastCollectedOn: string
}

/** An analyte an import created that nobody has looked at yet. */
export interface UnreviewedAnalyte {
  id: number
  name: string
  specimen: Specimen | null
  unitId: number | null
  codes: { labId: number | null; code: string }[]
  resultCount: number
}

/** A unit spelling an import met that no known unit had. */
export interface UnknownUnit {
  id: number
  display: string
  resultCount: number
  analyteNames: string[]
}

/** What waits for the person after imports; the patient parts are about the current patient. */
export interface MappingQueue {
  analytes: UnreviewedAnalyte[]
  units: UnknownUnit[]
  /** Orders with results whose norm depends on a cycle phase nobody recorded. */
  phaseOrders: OrderSummary[]
  /** Results the lab judged otherwise than the app: a reading error or a disputable reference. */
  disagreements: ResultRow[]
}

/** An existing analyte a new one may be the same as. */
export interface MatchSuggestion {
  id: number
  name: string
  unitId: number | null
}

/** A named set of analytes, entered and searched together: «Общий анализ крови». */
export interface Panel {
  id: number
  name: string
  analyteIds: number[]
}

/** A unit the analyte's results can be shown in; `convertible` when every result converts into it. */
export interface UnitOption {
  id: number
  convertible: boolean
}

/** A stored result read for display: as reported, plus how the app interprets it. */
export interface ResultRow {
  id: number
  orderId: number
  analyteId: number
  analyteName: string
  labId: number
  collectedOn: string
  collectedTime: string | null
  rawValue: string
  reportedUnitId: number | null
  refRaw: string | null
  labFlag: LabFlag | null
  userEdited: boolean
  note: string | null
  read: Interpretation
}

export interface AnalyteResults {
  analyte: AnalyteSummary
  /** The unit results are shown in: the one the person chose, else the analyte's canonical unit. */
  unitId: number | null
  units: UnitOption[]
  /** Newest first. */
  rows: ResultRow[]
}

export interface OrderSummary {
  id: number
  labId: number
  collectedOn: string
  collectedTime: string | null
  source: OrderSource
  note: string | null
  hasForm: boolean
  resultCount: number
  /** Results outside their reference. */
  deviationCount: number
}

export interface OrderDetails extends OrderSummary {
  patientId: number
  cyclePhase: CyclePhase | null
  formFile: string | null
  results: ResultRow[]
}

/** An order's own fields, as the person enters or corrects them. */
export interface OrderInput {
  patientId: number
  labId: number
  collectedOn: string
  collectedTime: string | null
  cyclePhase: CyclePhase | null
  note: string | null
  /** A form stored by `forms.pick`, or null. */
  formFile: string | null
}

/** One result as the person types it: stored as typed, read like a lab's. */
export interface ResultInput {
  analyteId: number
  rawValue: string
  unitId: number | null
  refRaw: string | null
  note: string | null
}

export interface ManualOrder extends OrderInput {
  results: ResultInput[]
}

/** Something about a typed result worth a second look; saving is still allowed. */
export interface RowWarning {
  row: number
  message: string
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
  units: {
    list(): Promise<Unit[]>
    /** An unknown spelling means `targetId`; its results move there and imports read it so. */
    map(unitId: number, targetId: number): Promise<void>
    /** Keeps an unknown spelling as a unit of its own. */
    accept(unitId: number): Promise<void>
  }
  mapping: {
    queue(patientId: number): Promise<MappingQueue>
    /** Takes analytes off the queue as looked at (`reviewed`), or puts them back. */
    setReviewed(analyteIds: number[], reviewed: boolean): Promise<void>
    /** Existing analytes that share words of the name with this one, the likeliest first. */
    suggestions(analyteId: number): Promise<MatchSuggestion[]>
  }
  analytes: {
    /** By name, synonym or lab code, ignoring case and ё; the patient's own analytes first. */
    search(query: string, patientId: number | null): Promise<AnalyteHit[]>
    results(analyteId: number, patientId: number): Promise<AnalyteResults>
    /** The unit the analyte is shown in everywhere; null returns to its canonical unit. */
    setDisplayUnit(analyteId: number, unitId: number | null): Promise<void>
    list(): Promise<CatalogEntry[]>
    card(analyteId: number): Promise<AnalyteCard>
    create(input: AnalyteInput): Promise<AnalyteSummary>
    update(analyteId: number, input: AnalyteInput): Promise<void>
    addAlias(analyteId: number, alias: string): Promise<void>
    /** Lab codes stay: an import finds the analyte by them. */
    removeAlias(aliasId: number): Promise<void>
    /** Allows a unit for the analyte, or changes its factor to the canonical unit. */
    setUnit(analyteId: number, unitId: number, factor: number | null): Promise<void>
    removeUnit(analyteId: number, unitId: number): Promise<void>
    /** Moves everything of `sourceId` into `targetId`; returns the merge, which can be undone. */
    merge(sourceId: number, targetId: number): Promise<number>
    merges(analyteId: number): Promise<AnalyteMerge[]>
    unmerge(mergeId: number): Promise<void>
  }
  rules: {
    list(analyteId: number): Promise<ReferenceRule[]>
    create(analyteId: number, input: RuleInput): Promise<ReferenceRule>
    update(ruleId: number, input: RuleInput): Promise<ReferenceRule>
    remove(ruleId: number): Promise<void>
    labReferences(analyteId: number): Promise<LabReference[]>
  }
  panels: {
    list(): Promise<Panel[]>
    save(panelId: number | null, name: string, analyteIds: number[]): Promise<Panel>
    remove(panelId: number): Promise<void>
  }
  orders: {
    /** Newest first. */
    list(patientId: number): Promise<OrderSummary[]>
    get(orderId: number): Promise<OrderDetails>
    /** Opens the original lab form in the system's PDF viewer. */
    openForm(orderId: number): Promise<void>
    /** The cycle phase the sample was collected in: some norms depend on it. */
    setCyclePhase(orderId: number, phase: CyclePhase | null): Promise<void>
    /** An order entered by hand; import never touches it. Returns its id. */
    create(order: ManualOrder): Promise<number>
    /** Warnings about results being typed, such as a value ten times off the previous one. */
    check(order: ManualOrder): Promise<RowWarning[]>
    update(orderId: number, header: OrderInput): Promise<void>
    /** Deletes the order and its results; the returned token undoes it for a while. */
    remove(orderId: number): Promise<string>
    undoRemove(token: string): Promise<void>
    addResult(orderId: number, input: ResultInput): Promise<void>
    /** Corrects a result; an imported one is then kept as corrected by later imports. */
    updateResult(resultId: number, input: ResultInput): Promise<void>
    removeResult(resultId: number): Promise<void>
  }
  forms: {
    /** Asks for a PDF or a photo of a lab form and stores it; null when the person cancels. */
    pick(): Promise<{ key: string; name: string } | null>
  }
  labs: {
    list(): Promise<Lab[]>
    /** A lab the app has no connector for, to enter its forms by hand. */
    create(name: string): Promise<Lab>
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
