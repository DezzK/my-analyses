import type { LabFlag } from '@shared/domain/enums'
import { detectVpnBlock } from '../pages'
import { collectPages } from '../paging'
import { unixSeconds } from '../time'
import {
  fetchOk,
  isErrorStatus,
  LabHttpError,
  type FetchedText,
  type LabConnector,
  type LabPage,
  type OrderRef,
  type RawResult,
} from '../types'

/**
 * Gemotest (gemotest.ru). The account is an app on gemotest.ru/my whose API lives on
 * api2.gemotest.ru and trusts nothing but a bearer token: the app keeps it in localStorage with the
 * refresh token and the device both were issued to. A token lives 20 minutes, so a sync refreshes
 * it as the app would and leaves the new pair where the app looks for it; syncs run on a quiet
 * page of the site, so the app never refreshes alongside. An order's results come service by
 * service, and a value ends with « +» or « -» when it is out of range.
 */

const SITE = 'https://gemotest.ru'
const API = 'https://api2.gemotest.ru'

/** Where the app keeps its session in localStorage; the expiry is a Unix time. */
const ACCESS_TOKEN = 'lk_access_token'
const REFRESH_TOKEN = 'lk_refresh_token'
const EXPIRES_AT = 'lk_expires_in'
const DEVICE_ID = 'lk_device_id'
const SESSION_KEYS = [ACCESS_TOKEN, REFRESH_TOKEN, EXPIRES_AT, DEVICE_ID] as const
/** A token about to run out is refreshed before use, so it cannot expire halfway through a sync. */
const TOKEN_MARGIN_SECONDS = 60

const ORDERS_PER_PAGE = 50
/** A service whose results are out; one still in the works may have none to show. */
const SERVICE_DONE = 'Выполнен'
const NOT_FOUND_STATUS = 404

/** A reference that sends the reader to the comments, which spell out the ranges. */
const SEE_COMMENTS = /^смотри текст$/i
/** The mark a value ends with when it is out of range. */
const OUT_OF_RANGE_MARK = /\s+([+-])$/
const MARK_FLAGS: Readonly<Record<string, LabFlag>> = { '+': 'high', '-': 'low' }
/** The unit Gemotest prints for a result that has none. */
const NO_UNIT = '-'

type Session = Record<(typeof SESSION_KEYS)[number], string | null>

interface GemotestTokens {
  access_token: string
  refresh_token: string
  /** How many seconds the access token lives. */
  expires_in: number
}

interface GemotestProfile {
  patient_id?: string | number | null
  last_name?: string | null
  first_name?: string | null
}

interface GemotestOrder {
  order_num: string | number
  /** «2026-07-15 09:41:12.000», Moscow time. */
  date: string
}

interface GemotestService {
  /** Escaped for a URL path already: escaping it again names a service that does not exist. */
  id: string
  code?: string | null
  status?: string | null
}

interface GemotestTest {
  id?: string | null
  title?: string | null
  value?: string | null
  unit?: string | null
  is_normal?: boolean | null
  reference_range?: { text?: string | null } | null
  comment?: string[] | null
}

/** How long the stored access token has left to live, in seconds. */
function secondsLeft(session: Session): number {
  return Number(session[EXPIRES_AT]) - unixSeconds()
}

/**
 * A token for the API: the one the app stored, or a fresh pair once it is about to run out. Null
 * when the page holds no session or Gemotest no longer honors it; a refresh token it has revoked is
 * answered with 500, not 401, so any refusal of a refresh ends the session.
 */
async function accessToken(page: LabPage): Promise<string | null> {
  const session = await page.readStorage(SESSION_KEYS)
  const refreshToken = session[REFRESH_TOKEN]
  if (!refreshToken) return null
  const stored = session[ACCESS_TOKEN]
  if (stored && secondsLeft(session) > TOKEN_MARGIN_SECONDS) return stored
  const device = session[DEVICE_ID]
  const response = await page.fetchText(`${API}/lk/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(device ? { 'X-Device-Id': device } : {}) },
    body: JSON.stringify({ refresh_token: refreshToken }),
    credentials: 'omit',
  })
  if (isErrorStatus(response.status)) return null
  const tokens = JSON.parse(response.text) as GemotestTokens
  await page.writeStorage({
    [ACCESS_TOKEN]: tokens.access_token,
    [REFRESH_TOKEN]: tokens.refresh_token,
    [EXPIRES_AT]: String(unixSeconds() + tokens.expires_in),
  })
  return tokens.access_token
}

/** A request to the API with the session's token; the page's cookies would make it refuse. */
async function api(page: LabPage, path: string): Promise<FetchedText> {
  const url = `${API}/${path}`
  const token = await accessToken(page)
  if (!token) throw LabHttpError.sessionEnded(url)
  return fetchOk(page, url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    credentials: 'omit',
  })
}

function orderNumberOf(ref: OrderRef): string {
  const data = ref.data as { orderNumber?: unknown } | null
  if (typeof data?.orderNumber !== 'string')
    throw new Error(`Not a Gemotest order reference: ${ref.externalKey}`)
  return data.orderNumber
}

/** The reference as the form prints it; for «Смотри текст», the ranges the comments spell out. */
function referenceOf(test: GemotestTest): string | null {
  const text = test.reference_range?.text?.trim() || null
  if (text && !SEE_COMMENTS.test(text)) return text
  const comments = (test.comment ?? []).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return comments.length > 0 ? comments.join('; ') : text
}

function flagOf(mark: string | undefined, isNormal: boolean | null | undefined): LabFlag | null {
  if (mark) return MARK_FLAGS[mark] ?? null
  if (isNormal === true) return 'normal'
  return isNormal === false ? 'abnormal' : null
}

/** A service's results, each known by the service's code and its own: a code alone may repeat in an order. */
function toRawResults(service: GemotestService, tests: readonly GemotestTest[]): RawResult[] {
  const serviceCode = service.code?.trim() || service.id
  return tests.flatMap((test) => {
    const id = test.id?.trim()
    if (!id) return []
    const value = test.value?.trim() ?? ''
    const mark = OUT_OF_RANGE_MARK.exec(value)
    const text = mark ? value.slice(0, mark.index) : value
    const unit = test.unit?.trim()
    return [
      {
        labCode: `${serviceCode} ${id}`,
        labName: test.title?.trim() || id,
        value: text || null,
        printed: [text, unit === NO_UNIT ? null : unit].filter(Boolean).join(' '),
        reference: referenceOf(test),
        flag: flagOf(mark?.[1], test.is_normal),
      },
    ]
  })
}

export const gemotestConnector: LabConnector = {
  id: 'gemotest',
  version: '1',
  homeUrl: `${SITE}/my/`,
  syncUrl: `${SITE}/robots.txt`,
  hosts: ['gemotest.ru'],
  requestIntervalMs: 400,

  detectBlock: detectVpnBlock,

  async detectLogin(page) {
    const session = await page.readStorage(SESSION_KEYS)
    // A session the app has given up on keeps its tokens until someone logs in again.
    return Boolean(session[ACCESS_TOKEN]) && secondsLeft(session) > 0
  },

  async detectAccount(page) {
    if (!(await accessToken(page))) return null
    const profile = JSON.parse((await api(page, 'lk/v1/profile/me')).text) as GemotestProfile
    const label = [profile.last_name, profile.first_name].filter(Boolean).join(' ')
    const patientId = profile.patient_id
    return {
      externalId: patientId === null || patientId === undefined ? null : String(patientId),
      label: label || null,
    }
  },

  listOrders(page) {
    return collectPages(
      ORDERS_PER_PAGE,
      async (index) => {
        const response = await api(
          page,
          `customer/v2/orders_actual?limit=${ORDERS_PER_PAGE}&offset=${index * ORDERS_PER_PAGE}`,
        )
        const body = JSON.parse(response.text) as { result?: { orders?: GemotestOrder[] } | null }
        return (body.result?.orders ?? []).map((order) => {
          const orderNumber = String(order.order_num)
          return { externalKey: orderNumber, collectedOn: order.date.slice(0, 10), data: { orderNumber } }
        })
      },
      (ref) => ref.externalKey,
    )
  },

  async fetchOrder(page, ref) {
    const orderNumber = orderNumberOf(ref)
    const order = await api(page, `customer/v3/order/${encodeURIComponent(orderNumber)}`)
    const { services = [] } = JSON.parse(order.text) as { services?: GemotestService[] }
    const results: RawResult[] = []
    const reports: string[] = []
    for (const service of services) {
      let report: FetchedText
      try {
        report = await api(page, `customer/v3/order/${encodeURIComponent(orderNumber)}/service/${service.id}`)
      } catch (error) {
        if (LabHttpError.isStatus(error, NOT_FOUND_STATUS) && service.status !== SERVICE_DONE) continue
        throw error
      }
      reports.push(report.text)
      const { tests = [] } = JSON.parse(report.text) as { tests?: GemotestTest[] }
      results.push(...toRawResults(service, tests))
    }
    return {
      externalKey: ref.externalKey,
      collectedOn: ref.collectedOn,
      results,
      // Each response exactly as it came, gathered into one document.
      rawPayload: `{"order":${order.text},"services":[${reports.join(',')}]}`,
    }
  },
}
