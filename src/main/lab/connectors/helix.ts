import { isoFromLabDate } from '@shared/domain/dates'
import { detectVpnBlock, isPdf } from '../pages'
import { moscowDate, unixSeconds } from '../time'
import {
  fetchBytesOk,
  fetchOk,
  HTTP_FORBIDDEN,
  LabHttpError,
  type LabConnector,
  type LabPage,
  type LabPerson,
  type OrderRef,
  type RawResult,
} from '../types'

/**
 * Helix (helix.ru). The account is an app on my.helix.ru with a JSON API on the same origin and a
 * cookie session. An account may hold several people's profiles, each with orders of its own: all
 * of them are listed, each order under its profile's person. A panel's components (a blood count) have no codes of their own, so each is
 * known by its test's code and its own name; the forms come one per sample.
 */

const ORIGIN = 'https://my.helix.ru'
const JSON_HEADERS = { headers: { Accept: 'application/json' } }
/** How Helix answers a request that carries no session. */
const NO_SESSION_STATUS = HTTP_FORBIDDEN

interface HelixProfile {
  id: string
  lastName?: string | null
  firstName?: string | null
  middleName?: string | null
  /** «1990-05-14T00:00:00». */
  birthDate?: string | null
}

interface HelixOrder {
  code: string
  createdOn: string
  canShowDetails?: boolean
}

interface HelixKey {
  code: string
  profileId: string
}

interface HelixValue {
  name?: string
  formattedEntry?: string | null
  numericEntry?: number | null
  formattedReferenceLo?: string | null
  formattedReferenceHi?: string | null
  referenceComment?: string | null
  units?: string | null
}

interface HelixTest {
  hxid?: string
  name?: string
  results?: { result?: HelixValue | null }[]
}

/** The words Helix puts beside a lone lower bound: «более 60». */
const LOWER_BOUND_ONLY = /^более/i

/** The profile chosen on the site, which names the account. */
async function currentProfile(page: LabPage): Promise<HelixProfile> {
  const response = await fetchOk(page, `${ORIGIN}/api/profiles/current`, JSON_HEADERS)
  return JSON.parse(response.text) as HelixProfile
}

/** Every profile of the account: the people whose orders it holds. */
async function allProfiles(page: LabPage): Promise<HelixProfile[]> {
  const response = await fetchOk(page, `${ORIGIN}/api/profiles`, JSON_HEADERS)
  return JSON.parse(response.text) as HelixProfile[]
}

function personOf(profile: HelixProfile): LabPerson {
  const name = [profile.lastName, profile.firstName, profile.middleName].filter(Boolean).join(' ')
  return {
    key: profile.id,
    name: name || profile.id,
    birthDate: profile.birthDate ? isoFromLabDate(profile.birthDate) : null,
  }
}

function keyOf(ref: OrderRef): HelixKey {
  const data = ref.data as Partial<HelixKey> | null
  if (typeof data?.code !== 'string' || typeof data.profileId !== 'string') {
    throw new Error(`Not a Helix order reference: ${ref.externalKey}`)
  }
  return data as HelixKey
}

/** The API names whose data it answers with through `profileId`. */
function forProfile(path: string, profileId: string): string {
  return `${ORIGIN}/api${path}?profileId=${encodeURIComponent(profileId)}`
}

function detailsUrl({ code, profileId }: HelixKey): string {
  return forProfile(`/v2/orders/${encodeURIComponent(code)}`, profileId)
}

/** The list of the order's forms, or with `file` one of them. */
function filesUrl({ code, profileId }: HelixKey, file?: string): string {
  const path = `/orders/${encodeURIComponent(code)}/files${file ? `/${encodeURIComponent(file)}` : ''}`
  return forProfile(path, profileId)
}

/** The reference as the form prints it: «3,5 - 10», «> 60», «отрицательный». */
function referenceOf(value: HelixValue): string | null {
  const low = value.formattedReferenceLo?.trim() || null
  const high = value.formattedReferenceHi?.trim() || null
  const comment = value.referenceComment?.trim() || null
  if (low && high) return `${low} - ${high}`
  if (low && (!comment || LOWER_BOUND_ONLY.test(comment))) return `> ${low}`
  if (high) return `< ${high}`
  return comment
}

function toRawResults(test: HelixTest): RawResult[] {
  const results = test.results ?? []
  return results.flatMap(({ result }) => {
    const name = result?.name?.trim()
    if (!result || !test.hxid || !name) return []
    const entry = result.formattedEntry?.trim() ?? ''
    return [
      {
        labCode: `${test.hxid} ${name}`,
        // A lone result is the test itself, which the test's own name says best.
        labName: results.length === 1 && test.name ? test.name : name,
        value: result.numericEntry === null || result.numericEntry === undefined ? null : entry,
        printed: [entry, result.units?.trim()].filter(Boolean).join(' '),
        reference: referenceOf(result),
        flag: null,
        // The test is the analysis its results are part of: «Общий анализ мочи».
        analysis: test.name?.trim() || null,
      },
    ]
  })
}

export const helixConnector: LabConnector = {
  id: 'helix',
  // 2: the analysis each result is part of, its test.
  version: '2',
  homeUrl: `${ORIGIN}/orders`,
  hosts: ['helix.ru'],
  requestIntervalMs: 400,

  detectBlock: detectVpnBlock,

  async detectAccount(page) {
    let profile: HelixProfile
    try {
      profile = await currentProfile(page)
    } catch (error) {
      if (LabHttpError.isStatus(error, NO_SESSION_STATUS)) return null
      throw error
    }
    const label = [profile.lastName, profile.firstName].filter(Boolean).join(' ')
    return { externalId: profile.id, label: label || null }
  },

  async listOrders(page) {
    const refs: OrderRef[] = []
    for (const profile of await allProfiles(page)) {
      const response = await fetchOk(page, forProfile('/v2/orders', profile.id), JSON_HEADERS)
      const { orders = [] } = JSON.parse(response.text) as { orders?: HelixOrder[] }
      const person = personOf(profile)
      for (const order of orders.filter((o) => o.canShowDetails !== false)) {
        refs.push({
          externalKey: order.code,
          // Helix writes the moment of the order in UTC; the sample was taken on its Moscow date.
          collectedOn: moscowDate(unixSeconds(Date.parse(order.createdOn))),
          person,
          data: { code: order.code, profileId: profile.id } satisfies HelixKey,
        })
      }
    }
    return refs
  },

  async fetchOrder(page, ref) {
    const response = await fetchOk(page, detailsUrl(keyOf(ref)), JSON_HEADERS)
    const body = JSON.parse(response.text) as { results?: { tests?: HelixTest[] } | null }
    return {
      externalKey: ref.externalKey,
      collectedOn: ref.collectedOn,
      results: (body.results?.tests ?? []).flatMap(toRawResults),
      rawPayload: response.text,
    }
  },

  async fetchOrderForms(page, ref) {
    const key = keyOf(ref)
    const response = await fetchOk(page, filesUrl(key), JSON_HEADERS)
    const { labelIds = [] } = JSON.parse(response.text) as { labelIds?: string[] }
    const forms: Uint8Array[] = []
    // One form per sample, each under its label.
    for (const label of labelIds) {
      const { bytes } = await fetchBytesOk(page, filesUrl(key, `results-${label}`))
      if (isPdf(bytes)) forms.push(bytes)
    }
    return forms
  },
}
