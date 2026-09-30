import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RawOrder, RawResult } from '../src/main/lab/types'
import { createDataDir, launchApp, seedImports, snapshot } from './app'

function raw(labCode: string, labName: string, printed: string, reference: string): RawResult {
  return { labCode, labName, value: null, printed, reference, flag: null }
}

const ORDERS: RawOrder[] = ['2024-11-12', '2025-04-03', '2025-10-20', '2026-03-15', '2026-08-08'].map(
  (collectedOn, i) => ({
    externalKey: `k${i}`,
    collectedOn,
    results: [
      raw('GLU', 'Глюкоза', `${(5.1 + i * 0.2).toFixed(1)} ммоль/л`, '3.9-5.5 ммоль/л'),
      raw('TSH', 'ТТГ', `${(1.8 + i * 0.4).toFixed(1)} мкМЕ/мл`, '0.4-4.0 мкМЕ/мл'),
    ],
    rawPayload: `k${i}`,
    pdf: null,
  }),
)

/** Counts the pages of a PDF Chromium wrote. */
function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

test('a report is built from analytes, kept as a template and saved as a PDF', async () => {
  const dataDir = await createDataDir()
  seedImports(dataDir, { KDL: ORDERS })
  const target = join(dataDir, 'report.pdf')

  const { app, window } = await launchApp(dataDir)
  try {
    // The save dialog answers with a file in the test's folder instead of asking.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath,
      })) as unknown as typeof dialog.showSaveDialog
    }, target)

    // The button, unlike the shortcut, waits until the app has drawn itself.
    await window.getByRole('button', { name: 'Поиск показателя' }).click()
    await window.getByPlaceholder('Показатель, синоним или код теста').fill('глюк')
    await window.getByRole('button', { name: /Глюкоза/ }).click()
    await window.getByRole('button', { name: 'В отчёт' }).click()

    await expect(window.getByRole('heading', { name: 'Отчёты' })).toBeVisible()
    const picker = window.getByPlaceholder('Добавить показатель')
    await picker.fill('ттг')
    await window.getByRole('option', { name: 'ТТГ' }).click()
    await expect(window.locator('.report-block')).toHaveCount(2)
    // The picker is ready for the next analyte.
    await expect(picker).toHaveValue('')
    // The preview is scaled down to its card rather than cut off at the card's edge.
    const card = await window.getByRole('region', { name: 'Предпросмотр отчёта' }).boundingBox()
    const page = await window.locator('.report').boundingBox()
    if (!card || !page) throw new Error('The preview is not on screen')
    expect(page.x + page.width).toBeLessThanOrEqual(card.x + card.width)
    await snapshot(window, '23-reports')

    const asChart = window.locator('label').filter({ hasText: /^График$/ })
    await asChart.nth(0).click()
    await asChart.nth(1).click()
    await window.locator('label').filter({ hasText: /^2$/ }).click()
    await expect(window.locator('.report-row')).toHaveCount(1)
    await snapshot(window, '24-reports-charts')

    await window.getByRole('button', { name: 'Сохранить отчёт как шаблон' }).click()
    await window.getByLabel('Название').fill('Для эндокринолога')
    await window.getByRole('button', { name: 'Сохранить новый' }).click()
    await expect(window.getByPlaceholder('Выберите шаблон')).toHaveValue('Для эндокринолога')

    const save = window.getByRole('button', { name: 'Сохранить PDF…' })
    await save.click()
    await expect.poll(() => existsSync(target), { timeout: 30_000 }).toBe(true)
    // The file appears as soon as writing starts; the button is busy until it ends.
    await expect(save).toBeEnabled()
    const pdf = readFileSync(target)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1)
  } finally {
    await app.close()
  }
})
