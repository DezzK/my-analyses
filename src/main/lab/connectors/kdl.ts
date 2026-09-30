import type { LabFlag } from '@shared/domain/enums'
import { detectVpnBlock } from '../pages'
import { objectsWithKey } from '../rsc'
import { moscowDate } from '../time'
import { fetchOk, isErrorStatus, type LabConnector, type OrderRef, type RawResult } from '../types'

/**
 * KDL (kdl.ru). The account is a Next.js site: the list of orders is rendered on the server and
 * reaches the browser as a React Server Components payload, while each order's details and its
 * PDF come from a JSON API on the same origin. The session is a cookie, so every request is made
 * from inside the logged-in page.
 */

const ORIGIN = 'https://kdl.ru'
/** The account page accepts large pages: fewer, bigger requests are gentler on the site. */
const ORDERS_PER_PAGE = 100
/** Guards the paging loop against a site that keeps answering with the same page. */
const MAX_ORDER_PAGES = 50
const RSC_HEADERS = { RSC: '1' }

interface KdlOrderKey {
  orderId: number
  createAt: number
  regionDb: number
}

interface KdlAnalysis {
  id?: string
  code?: string
  name?: string
  norm?: string | null
  result?: { value?: string | null; valueString?: string | null; resultStatus?: string | null } | null
}

interface KdlResponse<T> {
  status: string
  data: T | null
}

const FLAGS: Record<string, LabFlag> = { is_exceed: 'high', is_low: 'low', is_normal: 'normal' }

function ordersUrl(page: number, perPage: number): string {
  return `${ORIGIN}/account/orders?orderPage=${page}&orderPerPage=${perPage}&preorderPage=1&preorderPerPage=1`
}

function orderUrl(key: KdlOrderKey, what: 'details' | 'pdf'): string {
  return `${ORIGIN}/api/next/account/orders/${key.orderId}/${what}?createAt=${key.createAt}&regionDb=${key.regionDb}`
}

function isOrderKey(value: Record<string, unknown>): value is Record<string, unknown> & KdlOrderKey {
  return (
    typeof value['orderId'] === 'number' &&
    typeof value['createAt'] === 'number' &&
    typeof value['regionDb'] === 'number'
  )
}

function keyOf(ref: OrderRef): KdlOrderKey {
  const data = ref.data as Record<string, unknown>
  if (!isOrderKey(data)) throw new Error(`Not a KDL order reference: ${ref.externalKey}`)
  return data
}

function toRawResult(analysis: KdlAnalysis): RawResult | null {
  const labCode = analysis.code ?? analysis.id
  if (!labCode || !analysis.name) return null
  return {
    labCode,
    labName: analysis.name,
    value: analysis.result?.value ?? null,
    printed: analysis.result?.valueString ?? '',
    reference: analysis.norm ?? null,
    flag: FLAGS[analysis.result?.resultStatus ?? ''] ?? null,
  }
}

export const kdlConnector: LabConnector = {
  id: 'kdl',
  version: '1',
  homeUrl: `${ORIGIN}/account/orders`,
  hosts: ['kdl.ru'],
  requestIntervalMs: 400,

  detectBlock: detectVpnBlock,

  async detectAccount(page) {
    const response = await page.fetchText(ordersUrl(1, 1), { headers: RSC_HEADERS })
    if (isErrorStatus(response.status)) return null
    const person = objectsWithKey(response.text, 'surname')[0]
    const hasOrders = objectsWithKey(response.text, 'orderId').some(isOrderKey)
    if (!person && !hasOrders) return null
    const label = [person?.['surname'], person?.['name']]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' ')
    return { externalId: null, label: label || null }
  },

  async listOrders(page) {
    const refs = new Map<string, OrderRef>()
    for (let n = 1; n <= MAX_ORDER_PAGES; n++) {
      const response = await fetchOk(page, ordersUrl(n, ORDERS_PER_PAGE), { headers: RSC_HEADERS })
      const keys = objectsWithKey(response.text, 'orderId').filter(isOrderKey)
      const before = refs.size
      for (const { orderId, createAt, regionDb } of keys) {
        const externalKey = `${regionDb}:${orderId}`
        refs.set(externalKey, {
          externalKey,
          collectedOn: moscowDate(createAt),
          data: { orderId, createAt, regionDb },
        })
      }
      if (keys.length < ORDERS_PER_PAGE || refs.size === before) break
    }
    return [...refs.values()]
  },

  async fetchOrder(page, ref) {
    const response = await fetchOk(page, orderUrl(keyOf(ref), 'details'), {
      headers: { Accept: 'application/json' },
    })
    const body = JSON.parse(response.text) as KdlResponse<{ analyses?: KdlAnalysis[] }>
    if (body.status !== 'success' || !body.data) {
      throw new Error(`KDL did not return order ${ref.externalKey}`)
    }
    return {
      externalKey: ref.externalKey,
      collectedOn: ref.collectedOn,
      results: (body.data.analyses ?? []).map(toRawResult).filter((r) => r !== null),
      rawPayload: response.text,
    }
  },

  async fetchOrderForms(page, ref) {
    // The site's own code sends this content type when it asks for the form.
    const response = await fetchOk(page, orderUrl(keyOf(ref), 'pdf'), {
      headers: { 'Content-Type': 'application/pdf' },
    })
    const body = JSON.parse(response.text) as KdlResponse<{ pdf?: string }>
    const base64 = body.status === 'success' ? body.data?.pdf?.replace(/^data:[^,]*,/, '') : undefined
    return base64 ? [new Uint8Array(Buffer.from(base64, 'base64'))] : []
  },
}
