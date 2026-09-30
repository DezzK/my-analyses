import { expect, test } from '@playwright/test'
import type { RawOrder, RawResult } from '../src/main/lab/types'
import { createDataDir, launchApp, seedImports, snapshot } from './app'

function raw(
  labCode: string,
  labName: string,
  printed: string,
  reference: string,
  flag: RawResult['flag'] = null,
) {
  return { labCode, labName, value: null, printed, reference, flag }
}

function order(externalKey: string, collectedOn: string, results: RawResult[]): RawOrder {
  return { externalKey, collectedOn, results, rawPayload: externalKey, pdf: null }
}

test('the mapping queue merges, accepts, maps units and shows disagreements', async () => {
  const dataDir = await createDataDir()
  seedImports(dataDir, {
    KDL: [
      order('k1', '2026-08-08', [
        raw('TSH', 'Тиреотропный гормон (ТТГ)', '2.1 мкМЕ/мл', '0.4-4.0 мкМЕ/мл'),
        raw('AB', 'Антитела к ТПО', '12 Ед.акт/мл', '<35 Ед.акт/мл'),
        // The lab calls 5,2 high although its own reference is 3,9–5,5.
        raw('GLU', 'Глюкоза', '5.2 ммоль/л', '3.9-5.5 ммоль/л', 'high'),
      ]),
    ],
    Хеликс: [
      order('h1', '2026-09-01', [raw('H-TSH', 'Тиреотропный гормон', '2.4 мкМЕ/мл', '0.35-4.94 мкМЕ/мл')]),
    ],
  })

  const { app, window } = await launchApp(dataDir)
  try {
    await window.getByRole('link', { name: /Сопоставление/ }).click()
    await expect(window.getByRole('link', { name: 'Тиреотропный гормон', exact: true })).toBeVisible()
    await snapshot(window, '18-mapping-analytes')

    const helixRow = window.getByRole('row').filter({ hasText: 'H-TSH' })
    await helixRow.getByRole('button', { name: 'Похожие' }).click()
    await window.getByRole('dialog').getByRole('button', { name: 'Объединить' }).click()
    // Helix's analyte is gone; its code now belongs to KDL's TSH.
    await expect(window.getByRole('link', { name: 'Тиреотропный гормон', exact: true })).toHaveCount(0)
    await expect(window.getByRole('row').filter({ hasText: 'H-TSH' })).toContainText(
      'Тиреотропный гормон (ТТГ)',
    )

    await window.getByRole('button', { name: /Принять все/ }).click()
    await expect(window.getByText('Все показатели проверены.')).toBeVisible()

    await window.getByRole('tab', { name: /Единицы/ }).click()
    await expect(window.getByText('«Ед.акт/мл»')).toBeVisible()
    await snapshot(window, '19-mapping-units')
    await window.getByPlaceholder('Это единица…').fill('Ед/мл')
    await window.getByRole('option', { name: 'Ед/мл', exact: true }).click()
    await window.getByRole('button', { name: 'Сопоставить' }).click()
    await expect(window.getByText('Все единицы знакомы.')).toBeVisible()

    await window.getByRole('tab', { name: /Расхождения/ }).click()
    await expect(window.getByRole('link', { name: 'Глюкоза' })).toBeVisible()
    await snapshot(window, '20-mapping-disagreements')
  } finally {
    await app.close()
  }
})
