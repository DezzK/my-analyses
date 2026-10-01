import { expect, test } from '@playwright/test'
import type { RawOrder, RawResult } from '../src/main/lab/types'
import { createDataDir, launchApp, seedImports, snapshot } from './app'

/** Made-up results, shaped the way KDL reports them. */
function result(labCode: string, labName: string, value: string, unit: string, reference: string): RawResult {
  return { labCode, labName, value, printed: `${value} ${unit}`.trim(), reference, flag: null }
}

const glucose = (value: string) => result('1.1.A1.1', 'Глюкоза', value, 'ммоль/л', '3.9-5.5 ммоль/л')
const tsh = (value: string) => result('1.2.B1.1', 'ТТГ', value, 'мкМЕ/мл', '0.4-4.0 мкМЕ/мл')
const hemoglobin = (value: string) => result('1.1.A2.1', 'Гемоглобин', value, 'г/л', '120-140 г/л')
const crp = (value: string) => result('1.3.C1.1', 'С-реактивный белок', value, 'мг/л', '<5 мг/л')
const urineProtein: RawResult = {
  labCode: '2.1.A1.1',
  labName: 'Белок в моче',
  value: null,
  printed: 'не обнаружено',
  reference: 'отрицательно',
  flag: 'normal',
}

function order(externalKey: string, collectedOn: string, results: RawResult[]): RawOrder {
  return { externalKey, collectedOn, results, rawPayload: JSON.stringify(results), forms: [] }
}

const KDL_ORDERS = [
  order('2:1', '2024-11-12', [glucose('5.1'), tsh('2.1'), hemoglobin('128')]),
  order('2:2', '2025-04-03', [glucose('5.6'), tsh('3.2'), hemoglobin('118')]),
  order('2:3', '2025-10-20', [glucose('5.3'), crp('<1')]),
  order('2:4', '2026-03-15', [glucose('5.9'), hemoglobin('131')]),
  order('2:5', '2026-08-08', [glucose('6.20'), tsh('2.4'), hemoglobin('135'), crp('<1'), urineProtein]),
]
/** Another lab measures glucose too, against its own reference. */
const HELIX_GLUCOSE = 'GLU-01'
const HELIX_ORDERS = [
  order('h:1', '2025-07-01', [{ ...glucose('5.7'), labCode: HELIX_GLUCOSE, reference: '4.1-5.9 ммоль/л' }]),
]

test('results are found, tabulated, charted and grouped into orders', async () => {
  const dataDir = await createDataDir()
  // The dictionary merges Helix's glucose into KDL's.
  seedImports(dataDir, { KDL: KDL_ORDERS, Хеликс: HELIX_ORDERS })

  const { app, window } = await launchApp(dataDir)
  try {
    await expect(window.getByText('Последний заказ')).toBeVisible()
    await expect(window.getByText('Вне нормы 1 из 5:')).toBeVisible()
    await snapshot(window, '08-overview')

    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await window.getByPlaceholder('Показатель, набор, синоним или код теста').fill('глюк')
    await expect(window.getByRole('button', { name: /Глюкоза/ })).toBeVisible()
    await snapshot(window, '09-search')
    await window.getByRole('button', { name: /Глюкоза/ }).click()

    await expect(window.getByRole('heading', { name: /Глюкоза/ })).toBeVisible()
    await expect(window.getByText('6,20 (+)')).toBeVisible()
    await snapshot(window, '10-analyte-table')

    await window.locator('label').filter({ hasText: 'График' }).click()
    await expect(window.locator('svg').filter({ hasText: 'ммоль/л' }).first()).toBeVisible()
    await snapshot(window, '11-analyte-chart')

    await window.getByRole('link', { name: 'Заказы', exact: true }).click()
    await window.getByRole('button', { name: /08\.08\.2026/ }).click()
    await expect(window.getByRole('link', { name: 'С-реактивный белок' })).toBeVisible()
    await snapshot(window, '12-orders')

    // The chart follows the system's dark theme.
    await window.emulateMedia({ colorScheme: 'dark' })
    await window.getByRole('link', { name: 'Глюкоза' }).click()
    await expect(window.locator('svg').filter({ hasText: 'ммоль/л' }).first()).toBeVisible()
    await snapshot(window, '13-analyte-chart-dark')
  } finally {
    await app.close()
  }
})
