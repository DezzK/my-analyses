import { desc, eq } from 'drizzle-orm'
import type { LabAccount, SyncProgress, SyncRun, SyncStats } from '@shared/api'
import { daysBetween, todayIso } from '@shared/domain/dates'
import type { SyncStatus } from '@shared/domain/enums'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { syncRun } from '../db/schema'
import { dataChanged, type EventSink } from '../events'
import type { LabSessions } from '../lab/browser'
import { LabHttpError, type LabConnector, type LabPage, type OrderRef } from '../lab/types'
import type { LabAccountRow, LabService } from '../services/labs'
import { addStats, emptyStats, type ImportService, type ImportTarget } from './importer'

/**
 * Labs keep adding results to an order for weeks after the sample is taken (cultures, rare
 * tests), so every sync fetches the orders collected this recently once more.
 */
export const RECHECK_DAYS = 45
/** How many past runs of an account its history shows. */
const HISTORY_LIMIT = 20
const INTERRUPTED = 'Обновление прервалось: приложение было закрыто'

type SyncRunRow = typeof syncRun.$inferSelect
type AccountWithPatient = LabAccountRow & { defaultPatientId: number }

function toSyncRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    accountId: row.labAccountId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    stats: row.stats ? (JSON.parse(row.stats) as SyncStats) : null,
    error: row.error,
  }
}

/** Imported orders need a patient to belong to; an account loses its one when the patient is purged. */
function hasPatient(account: LabAccountRow): account is AccountWithPatient {
  return account.defaultPatientId !== null
}

/** The original form; one the lab has not issued yet is asked for again on a later sync. */
async function fetchForm(connector: LabConnector, page: LabPage, ref: OrderRef): Promise<Uint8Array | null> {
  if (!connector.fetchOrderPdf) return null
  try {
    return await connector.fetchOrderPdf(page, ref)
  } catch (error) {
    console.warn(`No form for order ${ref.externalKey}`, error)
    return null
  }
}

interface Deps {
  db: Db
  labs: LabService
  importer: ImportService
  sessions: LabSessions
  events: EventSink
  today?: () => string
}

/**
 * Connected lab accounts: logging in to them, importing what is new and recording every run.
 * An account syncs once at a time, inside the embedded browser, so every request carries the
 * session the person logged in with.
 */
export class SyncService {
  private readonly running = new Map<number, Promise<SyncRun>>()
  private readonly loggingIn = new Map<number, Promise<boolean>>()
  private readonly progress = new Map<number, SyncProgress>()
  private readonly today: () => string

  constructor(private readonly deps: Deps) {
    this.today = deps.today ?? (() => todayIso())
  }

  accounts(): LabAccount[] {
    return this.deps.labs.listAccounts().map((row) => this.view(row))
  }

  async connect(labId: number, patientId: number): Promise<LabAccount | null> {
    const { labs, sessions } = this.deps
    const account = labs.createAccount(labId, patientId)
    if (!(await this.showLogin(account))) {
      labs.removeAccount(account.id)
      await sessions.forget(account.sessionPartition)
      return null
    }
    this.syncInBackground(account.id)
    return this.view(labs.getAccount(account.id))
  }

  /** Joins the login window already open for the account, if there is one. */
  login(accountId: number): Promise<boolean> {
    const open = this.loggingIn.get(accountId)
    if (open) return open
    const login = this.showLogin(this.deps.labs.getAccount(accountId))
      .then((loggedIn) => {
        if (loggedIn) this.syncInBackground(accountId)
        return loggedIn
      })
      .finally(() => this.loggingIn.delete(accountId))
    this.loggingIn.set(accountId, login)
    return login
  }

  async disconnect(accountId: number): Promise<void> {
    if (this.running.has(accountId)) {
      throw new UserError('Дождитесь, пока закончится обновление этого кабинета')
    }
    const account = this.deps.labs.removeAccount(accountId)
    await this.deps.sessions.forget(account.sessionPartition)
  }

  /** Joins the sync of the account already running, if there is one. */
  syncAccount(accountId: number): Promise<SyncRun> {
    const current = this.running.get(accountId)
    if (current) return current
    const run = this.run(accountId).finally(() => this.running.delete(accountId))
    this.running.set(accountId, run)
    return run
  }

  /** Syncs every account that has a patient, one after another. */
  async syncAll(): Promise<SyncRun[]> {
    const runs: SyncRun[] = []
    for (const account of this.deps.labs.listAccounts().filter(hasPatient)) {
      runs.push(await this.syncAccount(account.id))
    }
    return runs
  }

  history(accountId: number): SyncRun[] {
    return this.runs(accountId, HISTORY_LIMIT)
  }

  currentProgress(): SyncProgress[] {
    return [...this.progress.values()]
  }

  /** Runs still marked as running were cut short when the app last quit. */
  recoverInterrupted(): void {
    this.deps.db
      .update(syncRun)
      .set({ status: 'error', finishedAt: new Date().toISOString(), error: INTERRUPTED })
      .where(eq(syncRun.status, 'running'))
      .run()
  }

  private async run(accountId: number): Promise<SyncRun> {
    const { db, labs, sessions, events } = this.deps
    const account = labs.getAccount(accountId)
    if (!hasPatient(account)) throw new UserError('Выберите, чьи анализы хранятся в этом кабинете')
    const { connector } = labs.connector(account.labId)

    const runId = db
      .insert(syncRun)
      .values({ labAccountId: accountId, status: 'running' })
      .returning({ id: syncRun.id })
      .get().id
    this.report({ accountId, stage: 'connecting', done: 0, total: 0 })
    dataChanged(events, 'sync')

    const stats = emptyStats()
    let status: SyncStatus
    let error: string | null = null
    try {
      status = await sessions.withPage(connector, account.sessionPartition, (page) =>
        this.importAccount(page, connector, account, stats),
      )
    } catch (failure) {
      if (failure instanceof LabHttpError && failure.sessionExpired) {
        status = 'login_required'
      } else {
        console.error(`Sync of lab account ${accountId} failed`, failure)
        status = 'error'
        error = failure instanceof Error ? failure.message : String(failure)
      }
    } finally {
      this.progress.delete(accountId)
      this.emitProgress()
    }

    const finishedAt = new Date().toISOString()
    const row = db
      .update(syncRun)
      .set({ finishedAt, status, stats: JSON.stringify(stats), error })
      .where(eq(syncRun.id, runId))
      .returning()
      .get()
    if (status === 'ok') labs.markSynced(accountId, finishedAt)
    dataChanged(events, 'sync', 'labs')
    if (!row) throw new Error(`Sync run ${runId} disappeared`)
    return toSyncRun(row)
  }

  private async importAccount(
    page: LabPage,
    connector: LabConnector,
    account: AccountWithPatient,
    stats: SyncStats,
  ): Promise<SyncStatus> {
    const { labs, importer } = this.deps
    if (await connector.detectBlock(page)) return 'blocked'
    const identity = await connector.detectAccount(page)
    if (!identity) return 'login_required'
    labs.recordIdentity(account.id, identity)

    this.report({ accountId: account.id, stage: 'listing', done: 0, total: 0 })
    const due = this.dueOrders(account.labId, await connector.listOrders(page))
    const target: ImportTarget = {
      labId: account.labId,
      labAccountId: account.id,
      patientId: account.defaultPatientId,
      connectorVersion: connector.version,
    }
    for (const [done, ref] of due.entries()) {
      this.report({ accountId: account.id, stage: 'orders', done, total: due.length })
      const report = await connector.fetchOrder(page, ref)
      const pdf = importer.needsForm(account.labId, report) ? await fetchForm(connector, page, ref) : null
      addStats(stats, importer.importOrders(target, [{ ...report, pdf }]))
    }
    return 'ok'
  }

  /** Orders never imported, and orders recent enough that the lab may still add results; newest first. */
  private dueOrders(labId: number, refs: readonly OrderRef[]): OrderRef[] {
    const imported = this.deps.importer.importedKeys(labId)
    const today = this.today()
    return refs
      .filter((ref) => !imported.has(ref.externalKey) || daysBetween(ref.collectedOn, today) <= RECHECK_DAYS)
      .sort((a, b) => b.collectedOn.localeCompare(a.collectedOn))
  }

  private async showLogin(account: LabAccountRow): Promise<boolean> {
    const { lab, connector } = this.deps.labs.connector(account.labId)
    const outcome = await this.deps.sessions.showLogin(
      connector,
      account.sessionPartition,
      `${lab.name}: вход в личный кабинет`,
      async (page) => (await connector.detectAccount(page)) !== null,
    )
    return outcome === 'logged-in'
  }

  private syncInBackground(accountId: number): void {
    this.syncAccount(accountId).catch((error: unknown) => console.error('Sync did not start', error))
  }

  private view(row: LabAccountRow): LabAccount {
    return {
      id: row.id,
      labId: row.labId,
      label: row.label,
      patientId: row.defaultPatientId,
      lastSyncAt: row.lastSyncAt,
      lastRun: this.runs(row.id, 1)[0] ?? null,
    }
  }

  private runs(accountId: number, limit: number): SyncRun[] {
    return this.deps.db
      .select()
      .from(syncRun)
      .where(eq(syncRun.labAccountId, accountId))
      .orderBy(desc(syncRun.id))
      .limit(limit)
      .all()
      .map(toSyncRun)
  }

  private report(progress: SyncProgress): void {
    this.progress.set(progress.accountId, progress)
    this.emitProgress()
  }

  private emitProgress(): void {
    this.deps.events.emit({ type: 'sync-progress', progress: this.currentProgress() })
  }
}
