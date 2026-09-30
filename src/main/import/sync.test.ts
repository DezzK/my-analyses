import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent, SyncProgress } from '@shared/api'
import { epochDay, isoFromEpochDay } from '@shared/domain/dates'
import { UserError } from '@shared/errors'
import { AttachmentStore } from '../attachments'
import type { Db } from '../db/client'
import { labAccount, labOrder, syncRun } from '../db/schema'
import type { LabSessions, LoginOutcome } from '../lab/browser'
import { FakeLabPage } from '../lab/fake-page'
import {
  LabHttpError,
  type LabAccountInfo,
  type LabConnector,
  type LabPage,
  type OrderRef,
  type RawResult,
} from '../lab/types'
import { AnalyteService } from '../services/analytes'
import { LabService } from '../services/labs'
import { PatientService } from '../services/patients'
import { UnitService } from '../services/units'
import { createTestDb, silentEvents } from '../test-support'
import { ImportService } from './importer'
import { RECHECK_DAYS, SyncService } from './sync'

const TODAY = '2026-09-30'

function daysAgo(days: number): string {
  return isoFromEpochDay((epochDay(TODAY) ?? 0) - days)
}

const GLUCOSE: RawResult = {
  labCode: '1.1.A1.1',
  labName: 'Глюкоза',
  value: '5.40',
  printed: '5.40 ммоль/л',
  reference: '3.9-5.5 ммоль/л',
  flag: 'normal',
}
const HEMOGLOBIN: RawResult = {
  labCode: '1.1.A1.2',
  labName: 'Гемоглобин',
  value: '130',
  printed: '130 г/л',
  reference: '120-140 г/л',
  flag: 'normal',
}

/** A lab whose account holds `orders`; it records which orders and forms were asked for. */
class FakeConnector implements LabConnector {
  readonly id = 'kdl'
  readonly version = 'test'
  readonly homeUrl = 'https://lab.example/account'
  readonly hosts = ['lab.example']
  readonly requestIntervalMs = 0
  blocked = false
  account: LabAccountInfo | null = { externalId: null, label: 'Иванова Анна' }
  readonly orders = new Map<string, { collectedOn: string; results: RawResult[] }>()
  failure: { externalKey: string; error: Error } | null = null
  fetched: string[] = []
  forms: string[] = []

  async detectBlock() {
    return this.blocked ? ('vpn_or_region' as const) : null
  }

  async detectAccount() {
    return this.account
  }

  async listOrders(): Promise<OrderRef[]> {
    return [...this.orders].map(([externalKey, { collectedOn }]) => ({
      externalKey,
      collectedOn,
      data: null,
    }))
  }

  async fetchOrder(_page: LabPage, ref: OrderRef) {
    this.fetched.push(ref.externalKey)
    if (this.failure?.externalKey === ref.externalKey) throw this.failure.error
    const order = this.orders.get(ref.externalKey)
    if (!order) throw new Error(`No order ${ref.externalKey}`)
    return { ...order, externalKey: ref.externalKey, rawPayload: JSON.stringify(order.results) }
  }

  async fetchOrderPdf(_page: LabPage, ref: OrderRef) {
    this.forms.push(ref.externalKey)
    return new TextEncoder().encode(
      `%PDF ${ref.externalKey} ${JSON.stringify(this.orders.get(ref.externalKey))}`,
    )
  }
}

/** The embedded browser, minus the browser; `hold` keeps syncs waiting until released. */
class FakeSessions implements LabSessions {
  loginOutcome: LoginOutcome = 'logged-in'
  readonly forgotten: string[] = []
  private readonly page = new FakeLabPage([])
  private gate: Promise<void> = Promise.resolve()

  hold(): () => void {
    let release = () => {}
    this.gate = new Promise((resolve) => (release = resolve))
    return release
  }

  async withPage<T>(_connector: LabConnector, _partition: string, task: (page: LabPage) => Promise<T>) {
    await this.gate
    return task(this.page)
  }

  async showLogin(
    _connector: LabConnector,
    _partition: string,
    _title: string,
    loggedIn: (page: LabPage) => Promise<boolean>,
  ): Promise<LoginOutcome> {
    return this.loginOutcome === 'logged-in' && (await loggedIn(this.page)) ? 'logged-in' : 'closed'
  }

  async forget(partition: string) {
    this.forgotten.push(partition)
  }
}

describe('SyncService', () => {
  let db: Db
  let events: ReturnType<typeof silentEvents>
  let connector: FakeConnector
  let sessions: FakeSessions
  let labs: LabService
  let sync: SyncService
  let kdlId: number
  let patientId: number

  beforeEach(() => {
    db = createTestDb()
    events = silentEvents()
    const units = new UnitService(db, events)
    units.ensureBuiltins()
    connector = new FakeConnector()
    labs = new LabService(db, events, (id) => (id === connector.id ? connector : null))
    labs.ensureBuiltins()
    patientId = new PatientService(db, events, () => TODAY).create({
      title: 'Анна',
      sex: 'female',
      birthDate: '1990-05-14',
      note: null,
    }).id
    const importer = new ImportService({
      db,
      units,
      analytes: new AnalyteService(db),
      attachments: new AttachmentStore(mkdtempSync(join(tmpdir(), 'attachments-'))),
      events,
    })
    sessions = new FakeSessions()
    sync = new SyncService({ db, labs, importer, sessions, events, today: () => TODAY })
    const kdl = labs.list().find((row) => row.connectable)
    if (!kdl) throw new Error('KDL has a connector')
    kdlId = kdl.id
  })

  function progressEvents(): SyncProgress[][] {
    return (events.emitted as AppEvent[]).flatMap((e) => (e.type === 'sync-progress' ? [e.progress] : []))
  }

  it('imports every order of a new account, newest first, with its form', async () => {
    connector.orders.set('old', { collectedOn: '2025-01-10', results: [GLUCOSE] })
    connector.orders.set('recent', { collectedOn: daysAgo(10), results: [GLUCOSE, HEMOGLOBIN] })
    const account = labs.createAccount(kdlId, patientId)

    const run = await sync.syncAccount(account.id)

    expect(run).toMatchObject({ status: 'ok', error: null, stats: { ordersAdded: 2, resultsAdded: 3 } })
    expect(connector.fetched).toEqual(['recent', 'old'])
    expect(connector.forms).toEqual(['recent', 'old'])
    const orders = db.select().from(labOrder).all()
    expect(orders.every((o) => o.pdfFile !== null && o.patientId === patientId)).toBe(true)
    expect(labs.getAccount(account.id)).toMatchObject({ label: 'Иванова Анна', lastSyncAt: run.finishedAt })
    expect(sync.accounts()).toEqual([expect.objectContaining({ id: account.id, lastRun: run })])
    expect(progressEvents().map((p) => p.map((item) => `${item.stage} ${item.done}/${item.total}`))).toEqual([
      ['connecting 0/0'],
      ['listing 0/0'],
      ['orders 0/2'],
      ['orders 1/2'],
      [],
    ])
  })

  it('fetches again only new orders and those the lab may still be completing', async () => {
    connector.orders.set('recent', { collectedOn: daysAgo(10), results: [GLUCOSE] })
    connector.orders.set('edge', { collectedOn: daysAgo(RECHECK_DAYS), results: [GLUCOSE] })
    connector.orders.set('past-edge', { collectedOn: daysAgo(RECHECK_DAYS + 1), results: [GLUCOSE] })
    const account = labs.createAccount(kdlId, patientId)
    await sync.syncAccount(account.id)

    connector.orders.set('new-but-old', { collectedOn: '2024-05-01', results: [GLUCOSE] })
    connector.fetched = []
    connector.forms = []
    const second = await sync.syncAccount(account.id)
    expect(connector.fetched).toEqual(['recent', 'edge', 'new-but-old'])
    expect(connector.forms).toEqual(['new-but-old'])
    expect(second.stats).toMatchObject({ ordersAdded: 1, ordersUnchanged: 2, ordersUpdated: 0 })

    // The lab added a result: the order is stored again, and so is its form.
    connector.orders.set('recent', { collectedOn: daysAgo(10), results: [GLUCOSE, HEMOGLOBIN] })
    connector.forms = []
    const third = await sync.syncAccount(account.id)
    expect(connector.forms).toEqual(['recent'])
    expect(third.stats).toMatchObject({ ordersUpdated: 1, resultsAdded: 1 })
  })

  it('reports a blocked site and a logged-out account without importing anything', async () => {
    connector.orders.set('recent', { collectedOn: daysAgo(1), results: [GLUCOSE] })
    const account = labs.createAccount(kdlId, patientId)

    connector.blocked = true
    expect(await sync.syncAccount(account.id)).toMatchObject({ status: 'blocked', error: null })
    connector.blocked = false
    connector.account = null
    expect(await sync.syncAccount(account.id)).toMatchObject({ status: 'login_required', error: null })

    expect(connector.fetched).toEqual([])
    expect(labs.getAccount(account.id).lastSyncAt).toBeNull()
  })

  it('keeps what was imported before a failure and records the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    connector.orders.set('recent', { collectedOn: daysAgo(1), results: [GLUCOSE] })
    connector.orders.set('old', { collectedOn: '2025-01-10', results: [GLUCOSE] })
    const account = labs.createAccount(kdlId, patientId)

    connector.failure = { externalKey: 'old', error: new LabHttpError(500, 'https://lab.example/old') }
    const failed = await sync.syncAccount(account.id)
    expect(failed).toMatchObject({
      status: 'error',
      error: 'HTTP 500 from https://lab.example/old',
      stats: { ordersAdded: 1 },
    })
    expect(db.select({ key: labOrder.externalKey }).from(labOrder).all()).toEqual([{ key: 'recent' }])
    expect(labs.getAccount(account.id).lastSyncAt).toBeNull()

    connector.failure = { externalKey: 'old', error: new LabHttpError(401, 'https://lab.example/old') }
    expect(await sync.syncAccount(account.id)).toMatchObject({ status: 'login_required', error: null })
  })

  it('runs one sync of an account at a time', async () => {
    const account = labs.createAccount(kdlId, patientId)
    const release = sessions.hold()
    const first = sync.syncAccount(account.id)
    expect(sync.syncAccount(account.id)).toBe(first)
    expect(sync.currentProgress()).toEqual([
      { accountId: account.id, stage: 'connecting', done: 0, total: 0 },
    ])
    release()
    await first
    expect(db.select().from(syncRun).all()).toHaveLength(1)
    expect(sync.currentProgress()).toEqual([])
  })

  it('disconnects an account only between syncs, forgetting its login but keeping its orders', async () => {
    connector.orders.set('recent', { collectedOn: daysAgo(1), results: [GLUCOSE] })
    const account = labs.createAccount(kdlId, patientId)
    const release = sessions.hold()
    const running = sync.syncAccount(account.id)
    await expect(sync.disconnect(account.id)).rejects.toBeInstanceOf(UserError)
    release()
    await running

    await sync.disconnect(account.id)
    expect(sessions.forgotten).toEqual([account.sessionPartition])
    expect(labs.listAccounts()).toEqual([])
    expect(db.select().from(labOrder).all()).toHaveLength(1)
  })

  it('keeps a connected account only once someone has logged in, then syncs it', async () => {
    sessions.loginOutcome = 'closed'
    expect(await sync.connect(kdlId, patientId)).toBeNull()
    expect(labs.listAccounts()).toEqual([])
    expect(sessions.forgotten).toHaveLength(1)

    sessions.loginOutcome = 'logged-in'
    connector.orders.set('recent', { collectedOn: daysAgo(1), results: [GLUCOSE] })
    const release = sessions.hold()
    const account = await sync.connect(kdlId, patientId)
    if (!account) throw new Error('The account is connected')
    expect(account.patientId).toBe(patientId)
    const firstSync = sync.syncAccount(account.id)
    release()
    expect(await firstSync).toMatchObject({ status: 'ok', stats: { ordersAdded: 1 } })
    expect(db.select().from(syncRun).all()).toHaveLength(1)
  })

  it('syncs every account that has a patient', async () => {
    const withPatient = labs.createAccount(kdlId, patientId)
    const orphan = labs.createAccount(kdlId, patientId)
    db.update(labAccount).set({ defaultPatientId: null }).where(eq(labAccount.id, orphan.id)).run()

    const runs = await sync.syncAll()
    expect(runs.map((run) => run.accountId)).toEqual([withPatient.id])
    await expect(sync.syncAccount(orphan.id)).rejects.toBeInstanceOf(UserError)
  })

  it('marks runs cut short by quitting the app as interrupted', () => {
    const account = labs.createAccount(kdlId, patientId)
    db.insert(syncRun).values({ labAccountId: account.id, status: 'running' }).run()
    sync.recoverInterrupted()
    expect(sync.history(account.id)).toEqual([
      expect.objectContaining({ status: 'error', finishedAt: expect.any(String), error: expect.any(String) }),
    ])
  })
})
