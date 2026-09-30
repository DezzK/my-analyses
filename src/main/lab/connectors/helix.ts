import { detectVpnBlock, isPdf } from '../pages'
import { moscowDate } from '../time'
import {
  fetchBytesOk,
  fetchOk,
  LabHttpError,
  type LabConnector,
  type LabPage,
  type OrderRef,
  type RawResult,
} from '../types'

/**
 * Helix (helix.ru). The account is an app on my.helix.ru with a JSON API on the same origin and a
 * cookie session. An account may hold several people's profiles; the one chosen on the site is
 * the one imported. A panel's components (a blood count) have no codes of their own, so each is
 * known by its test's code and its own name; the forms come one per sample.
 */

const ORIGIN = 'https://my.helix.ru'
const JSON_HEADERS = { headers: { Accept: 'application/json' } }
/** How Helix answers a request that carries no session. */
const NO_SESSION_STATUS = 403

interface HelixProfile {
  id: string
  lastName?: string
  firstName?: string
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

/** The profile chosen on the site: its orders are the ones imported. */
async function currentProfile(page: LabPage): Promise<HelixProfile> {
  const response = await fetchOk(page, `${ORIGIN}/api/profiles/current`, JSON_HEADERS)
  return JSON.parse(response.text) as HelixProfile
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
      },
    ]
  })
}

export const helixConnector: LabConnector = {
  id: 'helix',
  version: '1',
  homeUrl: `${ORIGIN}/orders`,
  hosts: ['helix.ru'],
  requestIntervalMs: 400,

  detectBlock: detectVpnBlock,

  async detectAccount(page) {
    let profile: HelixProfile
    try {
      profile = await currentProfile(page)
    } catch (error) {
      if (error instanceof LabHttpError && error.status === NO_SESSION_STATUS) return null
      throw error
    }
    const label = [profile.lastName, profile.firstName].filter(Boolean).join(' ')
    return { externalId: profile.id, label: label || null }
  },

  async listOrders(page) {
    const profile = await currentProfile(page)
    const response = await fetchOk(page, forProfile('/v2/orders', profile.id), JSON_HEADERS)
    const { orders = [] } = JSON.parse(response.text) as { orders?: HelixOrder[] }
    return orders
      .filter((order) => order.canShowDetails !== false)
      .map((order) => ({
        externalKey: order.code,
        // Helix writes the moment of the order in UTC; the sample was taken on its Moscow date.
        collectedOn: moscowDate(Date.parse(order.createdOn) / 1000),
        data: { code: order.code, profileId: profile.id } satisfies HelixKey,
      }))
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
