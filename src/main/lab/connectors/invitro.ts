import { isoFromLabDate } from '@shared/domain/dates'
import type { LabFlag } from '@shared/domain/enums'
import { detectVpnBlock, isPdf } from '../pages'
import { moscowDate, tokenUsable, unixSeconds } from '../time'
import {
  fetchBytesOk,
  fetchOk,
  HTTP_BAD_REQUEST,
  HTTP_UNAUTHORIZED,
  LabHttpError,
  type FetchedText,
  type FetchInit,
  type LabConnector,
  type LabPage,
  type LabPerson,
  type OrderRef,
  type RawResult,
} from '../types'

/**
 * Invitro (invitro.ru). The account is an app on www.invitro.ru/profile with a JSON API under
 * /golk on the same origin. The app keeps a refresh token and a fingerprint in localStorage and
 * the access token, which lives five minutes, in memory only; every refresh hands out a new pair
 * and voids the old one. So a sync runs on a quiet page of the site, where no app refreshes
 * behind the connector's back, and stores each new pair where the app will look for it. An
 * account holds its patients' orders, the holder's own and their family's: every patient's are
 * listed, each order under its patient. The lab marks a result out of range with «*»,
 * and sends values as JSON numbers: a trailing zero the form prints is gone before it arrives.
 */

const ORIGIN = 'https://www.invitro.ru'
const API = `${ORIGIN}/golk`

/** Where the app keeps its session in localStorage. */
const REFRESH_TOKEN = 'refreshToken'
const FINGERPRINT = 'fingerprint'
/** How Invitro refuses a pair it no longer honors; the app logs out on either. */
const SESSION_OVER_STATUSES: readonly number[] = [HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED]

/** A reference that sends the reader to the comments, which spell out the ranges. */
const SEE_COMMENTS = /^см\.?\s*комм/i
const OUT_OF_RANGE_MARK = '*'

interface InvitroTokens {
  access_token: string
  refresh_token: string
  fingerprint: string
  /** How many seconds the access token lives. */
  access_expires_in: number
}

interface InvitroPatient {
  id: string
  first_name?: string | null
  last_name?: string | null
  /** «1990-05-14». */
  birthday?: string | null
  /** The account holder. */
  main?: boolean
}

interface InvitroOrder {
  number: string | number
  /** An ISO moment in UTC. */
  created_at: string
  multiple_inz?: (string | number)[] | null
}

interface InvitroKey {
  patientId: string
  inzs: string[]
}

interface InvitroTest {
  requisition_id?: string | number
  test_method_code?: string | null
  analysis_name?: string | null
  value?: number | string | null
  unit?: string | null
  ref_min?: number | null
  ref_max?: number | null
  ref_text?: string | null
  ref_mark?: string | null
  anacomments?: { type?: string; text?: string | null }[] | null
}

/** Access tokens by the page of the sync that got them: they live in memory, as in the app. */
const accessTokens = new WeakMap<LabPage, { token: string; expiresAt: number }>()

/**
 * A token for the API: the one this sync already holds while it lasts, else a new one. Null when
 * the page holds no session or Invitro refuses it; the refused pair is then removed, as the app
 * removes it, so the login window waits for the person instead of taking it for a session.
 */
async function accessToken(page: LabPage): Promise<string | null> {
  const held = accessTokens.get(page)
  if (held && tokenUsable(held.expiresAt)) return held.token
  const session = await page.readStorage([REFRESH_TOKEN, FINGERPRINT])
  const refreshToken = session[REFRESH_TOKEN]
  const fingerprint = session[FINGERPRINT]
  if (!refreshToken || !fingerprint) return null
  let response: FetchedText
  try {
    response = await fetchOk(page, apiUrl('auth/api/v1/auth/token/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken, fingerprint }),
    })
  } catch (error) {
    if (!SESSION_OVER_STATUSES.some((status) => LabHttpError.isStatus(error, status))) throw error
    await page.writeStorage({ [REFRESH_TOKEN]: null, [FINGERPRINT]: null })
    return null
  }
  const tokens = JSON.parse(response.text) as InvitroTokens
  await page.writeStorage({ [REFRESH_TOKEN]: tokens.refresh_token, [FINGERPRINT]: tokens.fingerprint })
  accessTokens.set(page, { token: tokens.access_token, expiresAt: unixSeconds() + tokens.access_expires_in })
  return tokens.access_token
}

/** `init` with the session's token; a page without a session is refused as the API would refuse it. */
async function authorized(page: LabPage, url: string, init: FetchInit = {}): Promise<FetchInit> {
  const token = await accessToken(page)
  if (!token) throw LabHttpError.sessionEnded(url)
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } }
}

function apiUrl(path: string): string {
  return `${API}/${path}`
}

async function api(page: LabPage, path: string, init: FetchInit = {}): Promise<FetchedText> {
  const url = apiUrl(path)
  return fetchOk(page, url, await authorized(page, url, init))
}

/** The account's patients: its holder and the family whose orders they keep there. */
async function accountPatients(page: LabPage): Promise<InvitroPatient[]> {
  const { patients = [] } = JSON.parse((await api(page, 'users/api/v1/patients')).text) as {
    patients?: InvitroPatient[]
  }
  return patients
}

function nameOf(patient: InvitroPatient): string {
  return [patient.last_name, patient.first_name].filter(Boolean).join(' ')
}

function personOf(patient: InvitroPatient): LabPerson {
  return {
    key: patient.id,
    name: nameOf(patient) || patient.id,
    birthDate: patient.birthday ? isoFromLabDate(patient.birthday) : null,
  }
}

function keyOf(ref: OrderRef): InvitroKey {
  const data = ref.data as Partial<InvitroKey> | null
  if (typeof data?.patientId !== 'string' || !Array.isArray(data.inzs)) {
    throw new Error(`Not an Invitro order reference: ${ref.externalKey}`)
  }
  return data as InvitroKey
}

function resultsPath(patientId: string, what: string): string {
  return `results/api/legacy/patient/${encodeURIComponent(patientId)}/${what}`
}

/**
 * The reference as the form prints it. For «СМ.КОММ.», the ranges the comments spell out; without
 * a text, the bounds, unless both are the zeros Invitro sends for a result with no range at all.
 */
function referenceOf(test: InvitroTest): string | null {
  const text = test.ref_text?.trim() || null
  if (text && !SEE_COMMENTS.test(text)) return text
  if (text) {
    const comments = (test.anacomments ?? []).map((c) => c.text?.replace(/\s+/g, ' ').trim()).filter(Boolean)
    return comments.length > 0 ? comments.join('; ') : text
  }
  const { ref_min: low, ref_max: high } = test
  if (typeof low !== 'number' || typeof high !== 'number' || low === high) return null
  return `${low} - ${high}`
}

function flagOf(test: InvitroTest, reference: string | null): LabFlag | null {
  if (test.ref_mark?.trim() === OUT_OF_RANGE_MARK) return 'abnormal'
  return reference === null ? null : 'normal'
}

/**
 * The order's results, each under its test's code. The code is unique within a requisition; one
 * that repeats across an order's requisitions is told apart by the requisition, since the importer
 * keeps one result per code.
 */
function toRawResults(tests: readonly InvitroTest[]): RawResult[] {
  const coded = tests.flatMap((test) => {
    const code = test.test_method_code?.trim()
    return code ? [{ test, code }] : []
  })
  const counts = new Map<string, number>()
  for (const { code } of coded) counts.set(code, (counts.get(code) ?? 0) + 1)
  return coded.map(({ test, code }) => {
    const value = test.value === null || test.value === undefined ? '' : String(test.value).trim()
    const reference = referenceOf(test)
    return {
      labCode: (counts.get(code) ?? 0) > 1 ? `${code} ${test.requisition_id}` : code,
      labName: test.analysis_name?.trim() || code,
      value: value || null,
      printed: [value, test.unit?.trim()].filter(Boolean).join(' '),
      reference,
      flag: flagOf(test, reference),
    }
  })
}

export const invitroConnector: LabConnector = {
  id: 'invitro',
  version: '1',
  homeUrl: `${ORIGIN}/profile/`,
  syncUrl: `${ORIGIN}/robots.txt`,
  hosts: ['invitro.ru'],
  requestIntervalMs: 400,

  detectBlock: detectVpnBlock,

  async detectLogin(page) {
    const session = await page.readStorage([REFRESH_TOKEN, FINGERPRINT])
    return Boolean(session[REFRESH_TOKEN] && session[FINGERPRINT])
  },

  async detectAccount(page) {
    if (!(await accessToken(page))) return null
    const patients = await accountPatients(page)
    const holder = patients.find((p) => p.main) ?? patients[0]
    if (!holder) throw new Error('Invitro lists no patients in this account')
    return { externalId: holder.id, label: nameOf(holder) || null }
  },

  async listOrders(page) {
    const refs: OrderRef[] = []
    for (const patient of await accountPatients(page)) {
      const response = await api(page, `history/api/v2/orders?patient_id=${encodeURIComponent(patient.id)}`)
      const groups = JSON.parse(response.text) as { orders?: InvitroOrder[] }[]
      const person = personOf(patient)
      for (const order of groups.flatMap((group) => group.orders ?? [])) {
        const inzs = (order.multiple_inz ?? []).map(String)
        if (inzs.length === 0) continue
        refs.push({
          externalKey: String(order.number),
          // Invitro writes the moment of the order in UTC; the sample was taken on its Moscow date.
          collectedOn: moscowDate(unixSeconds(Date.parse(order.created_at))),
          person,
          data: { patientId: patient.id, inzs } satisfies InvitroKey,
        })
      }
    }
    return refs
  },

  async fetchOrder(page, ref) {
    const { patientId, inzs } = keyOf(ref)
    const response = await api(page, resultsPath(patientId, 'bulk'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inzs }),
    })
    // One document for all the order's requisitions; `tests` holds every one of their tests.
    const { tests = [] } = JSON.parse(response.text) as { tests?: InvitroTest[] }
    return {
      externalKey: ref.externalKey,
      collectedOn: ref.collectedOn,
      results: toRawResults(tests),
      rawPayload: response.text,
    }
  },

  async fetchOrderForms(page, ref) {
    const { patientId, inzs } = keyOf(ref)
    const forms: Uint8Array[] = []
    // One form per requisition, as the site's own download gives it.
    for (const inz of inzs) {
      const url = apiUrl(resultsPath(patientId, `${encodeURIComponent(inz)}/file?source=`))
      const { bytes } = await fetchBytesOk(page, url, await authorized(page, url))
      if (isPdf(bytes)) forms.push(bytes)
    }
    return forms
  },
}
