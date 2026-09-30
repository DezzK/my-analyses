import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { analyte } from '../src/main/db/schema'
import type { RawOrder, RawResult } from '../src/main/lab/types'
import { createDataDir, launchApp, seedImports, snapshot } from './app'

function raw(labCode: string, labName: string, printed: string, reference: string): RawResult {
  return { labCode, labName, value: null, printed, reference, flag: null }
}

const EARLIER: RawOrder = {
  externalKey: 'k1',
  collectedOn: '2026-08-08',
  results: [
    raw('GLU', 'Глюкоза', '5.4 ммоль/л', '3.9-5.5 ммоль/л'),
    raw('CRP', 'С-реактивный белок', '2 мг/л', '<5 мг/л'),
  ],
  rawPayload: 'k1',
  pdf: null,
}

test('an order is typed by hand from a panel, checked against earlier results and corrected', async () => {
  const dataDir = await createDataDir()
  seedImports(dataDir, { KDL: [EARLIER] }, (db, services) => {
    const id = (name: string) => db.select().from(analyte).where(eq(analyte.name, name)).get()?.id ?? -1
    services.panels.save(null, 'Биохимия', [id('Глюкоза'), id('С-реактивный белок')])
  })

  const { app, window } = await launchApp(dataDir)
  try {
    await window.getByRole('link', { name: 'Заказы', exact: true }).click()
    await window.getByRole('link', { name: 'Новый заказ' }).click()
    await window.getByRole('combobox', { name: 'Лаборатория' }).click()
    await window.getByRole('option', { name: 'KDL' }).click()
    await window.getByRole('textbox', { name: 'Дата сдачи' }).fill('01.09.2026')
    await window.getByPlaceholder('Добавить набор').click()
    await window.getByRole('option', { name: 'Биохимия' }).click()

    const values = window.getByRole('textbox', { name: 'Значение' })
    await values.nth(0).fill('54')
    await expect(window.getByText(/В 10 раз отличается от прошлого значения/)).toBeVisible()
    await snapshot(window, '21-new-order')
    await values.nth(0).fill('5,6')
    await values.nth(0).press('Enter')
    // Enter moves on to the next row's value: its analyte came with the panel.
    await expect(values.nth(1)).toBeFocused()
    await window.keyboard.type('<1')
    await expect(values.nth(1)).toHaveValue('<1')
    await expect(window.getByText(/В 10 раз/)).toBeHidden()
    await window.getByRole('button', { name: 'Сохранить заказ' }).click()

    await expect(window.getByRole('heading', { name: 'Заказы' })).toBeVisible()
    await window.getByRole('button', { name: /01\.09\.2026/ }).click()
    await expect(window.getByText('вручную').first()).toBeVisible()
    await window.getByRole('button', { name: 'Исправить «Глюкоза»' }).click()
    await window.getByRole('textbox', { name: 'Значение' }).fill('5,7')
    await window.getByRole('button', { name: 'Сохранить' }).click()
    // Typed without a reference and with no rule in the catalog, the value is shown unjudged.
    await expect(window.getByRole('cell', { name: '5,7', exact: true })).toBeVisible()
    await snapshot(window, '22-orders-manual')
  } finally {
    await app.close()
  }
})
