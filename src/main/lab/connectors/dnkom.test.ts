import { describe, expect, it } from 'vitest'
import { answer, answerBytes, FakeLabPage, redirect } from '../fake-page'
import { LabHttpError } from '../types'
import { dnkomConnector, LOGGED_IN_EXPRESSION } from './dnkom'

/** A made-up order: tests never carry a real one. */
const TOKEN = '0123456789abcdef0123456789abcdef'
const REF = {
  externalKey: '100000001',
  collectedOn: '2026-07-15',
  data: { orderId: '100000001', token: TOKEN },
}
const LOGIN_PAGE = 'https://dnkom.ru/personal/cabinet/auth/'

const HEADER = `
  <header>
    <a class="account-name logged" href="/personal/cabinet/">ИВАНОВА АННА-МАРИЯ</a>
    <a class="logout-link" href="/?logout=yes">Выйти</a>
  </header>`

/** The list of orders, marked up as the cabinet marks it up. */
const RESULTS_PAGE = `<!doctype html><html><body>${HEADER}
  <div class="results-container"><div class="table-body">
    <div class="result-line" data-toggle="">
      <div class="order-info">
        <div class="body-cell order-no">
          <a class="order-link" href="resultdetail/?ORDER_ID=100000001&amp;TOKEN=${TOKEN}">1000000001</a>
        </div>
        <div class="body-cell order-created"><span>15.07.2026 09:41:12</span></div>
      </div>
      <div class="body-cell order-status"><span>16.07.2026</span><div class="order-completed">Готов</div></div>
      <div class="body-cell order-more"><a class="more-link" href="resultdetail/?ORDER_ID=100000001&amp;TOKEN=${TOKEN}"><span>Подробнее</span></a></div>
    </div>
    <div class="popup-send-order"><div class="popup-heading">Отправить результаты на почту</div></div>
    <div class="result-line" data-toggle="">
      <div class="order-info">
        <div class="body-cell order-no"><a class="order-link" href="resultdetail/?ORDER_ID=100000002&amp;TOKEN=${TOKEN}">1000000002</a></div>
        <div class="body-cell order-created"><span>в обработке</span></div>
      </div>
    </div>
  </div></div>
</body></html>`

function historyLink(testCode: string): string {
  return `<div class="body-param detail-chart"><a class="chart-link svg-icon icon-chart" title="История" href="/personal/cabinet/resulthistory/?ORDER_ID=100000001&amp;TOKEN=${TOKEN}&amp;TEST_CODE=${testCode}"></a></div>`
}

/** An order's page: a group of blood tests and a group of urine tests, each with its form. */
const ORDER_PAGE = `<!doctype html><html><body>${HEADER}
  <div class="results-detail">
    <div class="table-head"><div class="head-cell order-type">Биоматериал</div></div>
    <div class="detail-orders">
      <div class="group-line">
        <div class="group-cell order-type">Биохимия</div>
        <div class="group-cell order-material">Кровь (сыворотка)</div>
        <div class="group-cell order-file"><a class="action-block" href="/ajax/order_print.php?ORDER_ID=100000001&amp;ITEM_ID=1&amp;TOKEN=${TOKEN}"><span class="icon-pdf"></span></a></div>
      </div>
      <div class="detail-order">
        <div class="result-line"><div class="body-cell order-title">
          <div class="code"><span>10.101</span></div><div class="title"><a href="/analizy/alt/">АЛТ</a></div>
        </div></div>
        <div class="detail-table"><div class="detail-body">
          <div class="detail-line">
            <a class="body-param detail-title" href="/analizy/alt/" target="_blank">Аланинаминотрансфераза (АЛТ)</a>
            <div class="body-param detail-param"><div class="out-param"><span class="param-value">52,3
              Ед/л</span></div></div>
            <div class="body-param detail-normal"><span class="param-value">&lt; 41 Ед/л</span></div>
            ${historyLink('%D0%91%D0%A5_ALT')}
          </div>
        </div></div>
      </div>
      <div class="group-line">
        <div class="group-cell order-type">Общий анализ мочи</div>
        <div class="group-cell order-material">Моча (разовая)</div>
        <div class="group-cell order-file"><a class="action-block" href="/ajax/order_print.php?ORDER_ID=100000001&amp;ITEM_ID=2&amp;TOKEN=${TOKEN}"><span class="icon-pdf"></span></a></div>
      </div>
      <div class="detail-order">
        <div class="result-line"><div class="body-cell order-title">
          <div class="code"><span>20.200</span></div><div class="title"><a href="/analizy/oam/">Общий анализ мочи</a></div>
        </div></div>
        <div class="detail-table"><div class="detail-body">
          <div class="detail-line">
            <a class="body-param detail-title">Цвет</a>
            <div class="body-param detail-param"><div><span class="param-value">соломенно-желтый</span></div></div>
            <div class="body-param detail-normal"><span class="param-value">соломенно-желтый</span></div>
            ${historyLink('ОАМ_Цвет')}
          </div>
          <div class="detail-line">
            <a class="body-param detail-title">Лейкоциты</a>
            <div class="body-param detail-param"><div><span class="param-value">2 в п/зр</span></div></div>
            <div class="body-param detail-normal"><span class="param-value">0 - 5 в п/зр</span></div>
          </div>
          <div class="detail-line">
            <a class="body-param detail-title">Слизь</a>
            <div class="body-param detail-param"><div><span class="param-value">есть</span></div></div>
            <div class="body-param detail-normal"><span class="param-value"></span></div>
          </div>
        </div></div>
      </div>
    </div>
  </div>
</body></html>`

describe('dnkomConnector', () => {
  it('sees a login by the way out the site offers', async () => {
    expect(await dnkomConnector.detectLogin?.(new FakeLabPage([], { [LOGGED_IN_EXPRESSION]: true }))).toBe(
      true,
    )
    expect(await dnkomConnector.detectLogin?.(new FakeLabPage([], { [LOGGED_IN_EXPRESSION]: false }))).toBe(
      false,
    )
  })

  it('names the account after the holder, and knows an ended session by the login page', async () => {
    const loggedIn = new FakeLabPage([answer('/personal/cabinet/results/', RESULTS_PAGE)])
    expect(await dnkomConnector.detectAccount(loggedIn)).toEqual({
      externalId: null,
      label: 'Иванова Анна-Мария',
    })
    const loggedOut = new FakeLabPage([
      redirect('/personal/cabinet/results/', LOGIN_PAGE, '<form>Вход</form>'),
    ])
    expect(await dnkomConnector.detectAccount(loggedOut)).toBeNull()
  })

  it('lists the orders with a date to file them under', async () => {
    const page = new FakeLabPage([answer('/personal/cabinet/results/', RESULTS_PAGE)])
    expect(await dnkomConnector.listOrders(page)).toEqual([REF])
  })

  it("reads the results of every group, each under its history code, its group's analysis and material", async () => {
    const page = new FakeLabPage([answer(`/resultdetail/?ORDER_ID=100000001&TOKEN=${TOKEN}`, ORDER_PAGE)])
    const order = await dnkomConnector.fetchOrder(page, REF)
    const URINALYSIS = 'Общий анализ мочи'
    expect(order.results).toEqual([
      {
        labCode: 'БХ_ALT',
        labName: 'Аланинаминотрансфераза (АЛТ)',
        value: null,
        printed: '52,3 Ед/л',
        reference: '< 41 Ед/л',
        flag: 'abnormal',
        analysis: 'Биохимия',
        specimen: 'serum',
      },
      {
        labCode: 'ОАМ_Цвет',
        labName: 'Цвет',
        value: null,
        printed: 'соломенно-желтый',
        reference: 'соломенно-желтый',
        flag: 'normal',
        analysis: URINALYSIS,
        specimen: 'urine',
      },
      {
        labCode: '20.200 Лейкоциты',
        labName: 'Лейкоциты',
        value: null,
        printed: '2 в п/зр',
        reference: '0 - 5 в п/зр',
        flag: 'normal',
        analysis: URINALYSIS,
        specimen: 'urine',
      },
      {
        labCode: '20.200 Слизь',
        labName: 'Слизь',
        value: null,
        printed: 'есть',
        reference: null,
        flag: null,
        analysis: URINALYSIS,
        specimen: 'urine',
      },
    ])
    // Only the results, not the page around them, which changes with every visit.
    expect(order.rawPayload.startsWith('<div class="results-detail">')).toBe(true)
    expect(order.rawPayload).not.toContain('logout-link')
  })

  it('downloads a form per group, and skips what is not a PDF', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 blood')
    const page = new FakeLabPage([
      answer('/resultdetail/', ORDER_PAGE),
      answerBytes('/ajax/order_print.php?ORDER_ID=100000001&ITEM_ID=1&', pdf),
      answer('/ajax/order_print.php?ORDER_ID=100000001&ITEM_ID=2&', '<!doctype html><title>Ошибка</title>'),
    ])
    expect(await dnkomConnector.fetchOrderForms?.(page, REF)).toEqual([pdf])
  })

  it('reports a session that ended during a sync as one to log into again', async () => {
    const page = new FakeLabPage([redirect('/personal/cabinet/', LOGIN_PAGE)])
    const failure = await dnkomConnector.fetchOrder(page, REF).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LabHttpError)
    expect((failure as LabHttpError).sessionExpired).toBe(true)
    await expect(dnkomConnector.listOrders(page)).rejects.toBeInstanceOf(LabHttpError)
  })
})
