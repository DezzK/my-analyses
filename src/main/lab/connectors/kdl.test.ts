import { describe, expect, it } from 'vitest'
import { BUILTIN_LABS } from '../../services/labs'
import { answer, FakeLabPage } from '../fake-page'
import { PAGE_TEXT_EXPRESSION } from '../pages'
import { CONNECTORS } from './index'
import { kdlConnector } from './kdl'

const MIDNIGHT_JUL_15 = 1784062800 // 15.07.2026 00:00 Moscow
const MIDNIGHT_FEB_19 = 1771448400 // 19.02.2026 00:00 Moscow
/** A made-up order number: tests never carry a real one. */
const ORDER_ID = 41000007

function rscPage(orders: object[], person: object | null): string {
  return [
    '0:["$","$L1",null,{"children":"$L2"}]',
    `5:${JSON.stringify({ orders })}`,
    person ? `6:${JSON.stringify({ profile: person })}` : '6:null',
  ].join('\n')
}

const DETAILS = JSON.stringify({
  status: 'success',
  data: {
    id: ORDER_ID,
    analyses: [
      {
        id: '1.1.A1.1',
        code: '1.1.A1.1',
        name: 'Глюкоза',
        norm: '3.9-5.5 ммоль/л',
        result: { value: '5.40', valueString: '5.40 ммоль/л', resultStatus: 'is_normal' },
      },
      {
        code: '1.1.A1.2',
        name: 'Гемоглобин',
        norm: '120-140 г/л',
        result: { value: '150', valueString: '150 г/л', resultStatus: 'is_exceed' },
      },
      {
        code: '7.1.B1.1',
        name: 'Посев',
        norm: 'см. результат в pdf заказа',
        result: { value: null, valueString: 'см. результат в pdf заказа', resultStatus: null },
      },
      // Its catalog section, 6.1, is urine's.
      {
        code: '6.1.B9.9',
        name: 'Лейкоциты',
        norm: '0-5',
        result: { value: null, valueString: '2-4 в п/зр', resultStatus: 'is_normal' },
      },
      { code: '', name: 'Без кода' },
    ],
  },
  error: null,
  meta: null,
})

describe('kdlConnector', () => {
  it('recognizes the VPN block page', async () => {
    const blocked = new FakeLabPage([], {
      'document.title': 'Forbidden',
      [PAGE_TEXT_EXPRESSION]: 'Возможно, у вас включен VPN',
    })
    expect(await kdlConnector.detectBlock(blocked)).toBe('vpn_or_region')
    const fine = new FakeLabPage([], {
      'document.title': 'KDL АНАЛИЗЫ',
      [PAGE_TEXT_EXPRESSION]: 'Заказы',
    })
    expect(await kdlConnector.detectBlock(fine)).toBeNull()
  })

  it('tells a logged-in account from a logged-out one', async () => {
    const loggedIn = new FakeLabPage([
      answer('/account/orders', rscPage([], { surname: 'Иванова', name: 'Анна' })),
    ])
    expect(await kdlConnector.detectAccount(loggedIn)).toEqual({ externalId: null, label: 'Иванова Анна' })
    const nameless = new FakeLabPage([
      answer(
        '/account/orders',
        rscPage([{ orderId: ORDER_ID, createAt: MIDNIGHT_JUL_15, regionDb: 2 }], null),
      ),
    ])
    expect(await kdlConnector.detectAccount(nameless)).toEqual({ externalId: null, label: null })
    const loggedOut = new FakeLabPage([answer('/account/orders', '0:["$","$L1",null,{"children":"login"}]')])
    expect(await kdlConnector.detectAccount(loggedOut)).toBeNull()
  })

  it('lists orders page by page from the server-rendered payload', async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      orderId: 1000 + i,
      createAt: MIDNIGHT_FEB_19,
      regionDb: 5,
    }))
    const page = new FakeLabPage([
      answer('?orderPage=1&', rscPage(firstPage, null)),
      answer('?orderPage=2&', rscPage([{ orderId: ORDER_ID, createAt: MIDNIGHT_JUL_15, regionDb: 2 }], null)),
    ])
    const refs = await kdlConnector.listOrders(page)
    expect(refs).toHaveLength(101)
    expect(refs.at(-1)).toEqual({
      externalKey: `2:${ORDER_ID}`,
      collectedOn: '2026-07-15',
      data: { orderId: ORDER_ID, createAt: MIDNIGHT_JUL_15, regionDb: 2 },
    })
    expect(page.requests.every((r) => r.init?.headers?.['RSC'] === '1')).toBe(true)
  })

  it('reads an order as the lab reports it, each test of the specimen its catalog section says', async () => {
    const ref = {
      externalKey: `2:${ORDER_ID}`,
      collectedOn: '2026-07-15',
      data: { orderId: ORDER_ID, createAt: MIDNIGHT_JUL_15, regionDb: 2 },
    }
    const page = new FakeLabPage([
      answer(`/api/next/account/orders/${ORDER_ID}/details?createAt=${MIDNIGHT_JUL_15}&regionDb=2`, DETAILS),
    ])
    const order = await kdlConnector.fetchOrder(page, ref)
    expect(order.rawPayload).toBe(DETAILS)
    expect(order.results).toEqual([
      {
        labCode: '1.1.A1.1',
        labName: 'Глюкоза',
        value: '5.40',
        printed: '5.40 ммоль/л',
        reference: '3.9-5.5 ммоль/л',
        flag: 'normal',
        specimen: null,
      },
      {
        labCode: '1.1.A1.2',
        labName: 'Гемоглобин',
        value: '150',
        printed: '150 г/л',
        reference: '120-140 г/л',
        flag: 'high',
        specimen: null,
      },
      {
        labCode: '7.1.B1.1',
        labName: 'Посев',
        value: null,
        printed: 'см. результат в pdf заказа',
        reference: 'см. результат в pdf заказа',
        flag: null,
        specimen: null,
      },
      {
        labCode: '6.1.B9.9',
        labName: 'Лейкоциты',
        value: null,
        printed: '2-4 в п/зр',
        reference: '0-5',
        flag: 'normal',
        specimen: 'urine',
      },
    ])
  })

  it('downloads the original form', async () => {
    const pdf = Buffer.from('%PDF-1.7 fake').toString('base64')
    const page = new FakeLabPage([
      answer(
        '/pdf?',
        JSON.stringify({ status: 'success', data: { pdf: `data:application/pdf;base64,${pdf}` } }),
      ),
    ])
    const ref = {
      externalKey: '2:1',
      collectedOn: '2026-07-15',
      data: { orderId: 1, createAt: 1, regionDb: 2 },
    }
    const forms = await kdlConnector.fetchOrderForms?.(page, ref)
    expect(forms?.map((bytes) => Buffer.from(bytes).toString())).toEqual(['%PDF-1.7 fake'])
  })
})

describe('connector registry', () => {
  it('has a connector for every built-in lab that names one', () => {
    for (const lab of BUILTIN_LABS) {
      if (lab.connectorId) expect(CONNECTORS[lab.connectorId], lab.name).toBeDefined()
    }
  })
})
