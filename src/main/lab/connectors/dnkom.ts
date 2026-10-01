import { parse, type HTMLElement } from 'node-html-parser'
import { isoFromDateRu } from '@shared/domain/dates'
import type { Specimen } from '@shared/domain/enums'
import { specimenOfMaterial } from '@shared/domain/specimens'
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

/** A group of an order's results: the analysis it is, with its form, and the material it is of. */
interface DnkomGroup {
  analysis: string | null
  specimen: Specimen | null
}

/**
 * Each service's results, under the analysis and of the material its group names («ОАМ», «Моча
 * (разовая)»); a test with no history link is known by the service's code and its name. A
 * service may be a package of several analyses («Чекап»), so its own title says less.
 */
function resultsOf(detail: HTMLElement): RawResult[] {
  let group: DnkomGroup = { analysis: null, specimen: null }
  const results: RawResult[] = []
  // Groups and their services stand side by side, a group before the services of its material.
  for (const element of detail.querySelectorAll('.group-line, .detail-order')) {
    if (element.classList.contains('group-line')) {
      const material = textOf(element.querySelector('.order-material'))
      group = {
        analysis: textOf(element.querySelector('.order-type')) || null,
        specimen: material ? specimenOfMaterial(material) : null,
      }
    } else {
      results.push(...serviceResults(element, group))
    }
  }
  return results
}

function serviceResults(service: HTMLElement, group: DnkomGroup): RawResult[] {
  const serviceCode = textOf(service.querySelector('.order-title .code'))
  const analysis = group.analysis ?? (textOf(service.querySelector('.order-title .title')) || null)
  const { specimen } = group
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
        analysis,
        specimen,
      } satisfies RawResult,
    ]
  })
}

export const dnkomConnector: LabConnector = {
  id: 'dnkom',
  // 2: the forms of orders 0.2.0 imported, which it could not download; 3: each result's analysis
  // and specimen.
  version: '3',
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
