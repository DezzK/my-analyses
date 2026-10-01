import { parse, type HTMLElement } from 'node-html-parser'
import { isoFromDateRu } from '@shared/domain/dates'
import { detectVpnBlock, isPdf } from '../pages'
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
 * DNKOM (dnkom.ru). The account is part of a Bitrix site: a cookie session and pages rendered on
 * the server, with no API, so the connector reads their markup. A session that has ended sends the
 * cabinet to its login page. An order's results come in groups by material, each group with a
 * form of its own; a value and a reference carry their unit, and the lab marks a value out of
 * range without saying which way. A result is known by the test code its history link names.
 */

const ORIGIN = 'https://dnkom.ru'
const RESULTS_URL = `${ORIGIN}/personal/cabinet/results/`
/** Where the cabinet sends a visitor whose session has ended. */
const LOGIN_PATH = '/personal/cabinet/auth/'
/** Only a logged-in visitor's pages offer to log out. */
export const LOGGED_IN_EXPRESSION = "document.querySelector('a.logout-link') !== null"

interface DnkomKey {
  orderId: string
  token: string
}

/** The element's text with its runs of whitespace, line breaks among them, made single spaces. */
function textOf(element: HTMLElement | null): string {
  return element?.text.replace(/\s+/g, ' ').trim() ?? ''
}

/** A cabinet page, or null when the session has ended and the login page came instead. */
async function cabinetPage(page: LabPage, url: string): Promise<HTMLElement | null> {
  const response = await fetchOk(page, url)
  return new URL(response.url).pathname.startsWith(LOGIN_PATH) ? null : parse(response.text)
}

/** Like `cabinetPage`, for a sync that has already found someone logged in. */
async function requireCabinetPage(page: LabPage, url: string): Promise<HTMLElement> {
  const cabinet = await cabinetPage(page, url)
  if (!cabinet) throw LabHttpError.sessionEnded(url)
  return cabinet
}

/** «ИВАНОВА АННА», as the header shouts it, spelled as a name. */
function nameCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())
}

function keyFrom(href: string | undefined): DnkomKey | null {
  if (!href) return null
  const params = new URL(href, RESULTS_URL).searchParams
  const orderId = params.get('ORDER_ID')
  const token = params.get('TOKEN')
  return orderId && token ? { orderId, token } : null
}

function keyOf(ref: OrderRef): DnkomKey {
  const data = ref.data as Partial<DnkomKey> | null
  if (typeof data?.orderId !== 'string' || typeof data.token !== 'string') {
    throw new Error(`Not a DNKOM order reference: ${ref.externalKey}`)
  }
  return data as DnkomKey
}

/** The part of an order's page that holds its results and forms. */
async function orderDetail(page: LabPage, ref: OrderRef): Promise<HTMLElement> {
  const { orderId, token } = keyOf(ref)
  const url = `${ORIGIN}/personal/cabinet/resultdetail/?ORDER_ID=${encodeURIComponent(orderId)}&TOKEN=${encodeURIComponent(token)}`
  const detail = (await requireCabinetPage(page, url)).querySelector('.results-detail')
  if (!detail) throw new Error(`DNKOM showed order ${ref.externalKey} without its results`)
  return detail
}

/** The code the result's history link names, which stays with the test across orders. */
function testCodeOf(line: HTMLElement): string | null {
  const href = line.querySelector('.detail-chart a')?.getAttribute('href')
  return href ? new URL(href, RESULTS_URL).searchParams.get('TEST_CODE')?.trim() || null : null
}

/** Each service's results; a test with no history link is known by the service's code and its name. */
function resultsOf(detail: HTMLElement): RawResult[] {
  return detail.querySelectorAll('.detail-order').flatMap((service) => {
    const serviceCode = textOf(service.querySelector('.order-title .code'))
    return service.querySelectorAll('.detail-line').flatMap((line) => {
      const name = textOf(line.querySelector('.detail-title'))
      if (!name) return []
      const reference = textOf(line.querySelector('.detail-normal .param-value')) || null
      const outOfRange = line.querySelector('.out-param') !== null
      return [
        {
          labCode: testCodeOf(line) ?? `${serviceCode} ${name}`,
          labName: name,
          value: null,
          printed: textOf(line.querySelector('.detail-param .param-value')),
          reference,
          flag: outOfRange ? 'abnormal' : reference ? 'normal' : null,
        } satisfies RawResult,
      ]
    })
  })
}

export const dnkomConnector: LabConnector = {
  id: 'dnkom',
  // 2: the forms of orders 0.2.0 imported, which it could not download.
  version: '2',
  homeUrl: RESULTS_URL,
  hosts: ['dnkom.ru'],
  requestIntervalMs: 400,

  detectBlock: detectVpnBlock,

  detectLogin(page) {
    return page.evaluate<boolean>(LOGGED_IN_EXPRESSION)
  },

  async detectAccount(page) {
    const results = await cabinetPage(page, RESULTS_URL)
    if (!results) return null
    const name = textOf(results.querySelector('a.account-name'))
    return { externalId: null, label: name ? nameCase(name) : null }
  },

  async listOrders(page) {
    const results = await requireCabinetPage(page, RESULTS_URL)
    return results.querySelectorAll('.result-line').flatMap((row) => {
      const key = keyFrom(row.querySelector('a.order-link')?.getAttribute('href'))
      // «15.07.2026 09:41:12», Moscow time.
      const collectedOn = isoFromDateRu(textOf(row.querySelector('.order-created')))
      return key && collectedOn ? [{ externalKey: key.orderId, collectedOn, data: key }] : []
    })
  },

  async fetchOrder(page, ref) {
    const detail = await orderDetail(page, ref)
    return {
      externalKey: ref.externalKey,
      collectedOn: ref.collectedOn,
      results: resultsOf(detail),
      // The page around the results is the site's own and changes with every visit.
      rawPayload: detail.outerHTML,
    }
  },

  async fetchOrderForms(page, ref) {
    const detail = await orderDetail(page, ref)
    const forms: Uint8Array[] = []
    // One form per group of results.
    for (const link of detail.querySelectorAll('.group-line .order-file a')) {
      const href = link.getAttribute('href')
      if (!href) continue
      const { bytes } = await fetchBytesOk(page, new URL(href, ORIGIN).href)
      if (isPdf(bytes)) forms.push(bytes)
    }
    return forms
  },
}
