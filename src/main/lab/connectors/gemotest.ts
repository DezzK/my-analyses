import { isoFromLabDate } from '@shared/domain/dates'
import type { LabFlag } from '@shared/domain/enums'
import { foldCase } from '@shared/domain/text'
import { detectVpnBlock, isPdf } from '../pages'
import { collectPages } from '../paging'
import { tokenUsable, unixSeconds } from '../time'
import {
  fetchBytesOk,
  fetchOk,
  HTTP_NOT_FOUND,
  isErrorStatus,
  LabHttpError,
  type FetchedText,
  type LabConnector,
  type LabPage,
  type LabPerson,
  type OrderRef,
  type RawResult,
} from '../types'

/**
 * Gemotest (gemotest.ru). The account is an app on gemotest.ru/my whose API lives on
 * api2.gemotest.ru and trusts nothing but a bearer token: the app keeps it in localStorage with the
 * refresh token and the device both were issued to. A token lives 20 minutes, so a sync refreshes
 * it as the app would and leaves the new pair where the app looks for it; syncs run on a quiet
 * page of the site, so the app never refreshes alongside. The list names each order's patient,
 * the holder or someone they ordered for, but gives them no id: a person is known by name and
 * birth date, which only an order's details carry. An order's results come service by service, and
 * a value ends with « +» or « -» when it is out of range. Its form is a PDF the site asks for by
 * posting a form, the token among its fields.
 */

const SITE = 'https://gemotest.ru'
const API = 'https://api2.gemotest.ru'

/** Where the app keeps its session in localStorage; the expiry is a Unix time. */
const ACCESS_TOKEN = 'lk_access_token'
const REFRESH_TOKEN = 'lk_refresh_token'
const EXPIRES_AT = 'lk_expires_in'
const DEVICE_ID = 'lk_device_id'
const SESSION_KEYS = [ACCESS_TOKEN, REFRESH_TOKEN, EXPIRES_AT, DEVICE_ID] as const

const ORDERS_PER_PAGE = 50
/** A service whose results are out; one still in the works may have none to show. */
const SERVICE_DONE = 'Выполнен'

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
  last_name?: string | null
  first_name?: string | null
  middle_name?: string | null
}

/** An order's details, as far as they name its patient. */
interface GemotestOrderDetails {
  order?: {
    patient?: {
      birthdate?: string | null
      /** 0 when the account's holder ordered for someone else. */
      is_applicant?: number | null
    } | null
  } | null
}

interface GemotestKey {
  orderNumber: string
  /** The account's holder ordered it for someone else, which the form request has to say. */
  representative: boolean
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

/** When the stored access token runs out, a Unix time. */
function expiresAt(session: Session): number {
  return Number(session[EXPIRES_AT])
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
  if (stored && tokenUsable(expiresAt(session))) return stored
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

/** The session's token for a request to `url`; a page without a session is refused as the API would. */
async function tokenFor(page: LabPage, url: string): Promise<string> {
  const token = await accessToken(page)
  if (!token) throw LabHttpError.sessionEnded(url)
  return token
}

/** A request to the API with the session's token; the page's cookies would make it refuse. */
async function api(page: LabPage, path: string): Promise<FetchedText> {
  const url = `${API}/${path}`
  return fetchOk(page, url, {
    headers: { Authorization: `Bearer ${await tokenFor(page, url)}`, Accept: 'application/json' },
    credentials: 'omit',
  })
}

function orderPath(orderNumber: string): string {
  return `customer/v3/order/${encodeURIComponent(orderNumber)}`
}

function nameOf(order: GemotestOrder): string {
  return [order.last_name, order.first_name, order.middle_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * The people the orders are of, by name: each one's birth date, and whether the holder ordered for
 * them, come from one of their orders.
 */
async function peopleOf(
  page: LabPage,
  orders: readonly GemotestOrder[],
): Promise<Map<string, { person: LabPerson; representative: boolean }>> {
  const people = new Map<string, { person: LabPerson; representative: boolean }>()
  for (const order of orders) {
    const name = nameOf(order)
    if (!name || people.has(name)) continue
    const details = JSON.parse(
      (await api(page, orderPath(String(order.order_num)))).text,
    ) as GemotestOrderDetails
    const patient = details.order?.patient
    const birthDate = patient?.birthdate ? isoFromLabDate(patient.birthdate) : null
    people.set(name, {
      person: { key: `${foldCase(name)}|${birthDate ?? ''}`, name, birthDate },
      representative: patient?.is_applicant === 0,
    })
  }
  return people
}

function keyOf(ref: OrderRef): GemotestKey {
  const data = ref.data as Partial<GemotestKey> | null
  if (typeof data?.orderNumber !== 'string')
    throw new Error(`Not a Gemotest order reference: ${ref.externalKey}`)
  return { orderNumber: data.orderNumber, representative: data.representative === true }
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
  // 2: the forms, which version 1 did not fetch.
  version: '2',
  homeUrl: `${SITE}/my/`,
  syncUrl: `${SITE}/robots.txt`,
  hosts: ['gemotest.ru'],
  requestIntervalMs: 400,

  detectBlock: detectVpnBlock,

  async detectLogin(page) {
    const session = await page.readStorage(SESSION_KEYS)
    // A session the app has given up on keeps its tokens until someone logs in again.
    return Boolean(session[ACCESS_TOKEN]) && expiresAt(session) > unixSeconds()
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

  async listOrders(page) {
    const orders = await collectPages(
      ORDERS_PER_PAGE,
      async (index) => {
        const response = await api(
          page,
          `customer/v2/orders_actual?limit=${ORDERS_PER_PAGE}&offset=${index * ORDERS_PER_PAGE}`,
        )
        const body = JSON.parse(response.text) as { result?: { orders?: GemotestOrder[] } | null }
        return body.result?.orders ?? []
      },
      (order) => String(order.order_num),
    )
    const people = await peopleOf(page, orders)
    return orders.flatMap((order) => {
      const orderNumber = String(order.order_num)
      const collectedOn = isoFromLabDate(order.date)
      const known = people.get(nameOf(order))
      if (!collectedOn) return []
      const data: GemotestKey = { orderNumber, representative: known?.representative ?? false }
      return [{ externalKey: orderNumber, collectedOn, ...(known ? { person: known.person } : {}), data }]
    })
  },

  async fetchOrder(page, ref) {
    const { orderNumber } = keyOf(ref)
    const order = await api(page, orderPath(orderNumber))
    const { services = [] } = JSON.parse(order.text) as { services?: GemotestService[] }
    const results: RawResult[] = []
    const reports: string[] = []
    for (const service of services) {
      let report: FetchedText
      try {
        report = await api(page, `${orderPath(orderNumber)}/service/${service.id}`)
      } catch (error) {
        if (LabHttpError.isStatus(error, HTTP_NOT_FOUND) && service.status !== SERVICE_DONE) continue
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

  async fetchOrderForms(page, ref) {
    const { orderNumber, representative } = keyOf(ref)
    const url = `${API}/customer/v2/result_pdf`
    const fields = new URLSearchParams({
      authorization_token: await tokenFor(page, url),
      order_id: orderNumber,
      is_customer_representative: representative ? '1' : '0',
      dynamic: '0',
      as_file: '1',
    })
    const { bytes } = await fetchBytesOk(page, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields.toString(),
      credentials: 'omit',
    })
    return isPdf(bytes) ? [bytes] : []
  },
}
