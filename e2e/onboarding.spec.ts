import { expect, test } from '@playwright/test'
import { launchApp, snapshot } from './app'

test('first run creates a patient and lands on the overview', async () => {
  const { app, window } = await launchApp()
  try {
    await expect(window.getByText('Мои анализы').first()).toBeVisible()
    await snapshot(window, '01-welcome')

    await window.getByLabel('Имя').fill('Анна')
    await window.getByLabel('Женский').check()
    await window.getByLabel('Дата рождения').fill('14.05.1990')
    await window.keyboard.press('Escape')
    await window.getByRole('button', { name: 'Продолжить' }).click()

    await expect(window.getByText('Где хранить копии')).toBeVisible()
    await snapshot(window, '02-welcome-backups')
    await window.getByRole('button', { name: 'Оставить как есть' }).click()

    await expect(window.getByRole('heading', { name: 'Анна' })).toBeVisible()
    await expect(window.getByText('Пока нет результатов')).toBeVisible()
    await snapshot(window, '03-overview-empty')

    await window.getByRole('link', { name: 'Настройки' }).click()
    await expect(window.getByRole('heading', { name: 'Бэкапы' })).toBeVisible()
    await expect(window.getByText('При запуске').first()).toBeVisible()
    await snapshot(window, '04-settings')
  } finally {
    await app.close()
  }
})
