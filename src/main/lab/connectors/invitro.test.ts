import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answer, answerBytes, FakeLabPage, refuse } from '../fake-page'
import { LabHttpError } from '../types'
import { invitroConnector } from './invitro'

const NOW_MS = Date.parse('2026-07-15T09:00:00Z')
const TOKEN_LIFETIME_SECONDS = 300
/** Made-up requisition numbers and patients: tests never carry real ones. */
const INZ_BLOOD = '111111111'
const INZ_URINE = '222222222'
const REF = {
  externalKey: '1000000000001',
  collectedOn: '2026-07-15',
  data: { patientId: 'patient-a', inzs: [INZ_BLOOD, INZ_URINE] },
}
/** The account holder's own order. */
const HOLDERS_ORDER = {
  number: '1000000000003',
  created_at: '2026-06-01T06:00:00Z',
  multiple_inz: ['333333333'],
}
const PATIENTS = {
  patients: [
    { id: 'patient-a', main: false, last_name: 'Иванова', first_name: 'Анна', birthday: '1990-05-14' },
    { id: 'patient-main', main: true, last_name: 'Иванов', first_name: 'Пётр', birthday: '1985-02-10' },
  ],
}

type Routes = ConstructorParameters<typeof FakeLabPage>[0]

function tokens(n: number) {
  return {
    access_token: `access-${n}`,
    refresh_token: `refresh-${n + 1}`,
    fingerprint: `fp-${n + 1}`,
    access_expires_in: TOKEN_LIFETIME_SECONDS,
  }
}

/** A page holding a made-up session the way the site leaves it in localStorage. */
function sessionPage(routes: Routes): FakeLabPage {
  const page = new FakeLabPage(routes)
  page.storage.set('refreshToken', 'refresh-1')
  page.storage.set('fingerprint', 'fp-1')
  return page
}

/** Answers each refresh with the next pair, as Invitro rotates them. */
function rotatingRefresh() {
  let n = 0
  return answer('/auth/api/v1/auth/token/refresh', () => JSON.stringify(tokens(++n)))
}

function refreshes(page: FakeLabPage) {
  return page.requests.filter((r) => r.url.endsWith('/auth/token/refresh'))
}

function test(fields: Record<string, unknown>) {
  return {
    requisition_id: INZ_BLOOD,
    unit: null,
    ref_min: null,
    ref_max: null,
    ref_text: null,
    ref_mark: '',
    ...fields,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW_MS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('invitroConnector', () => {
  it('sees a login by the pair the site stores, without asking the site', async () => {
    expect(await invitroConnector.detectLogin?.(sessionPage([]))).toBe(true)
    expect(await invitroConnector.detectLogin?.(new FakeLabPage([]))).toBe(false)
  })

  it('refreshes the session, stores the new pair, and knows the account by its holder', async () => {
    const page = sessionPage([rotatingRefresh(), answer('/users/api/v1/patients', JSON.stringify(PATIENTS))])
    expect(await invitroConnector.detectAccount(page)).toEqual({
      externalId: 'patient-main',
      label: 'Иванов Пётр',
    })
    const [refresh, patients] = page.requests
    expect(refresh?.init).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'refresh-1', fingerprint: 'fp-1' }),
    })
    expect(patients?.init?.headers?.['Authorization']).toBe('Bearer access-1')
    expect(page.storage.get('refreshToken')).toBe('refresh-2')
    expect(page.storage.get('fingerprint')).toBe('fp-2')
  })

  it('refreshes once per sync, and again only when the token runs out', async () => {
    const page = sessionPage([
      rotatingRefresh(),
      answer('/users/api/v1/patients', JSON.stringify(PATIENTS)),
      answer('/history/api/v2/orders', '[]'),
    ])
    await invitroConnector.detectAccount(page)
    await invitroConnector.listOrders(page)
    expect(refreshes(page)).toHaveLength(1)
    vi.setSystemTime(NOW_MS + TOKEN_LIFETIME_SECONDS * 1000)
    await invitroConnector.listOrders(page)
    expect(refreshes(page).map((r) => r.init?.body)).toEqual([
      JSON.stringify({ refresh_token: 'refresh-1', fingerprint: 'fp-1' }),
      JSON.stringify({ refresh_token: 'refresh-2', fingerprint: 'fp-2' }),
    ])
  })

  it('takes a refused pair for the end of the session and removes it, as the site does', async () => {
    for (const status of [400, 401]) {
      const page = sessionPage([refuse('/auth/token/refresh', status)])
      expect(await invitroConnector.detectAccount(page)).toBeNull()
      expect(Object.fromEntries(page.storage)).toEqual({})
      expect(await invitroConnector.detectLogin?.(page)).toBe(false)
    }
  })

  it('keeps the pair when Invitro itself fails', async () => {
    const page = sessionPage([refuse('/auth/token/refresh', 502)])
    await expect(invitroConnector.detectAccount(page)).rejects.toThrow('HTTP 502')
    expect(page.storage.get('refreshToken')).toBe('refresh-1')
  })

  it("lists every patient's orders that have requisitions, each under its person, dated in Moscow", async () => {
    const groups = [
      {
        date_label: '15 июля 2026',
        orders: [
          // 22:30 UTC is already the next day in Moscow.
          {
            number: REF.externalKey,
            created_at: '2026-07-14T22:30:00.12Z',
            multiple_inz: [INZ_BLOOD, INZ_URINE],
          },
          { number: '1000000000002', created_at: '2026-07-10T08:00:00Z', multiple_inz: [] },
        ],
      },
    ]
    const page = sessionPage([
      rotatingRefresh(),
      answer('/users/api/v1/patients', JSON.stringify(PATIENTS)),
      answer('/history/api/v2/orders?patient_id=patient-a', JSON.stringify(groups)),
      answer('/history/api/v2/orders?patient_id=patient-main', JSON.stringify([{ orders: [HOLDERS_ORDER] }])),
    ])
    expect(await invitroConnector.listOrders(page)).toEqual([
      { ...REF, person: { key: 'patient-a', name: 'Иванова Анна', birthDate: '1990-05-14' } },
      {
        externalKey: HOLDERS_ORDER.number,
        collectedOn: '2026-06-01',
        person: { key: 'patient-main', name: 'Иванов Пётр', birthDate: '1985-02-10' },
        data: { patientId: 'patient-main', inzs: HOLDERS_ORDER.multiple_inz },
      },
    ])
  })

  it('reads the results of all requisitions, with the lab mark as a flag', async () => {
    const bulk = {
      requisition_id: INZ_BLOOD,
      status: 1,
      tests: [
        test({
          test_method_code: 'WBC-KR',
          analysis_name: 'Лейкоциты',
          value: 5.1,
          unit: '10^9/л',
          ref_min: 4,
          ref_max: 9,
          ref_text: '4 - 9',
        }),
        test({
          test_method_code: 'NE%-KR',
          analysis_name: 'Нейтрофилы, %',
          value: 78.5,
          unit: '%',
          ref_min: 47,
          ref_max: 72,
          ref_text: '47 - 72',
          ref_mark: '*',
        }),
        test({
          test_method_code: 'K-KR',
          analysis_name: 'Калий',
          value: 4.25,
          unit: 'ммоль/л',
          ref_min: 3.5,
          ref_max: 5.1,
        }),
        test({
          test_method_code: 'HCV',
          analysis_name: 'Антитела к HCV',
          value: 'не обнаружены',
          ref_min: 0,
          ref_max: 0,
          anacomments: [{ type: 'AE', text: 'Метод ИХЛА' }],
        }),
        test({
          test_method_code: 'CHOL',
          analysis_name: 'Холестерин',
          value: 4.8,
          unit: 'ммоль/л',
          ref_text: 'СМ.КОММ.',
          anacomments: [{ type: 'AK', text: '< 5,2 - оптимально,\n5,2 - 6,2   - погранично' }],
        }),
        test({
          test_method_code: 'GLU',
          analysis_name: 'Глюкоза',
          value: 5.2,
          unit: 'ммоль/л',
          ref_text: '3.9 - 6.1',
        }),
        test({
          requisition_id: INZ_URINE,
          test_method_code: 'GLU',
          analysis_name: 'Глюкоза в моче',
          value: 0.4,
          unit: 'ммоль/л',
          ref_text: '< 0.8',
        }),
        test({ test_method_code: '', analysis_name: 'Без кода', value: 1 }),
      ],
    }
    const page = sessionPage([rotatingRefresh(), answer('/patient/patient-a/bulk', JSON.stringify(bulk))])
    const order = await invitroConnector.fetchOrder(page, REF)
    expect(page.requests.at(-1)?.init?.body).toBe(JSON.stringify({ inzs: [INZ_BLOOD, INZ_URINE] }))
    expect(order.rawPayload).toBe(JSON.stringify(bulk))
    expect(order.results).toEqual([
      {
        labCode: 'WBC-KR',
        labName: 'Лейкоциты',
        value: '5.1',
        printed: '5.1 10^9/л',
        reference: '4 - 9',
        flag: 'normal',
      },
      {
        labCode: 'NE%-KR',
        labName: 'Нейтрофилы, %',
        value: '78.5',
        printed: '78.5 %',
        reference: '47 - 72',
        flag: 'abnormal',
      },
      {
        labCode: 'K-KR',
        labName: 'Калий',
        value: '4.25',
        printed: '4.25 ммоль/л',
        reference: '3.5 - 5.1',
        flag: 'normal',
      },
      {
        labCode: 'HCV',
        labName: 'Антитела к HCV',
        value: 'не обнаружены',
        printed: 'не обнаружены',
        reference: null,
        flag: null,
      },
      {
        labCode: 'CHOL',
        labName: 'Холестерин',
        value: '4.8',
        printed: '4.8 ммоль/л',
        reference: '< 5,2 - оптимально, 5,2 - 6,2 - погранично',
        flag: 'normal',
      },
      {
        labCode: `GLU ${INZ_BLOOD}`,
        labName: 'Глюкоза',
        value: '5.2',
        printed: '5.2 ммоль/л',
        reference: '3.9 - 6.1',
        flag: 'normal',
      },
      {
        labCode: `GLU ${INZ_URINE}`,
        labName: 'Глюкоза в моче',
        value: '0.4',
        printed: '0.4 ммоль/л',
        reference: '< 0.8',
        flag: 'normal',
      },
    ])
  })

  it('downloads a form per requisition, and skips what is not a PDF', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 blood')
    const page = sessionPage([
      rotatingRefresh(),
      answerBytes(`/patient/patient-a/${INZ_BLOOD}/file?source=`, pdf),
      answer(`/patient/patient-a/${INZ_URINE}/file?source=`, '<!doctype html><title>Ошибка</title>'),
    ])
    expect(await invitroConnector.fetchOrderForms?.(page, REF)).toEqual([pdf])
    const files = page.requests.filter((r) => r.url.includes('/file?'))
    expect(files.map((r) => r.init?.headers?.['Authorization'])).toEqual([
      'Bearer access-1',
      'Bearer access-1',
    ])
  })

  it('reports a session that ended during a sync as one to log into again', async () => {
    const failure = await invitroConnector
      .fetchOrder(new FakeLabPage([]), REF)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LabHttpError)
    expect((failure as LabHttpError).sessionExpired).toBe(true)
  })
})
