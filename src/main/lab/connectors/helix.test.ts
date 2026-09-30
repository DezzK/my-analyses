import { describe, expect, it } from 'vitest'
import { answer, answerBytes, FakeLabPage, refuse } from '../fake-page'
import { helixConnector } from './helix'

/** Made-up account data, shaped the way Helix sends it. */
const PROFILE = { id: '1000001', lastName: 'Иванова', firstName: 'Анна', middleName: 'Петровна' }
const ORDER_CODE = '00000-00000-00000001'
const REF = {
  externalKey: ORDER_CODE,
  collectedOn: '2026-07-15',
  data: { code: ORDER_CODE, profileId: PROFILE.id },
}

function value(fields: Record<string, unknown>) {
  return {
    result: {
      numericEntry: null,
      formattedReferenceLo: null,
      formattedReferenceHi: null,
      referenceComment: null,
      units: null,
      ...fields,
    },
    dynamic: { dynamics: [] },
  }
}

const DETAILS = JSON.stringify({
  responseType: 'Results',
  results: {
    code: ORDER_CODE,
    tests: [
      {
        hxid: '90-001',
        kbId: 1,
        name: 'Витамин D, 25-гидрокси',
        results: [
          value({
            name: 'Кальциферол',
            formattedEntry: '41.20',
            numericEntry: 41.2,
            formattedReferenceLo: '30',
            formattedReferenceHi: '100',
            units: 'нг/мл',
          }),
        ],
      },
      {
        hxid: '90-002',
        kbId: 2,
        name: 'Клинический анализ крови',
        results: [
          value({
            name: 'Лейкоциты (WBC)',
            formattedEntry: '5.10',
            numericEntry: 5.1,
            formattedReferenceLo: '4,50',
            formattedReferenceHi: '11,00',
            units: '*10^9/л',
          }),
          value({
            name: 'СКФ',
            formattedEntry: '95',
            numericEntry: 95,
            formattedReferenceLo: '60',
            referenceComment: 'более',
            units: 'мл/мин',
          }),
          value({
            name: 'СОЭ',
            formattedEntry: '7',
            numericEntry: 7,
            formattedReferenceHi: '20',
            units: 'мм/ч',
          }),
          value({ name: 'Белок', formattedEntry: 'не обнаружен', referenceComment: 'отрицательный' }),
          value({ name: 'Без нормы', formattedEntry: '-' }),
        ],
      },
    ],
  },
})

describe('helixConnector', () => {
  it('knows the account by its current profile, and a logged-out one by the refusal', async () => {
    const loggedIn = new FakeLabPage([answer('/api/profiles/current', JSON.stringify(PROFILE))])
    expect(await helixConnector.detectAccount(loggedIn)).toEqual({
      externalId: PROFILE.id,
      label: 'Иванова Анна',
    })
    const nameless = new FakeLabPage([answer('/api/profiles/current', JSON.stringify({ id: PROFILE.id }))])
    expect(await helixConnector.detectAccount(nameless)).toEqual({ externalId: PROFILE.id, label: null })
    const loggedOut = new FakeLabPage([refuse('/api/profiles/current', 403)])
    expect(await helixConnector.detectAccount(loggedOut)).toBeNull()
    // A failing server is not a reason to log in again.
    const failing = new FakeLabPage([refuse('/api/profiles/current', 502)])
    await expect(helixConnector.detectAccount(failing)).rejects.toThrow('HTTP 502')
  })

  it("lists the profile's orders that have results, dated in Moscow", async () => {
    const orders = {
      orders: [
        // 21:30 UTC is already the next day in Moscow.
        {
          code: ORDER_CODE,
          createdOn: '2026-07-14T21:30:00.000+00:00',
          status: 'Completed',
          canShowDetails: true,
        },
        { code: '00000-00000-00000002', createdOn: '2026-07-20T08:00:00+00:00', canShowDetails: false },
      ],
      preOrders: [],
    }
    const page = new FakeLabPage([
      answer('/api/profiles/current', JSON.stringify(PROFILE)),
      answer(`/api/v2/orders?profileId=${PROFILE.id}`, JSON.stringify(orders)),
    ])
    expect(await helixConnector.listOrders(page)).toEqual([REF])
  })

  it('reads single tests under their own name and panel components under the test code and theirs', async () => {
    const page = new FakeLabPage([answer(`/api/v2/orders/${ORDER_CODE}?profileId=${PROFILE.id}`, DETAILS)])
    const order = await helixConnector.fetchOrder(page, REF)
    expect(order.rawPayload).toBe(DETAILS)
    expect(order.results).toEqual([
      {
        labCode: '90-001 Кальциферол',
        labName: 'Витамин D, 25-гидрокси',
        value: '41.20',
        printed: '41.20 нг/мл',
        reference: '30 - 100',
        flag: null,
      },
      {
        labCode: '90-002 Лейкоциты (WBC)',
        labName: 'Лейкоциты (WBC)',
        value: '5.10',
        printed: '5.10 *10^9/л',
        reference: '4,50 - 11,00',
        flag: null,
      },
      {
        labCode: '90-002 СКФ',
        labName: 'СКФ',
        value: '95',
        printed: '95 мл/мин',
        reference: '> 60',
        flag: null,
      },
      { labCode: '90-002 СОЭ', labName: 'СОЭ', value: '7', printed: '7 мм/ч', reference: '< 20', flag: null },
      {
        labCode: '90-002 Белок',
        labName: 'Белок',
        value: null,
        printed: 'не обнаружен',
        reference: 'отрицательный',
        flag: null,
      },
      {
        labCode: '90-002 Без нормы',
        labName: 'Без нормы',
        value: null,
        printed: '-',
        reference: null,
        flag: null,
      },
    ])
  })

  it('downloads a form per sample, and skips what is not a PDF', async () => {
    const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.7 ${text}`)
    const page = new FakeLabPage([
      answer(
        `/api/orders/${ORDER_CODE}/files?profileId=${PROFILE.id}`,
        JSON.stringify({ labelIds: ['111', '222', '333'] }),
      ),
      answerBytes('/files/results-111?', pdf('first sample')),
      answerBytes('/files/results-222?', pdf('second sample')),
      answer('/files/results-333?', '<!doctype html><title>Ошибка</title>'),
    ])
    expect(await helixConnector.fetchOrderForms?.(page, REF)).toEqual([
      pdf('first sample'),
      pdf('second sample'),
    ])
  })
})
