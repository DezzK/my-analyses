import { expect, test } from '@playwright/test'
import type { RawOrder, RawResult } from '../src/main/lab/types'
import { createDataDir, launchApp, seedImports, snapshot } from './app'

function tsh(labCode: string, labName: string, value: string, reference: string): RawResult {
  return { labCode, labName, value, printed: `${value} мкМЕ/мл`, reference, flag: null }
}

const ferritin: RawResult = {
  labCode: 'FER',
  labName: 'Ферритин',
  value: '40',
  printed: '40 нг/мл',
  reference: '10-120 нг/мл',
  flag: null,
}

function order(externalKey: string, collectedOn: string, results: RawResult[]): RawOrder {
  return { externalKey, collectedOn, results, rawPayload: externalKey, forms: [] }
}

test('the catalog edits an analyte, its rules, merges and panels', async () => {
  const dataDir = await createDataDir()
  seedImports(dataDir, {
    KDL: [order('k1', '2026-08-08', [tsh('TSH-K', 'ТТГ', '2.1', '0.4-4.0 мкМЕ/мл'), ferritin])],
    Хеликс: [order('h1', '2026-09-01', [tsh('TSH-H', 'Тиреотропный гормон', '2.4', '0.35-4.94 мкМЕ/мл')])],
  })

  const { app, window } = await launchApp(dataDir)
  try {
    // The dictionary took Helix's TSH for KDL's.
    await window.getByRole('link', { name: 'Справочник' }).click()
    await expect(window.getByRole('link', { name: 'ТТГ', exact: true })).toBeVisible()
    await expect(window.getByRole('link', { name: 'Тиреотропный гормон' })).toHaveCount(0)
    await snapshot(window, '14-catalog')

    await window.getByRole('link', { name: 'ТТГ', exact: true }).click()
    await expect(window.getByText('Референсы, которые присылали лаборатории')).toBeVisible()
    // Helix's reference, the latest, comes first.
    await window.getByRole('button', { name: 'Создать правило' }).first().click()
    await expect(window.getByRole('textbox', { name: 'Верхняя граница' })).toHaveValue('4,94')
    await window.getByRole('button', { name: 'Сохранить' }).last().click()
    await expect(window.getByRole('cell', { name: /0,35–4,94/ })).toBeVisible()
    await snapshot(window, '15-analyte-card')

    await expect(window.getByText('справочником, не проверено')).toBeVisible()
    await window.getByRole('button', { name: 'Разъединить' }).click()
    await expect(window.getByText('Объединённые показатели')).toBeHidden()

    // Split, they stay apart until the person merges them again.
    await window.getByRole('button', { name: 'Объединить с…' }).click()
    await window.getByPlaceholder('Название, синоним или код').fill('тиреотроп')
    await window.getByRole('option', { name: 'Тиреотропный гормон' }).click()
    await window.getByRole('button', { name: 'Объединить', exact: true }).click()
    await expect(window.getByText('Объединённые показатели')).toBeVisible()
    await expect(window.getByText('TSH-K')).toBeVisible()
    await snapshot(window, '16-merged')
    await window.getByRole('button', { name: 'Разъединить' }).click()
    await expect(window.getByText('Объединённые показатели')).toBeHidden()

    await window.getByRole('link', { name: 'Справочник' }).click()
    await window.getByRole('tab', { name: 'Наборы' }).click()
    await window.getByRole('button', { name: 'Новый набор' }).click()
    await window.getByLabel('Название').fill('Щитовидная железа')
    await window.getByPlaceholder('Добавить показатель').fill('ферр')
    await window.getByRole('option', { name: 'Ферритин' }).click()
    await window.getByRole('button', { name: 'Сохранить' }).click()
    await expect(window.getByRole('heading', { name: 'Щитовидная железа' })).toBeVisible()
    await snapshot(window, '17-panels')
  } finally {
    await app.close()
  }
})
