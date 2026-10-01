import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { analyte } from '../src/main/db/schema'
import type { RawOrder, RawResult } from '../src/main/lab/types'
import { createDataDir, launchApp, seedImports, snapshot } from './app'

function raw(labCode: string, labName: string, printed: string, reference: string): RawResult {
  return { labCode, labName, value: null, printed, reference, flag: null }
}

const ORDERS: RawOrder[] = ['2025-04-03', '2026-03-15'].map((collectedOn, i) => ({
  externalKey: `k${i}`,
  collectedOn,
  results: [
    raw('GLU', 'Глюкоза', `${(5.1 + i * 0.3).toFixed(1)} ммоль/л`, '3.9-5.5 ммоль/л'),
    raw('TSH', 'ТТГ', `${(1.8 + i * 0.6).toFixed(1)} мкМЕ/мл`, '0.4-4.0 мкМЕ/мл'),
  ],
  rawPayload: `k${i}`,
  forms: [],
}))

test('a panel goes into a report at once, and search shows all its analytes on one page', async () => {
  const dataDir = await createDataDir()
  seedImports(dataDir, { KDL: ORDERS }, (db, services) => {
    const id = (name: string) => db.select().from(analyte).where(eq(analyte.name, name)).get()?.id ?? -1
    services.panels.save(null, 'Эндокринолог', [id('ТТГ'), id('Глюкоза')])
  })

  const { app, window } = await launchApp(dataDir)
  try {
    await window.getByRole('link', { name: 'Отчёты' }).click()
    await window.getByPlaceholder('Добавить набор').click()
    await window.getByRole('option', { name: 'Эндокринолог' }).click()
    await expect(window.locator('.report-block')).toHaveCount(2)

    await window.getByRole('button', { name: 'Поиск показателя' }).click()
    await window.getByPlaceholder('Показатель, набор, синоним или код теста').fill('эндокр')
    await window.getByRole('button', { name: /Эндокринолог/ }).click()
    await expect(window.getByRole('heading', { name: 'Эндокринолог' })).toBeVisible()
    await expect(window.getByRole('link', { name: 'ТТГ' })).toBeVisible()
    await expect(window.getByRole('link', { name: 'Глюкоза' })).toBeVisible()
    await expect(window.locator('table')).toHaveCount(2)
    await window
      .locator('label')
      .filter({ hasText: /^График$/ })
      .click()
    await expect(window.locator('table')).toHaveCount(0)
    await snapshot(window, '25-panel')

    // The report has both already: nothing is added twice.
    await window.getByRole('button', { name: 'В отчёт' }).click()
    await expect(window.getByRole('heading', { name: 'Отчёты' })).toBeVisible()
    await expect(window.locator('.report-block')).toHaveCount(2)
  } finally {
    await app.close()
  }
})
