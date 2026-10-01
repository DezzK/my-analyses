import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent, SyncProgress } from '@shared/api'
import { epochDay, isoFromEpochDay } from '@shared/domain/dates'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { labAccount, labOrder, syncRun } from '../db/schema'
import type { LabSessions, LoginOutcome } from '../lab/browser'
import { FakeLabPage } from '../lab/fake-page'
import {
  LabHttpError,
  type LabAccountInfo,
  type LabConnector,
  type LabPage,
  type LabPerson,
  type OrderRef,
  type RawResult,
} from '../lab/types'
import type { LabService } from '../services/labs'
import type { PatientService } from '../services/patients'
import type { OrderForms } from '../services/order-forms'
import { createTestServices, TEST_TODAY } from '../test-support'
import { emptyStats } from './importer'
import { RECHECK_DAYS, SyncService } from './sync'

function daysAgo(days: number): string {
  return isoFromEpochDay((epochDay(TEST_TODAY) ?? 0) - days)
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
  readonly orders = new Map<string, { collectedOn: string; results: RawResult[]; person?: LabPerson }>()
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
    return [...this.orders].map(([externalKey, { collectedOn, person }]) => ({
      externalKey,
      collectedOn,
      data: null,
      ...(person ? { person } : {}),
    }))
  }

  async fetchOrder(_page: LabPage, ref: OrderRef) {
    this.fetched.push(ref.externalKey)
    if (this.failure?.externalKey === ref.externalKey) throw this.failure.error
    const order = this.orders.get(ref.externalKey)
    if (!order) throw new Error(`No order ${ref.externalKey}`)
    const { collectedOn, results } = order
    return { collectedOn, results, externalKey: ref.externalKey, rawPayload: JSON.stringify(results) }
  }

  async fetchOrderForms(_page: LabPage, ref: OrderRef) {
    this.forms.push(ref.externalKey)
    return [
      new TextEncoder().encode(`%PDF ${ref.externalKey} ${JSON.stringify(this.orders.get(ref.externalKey))}`),
    ]
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
  let events: ReturnType<typeof createTestServices>['events']
  let connector: FakeConnector
  let sessions: FakeSessions
  let labs: LabService
  let patients: PatientService
  let forms: OrderForms
  let sync: SyncService
  let kdlId: number
  let patientId: number

  beforeEach(() => {
    connector = new FakeConnector()
    const app = createTestServices({ connectors: (id) => (id === connector.id ? connector : null) })
    ;({ db, events, labs, patients, forms, kdlId } = app)
    patientId = app.anna.id
    sessions = new FakeSessions()
    sync = new SyncService({
      db,
      labs,
      people: app.people,
      importer: app.importer,
      sessions,
      events,
      today: () => TEST_TODAY,
    })
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
    expect(orders.every((o) => forms.of(o.id).length === 1 && o.patientId === patientId)).toBe(true)
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

  describe('with a lab that names whose each order is', () => {
    /** A made-up son whose orders sit in his mother's account. */
    const SON: LabPerson = { key: 'profile-2', name: 'Иванов Пётр Сергеевич', birthDate: '2015-03-01' }
    let peter: number
    let accountId: number

    beforeEach(() => {
      peter = patients.create({ title: 'Пётр', sex: 'male', birthDate: SON.birthDate ?? '', note: null }).id
      connector.orders.set('mine', { collectedOn: daysAgo(3), results: [GLUCOSE] })
      connector.orders.set('his-new', { collectedOn: daysAgo(5), results: [GLUCOSE], person: SON })
      connector.orders.set('his-old', { collectedOn: '2025-01-10', results: [HEMOGLOBIN], person: SON })
      accountId = labs.createAccount(kdlId, patientId).id
    })

    function son() {
      const person = sync.accounts()[0]?.people[0]
      if (!person) throw new Error('The son is not recorded')
      return person
    }

    function stored() {
      return db
        .select({ key: labOrder.externalKey, patientId: labOrder.patientId, personId: labOrder.labPersonId })
        .from(labOrder)
        .all()
    }

    it("waits with a person's orders until someone says whose they are, then brings them", async () => {
      const first = await sync.syncAccount(accountId)
      expect(first.stats).toMatchObject({ ordersAdded: 1, ordersWaiting: 2 })
      expect(connector.fetched).toEqual(['mine'])
      expect(son()).toMatchObject({
        name: SON.name,
        orderCount: 2,
        patientId: null,
        suggestedPatientId: peter,
      })

      sync.assignPerson(son().id, peter)
      // The choice starts a sync at once; this joins it.
      expect(sync.currentProgress()).toEqual([expect.objectContaining({ accountId, stage: 'connecting' })])
      const second = await sync.syncAccount(accountId)
      expect(second.stats).toMatchObject({ ordersAdded: 2, ordersUnchanged: 1, ordersWaiting: 0 })
      expect(stored()).toEqual([
        { key: 'mine', patientId, personId: null },
        { key: 'his-new', patientId: peter, personId: son().id },
        { key: 'his-old', patientId: peter, personId: son().id },
      ])
    })

    it('leaves out the orders of a person kept out, without fetching them', async () => {
      await sync.syncAccount(accountId)
      sync.assignPerson(son().id, null)
      expect(sync.currentProgress()).toEqual([])
      connector.fetched = []
      const run = await sync.syncAccount(accountId)
      expect(connector.fetched).toEqual(['mine'])
      expect(run.stats).toMatchObject({ ordersWaiting: 0 })
      expect(stored()).toEqual([{ key: 'mine', patientId, personId: null }])
    })
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

  it('reads a run kept before a counter existed as not having counted it', () => {
    const account = labs.createAccount(kdlId, patientId)
    const { ordersWaiting: _uncounted, ...before } = { ...emptyStats(), ordersAdded: 3 }
    db.insert(syncRun)
      .values({ labAccountId: account.id, status: 'ok', stats: JSON.stringify(before) })
      .run()
    expect(sync.history(account.id)[0]?.stats).toEqual({ ...emptyStats(), ordersAdded: 3 })
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
