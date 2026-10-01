import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answer, FakeLabPage, refuse } from '../fake-page'
import { LabHttpError } from '../types'
import { gemotestConnector } from './gemotest'

const NOW_MS = Date.parse('2026-07-15T09:00:00Z')
const NOW = NOW_MS / 1000
const TOKEN_LIFETIME = 1200
/** How many orders the connector asks for at a time. */
const PER_PAGE = 50
/** A made-up order number: tests never carry a real one. */
const ORDER = '10000001'
const REF = { externalKey: ORDER, collectedOn: '2026-07-15', data: { orderNumber: ORDER } }
const PROFILE = { patient_id: 123456, last_name: 'Иванова', first_name: 'Анна', middle_name: 'Петровна' }

type Routes = ConstructorParameters<typeof FakeLabPage>[0]

/** A page holding a made-up session the way the site leaves it in localStorage. */
function sessionPage(routes: Routes, expiresAt = NOW + 600): FakeLabPage {
  const page = new FakeLabPage(routes)
  page.storage.set('lk_access_token', 'access-1')
  page.storage.set('lk_refresh_token', 'refresh-1')
  page.storage.set('lk_expires_in', String(expiresAt))
  page.storage.set('lk_device_id', 'device-1')
  return page
}

function test(fields: Record<string, unknown>) {
  return { unit: null, is_normal: true, comment: [], reference_range: null, ...fields }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW_MS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('gemotestConnector', () => {
  it('tells a live session from a spent one without asking the site', async () => {
    expect(await gemotestConnector.detectLogin?.(sessionPage([]))).toBe(true)
    expect(await gemotestConnector.detectLogin?.(sessionPage([], NOW - 10))).toBe(false)
    expect(await gemotestConnector.detectLogin?.(new FakeLabPage([]))).toBe(false)
  })

  it('knows the account by its profile, asked with the stored token and no cookies', async () => {
    const page = sessionPage([answer('/lk/v1/profile/me', JSON.stringify(PROFILE))])
    expect(await gemotestConnector.detectAccount(page)).toEqual({
      externalId: String(PROFILE.patient_id),
      label: 'Иванова Анна',
    })
    expect(page.requests).toEqual([
      {
        url: 'https://api2.gemotest.ru/lk/v1/profile/me',
        init: {
          headers: { Authorization: 'Bearer access-1', Accept: 'application/json' },
          credentials: 'omit',
        },
      },
    ])
  })

  it('refreshes a token about to run out and leaves the new pair for the site', async () => {
    const tokens = {
      token_type: 'bearer',
      expires_in: TOKEN_LIFETIME,
      access_token: 'access-2',
      refresh_token: 'refresh-2',
    }
    const page = sessionPage(
      [
        answer('/lk/v1/auth/refresh', JSON.stringify(tokens)),
        answer('/lk/v1/profile/me', JSON.stringify(PROFILE)),
      ],
      NOW + 30,
    )
    expect(await gemotestConnector.detectAccount(page)).not.toBeNull()
    const [refresh, profile] = page.requests
    expect(refresh?.init).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'device-1' },
      body: JSON.stringify({ refresh_token: 'refresh-1' }),
      credentials: 'omit',
    })
    expect(profile?.init?.headers?.['Authorization']).toBe('Bearer access-2')
    expect(Object.fromEntries(page.storage)).toEqual({
      lk_access_token: 'access-2',
      lk_refresh_token: 'refresh-2',
      lk_expires_in: String(NOW + TOKEN_LIFETIME),
      lk_device_id: 'device-1',
    })
  })

  it('takes a refused refresh, or no session at all, for nobody logged in', async () => {
    const refused = sessionPage([refuse('/lk/v1/auth/refresh', 500)], NOW - 10)
    expect(await gemotestConnector.detectAccount(refused)).toBeNull()
    expect(refused.storage.get('lk_refresh_token')).toBe('refresh-1')
    const empty = new FakeLabPage([])
    expect(await gemotestConnector.detectAccount(empty)).toBeNull()
    expect(empty.requests).toEqual([])
  })

  it('lists orders page by page, each under its person, dated as the lab dates them', async () => {
    const holder = { last_name: 'Иванова', first_name: 'Анна', middle_name: 'Петровна' }
    const son = { last_name: 'Иванов', first_name: 'Пётр', middle_name: 'Сергеевич' }
    const firstNumber = 20000000
    const order = (n: number) => ({
      order_num: String(firstNumber + n),
      date: '2026-02-19 08:15:00.000',
      // The lab names nobody for one of them.
      ...(n === 1 ? {} : holder),
    })
    const firstPage = Array.from({ length: PER_PAGE }, (_, n) => order(n))
    const patient = (birthdate: string) => JSON.stringify({ order: { patient: { birthdate } } })
    const page = sessionPage([
      answer(`limit=${PER_PAGE}&offset=0`, JSON.stringify({ jsonrpc: '2.0', result: { orders: firstPage } })),
      answer(
        `limit=${PER_PAGE}&offset=${PER_PAGE}`,
        JSON.stringify({
          result: { orders: [{ order_num: ORDER, date: '2026-07-15 23:40:12.000', ...son }] },
        }),
      ),
      answer(`/customer/v3/order/${firstNumber}`, patient('14.05.1990')),
      answer(`/customer/v3/order/${ORDER}`, patient('01.03.2015')),
    ])
    const refs = await gemotestConnector.listOrders(page)
    expect(refs).toHaveLength(PER_PAGE + 1)
    expect(refs[0]?.person).toEqual({
      key: 'иванова анна петровна|1990-05-14',
      name: 'Иванова Анна Петровна',
      birthDate: '1990-05-14',
    })
    expect(refs[1]?.person).toBeUndefined()
    expect(refs.at(-1)).toEqual({
      ...REF,
      person: {
        key: 'иванов петр сергеевич|2015-03-01',
        name: 'Иванов Пётр Сергеевич',
        birthDate: '2015-03-01',
      },
    })
    // One order's details per person tell their birth date.
    expect(page.requests.filter((r) => r.url.includes('/customer/v3/order/'))).toHaveLength(2)
  })

  it("reads each service's results, with the lab's marks as flags", async () => {
    const services = [
      { id: 'CBC_QUJD%2B', code: '1.1.', status: 'Выполнен' },
      { id: 'VITD_REVG', code: '4.2.', status: 'Выполнен' },
      { id: 'LATE_WA', code: '9.9.', status: 'В работе' },
    ]
    const bloodCount = {
      service: { id: 'CBC_QUJD%2B' },
      tests: [
        test({
          id: 'HGB',
          title: 'Гемоглобин',
          value: '150 ',
          unit: 'г/л',
          reference_range: { text: '120 - 140' },
        }),
        test({
          id: 'WBC',
          title: 'Лейкоциты',
          value: '11.20 +',
          unit: '10*9/л',
          reference_range: { min_value: '4', max_value: '9', text: '4 - 9' },
          is_normal: false,
        }),
        test({ id: 'RBC', title: 'Эритроциты', value: '3.10 -', unit: '10*12/л', is_normal: false }),
        test({
          id: 'IDX',
          title: 'Индекс',
          value: '0.52 ',
          unit: '-',
          reference_range: { min_value: 'min', text: '< 1' },
          is_normal: false,
        }),
      ],
    }
    const vitaminD = {
      service: { id: 'VITD_REVG' },
      tests: [
        test({
          id: 'VITD',
          title: 'Витамин D',
          value: '41.2 ',
          unit: 'нг/мл',
          reference_range: { min_value: '', max_value: '', text: 'Смотри текст' },
          comment: ['<10.0 нг/мл   - дефицит', ' 10.0 - 30.0 нг/мл - недостаточность '],
        }),
      ],
    }
    const page = sessionPage([
      answer(`/order/${ORDER}/service/CBC_QUJD%2B`, JSON.stringify(bloodCount)),
      answer(`/order/${ORDER}/service/VITD_REVG`, JSON.stringify(vitaminD)),
      refuse(`/order/${ORDER}/service/LATE_WA`, 404),
      answer(`/customer/v3/order/${ORDER}`, JSON.stringify({ order: { id: ORDER }, services })),
    ])
    const order = await gemotestConnector.fetchOrder(page, REF)
    expect(order.results).toEqual([
      {
        labCode: '1.1. HGB',
        labName: 'Гемоглобин',
        value: '150',
        printed: '150 г/л',
        reference: '120 - 140',
        flag: 'normal',
      },
      {
        labCode: '1.1. WBC',
        labName: 'Лейкоциты',
        value: '11.20',
        printed: '11.20 10*9/л',
        reference: '4 - 9',
        flag: 'high',
      },
      {
        labCode: '1.1. RBC',
        labName: 'Эритроциты',
        value: '3.10',
        printed: '3.10 10*12/л',
        reference: null,
        flag: 'low',
      },
      {
        labCode: '1.1. IDX',
        labName: 'Индекс',
        value: '0.52',
        printed: '0.52',
        reference: '< 1',
        flag: 'abnormal',
      },
      {
        labCode: '4.2. VITD',
        labName: 'Витамин D',
        value: '41.2',
        printed: '41.2 нг/мл',
        reference: '<10.0 нг/мл - дефицит; 10.0 - 30.0 нг/мл - недостаточность',
        flag: 'normal',
      },
    ])
    expect(JSON.parse(order.rawPayload)).toEqual({
      order: { order: { id: ORDER }, services },
      services: [bloodCount, vitaminD],
    })
  })

  it('fails on a finished service it cannot read, rather than leave its results out', async () => {
    const page = sessionPage([
      refuse(`/order/${ORDER}/service/`, 404),
      answer(
        `/customer/v3/order/${ORDER}`,
        JSON.stringify({ services: [{ id: 'CRP_Q1JQ', code: '1.14.', status: 'Выполнен' }] }),
      ),
    ])
    await expect(gemotestConnector.fetchOrder(page, REF)).rejects.toThrow('HTTP 404')
  })

  it('reports a session that ended during a sync as one to log into again', async () => {
    const failure = await gemotestConnector
      .fetchOrder(new FakeLabPage([]), REF)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LabHttpError)
    expect((failure as LabHttpError).sessionExpired).toBe(true)
  })
})
