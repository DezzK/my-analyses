import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { lab, labAccount, patient, syncRun } from '../src/main/db/schema'
import { emptyStats } from '../src/main/import/importer'
import { launchApp, snapshot, withDatabase } from './app'

test('the labs page shows connected accounts and how their syncs went', async () => {
  // A first start creates the database; the accounts are then put in while the app is closed.
  const first = await launchApp()
  await expect(first.window.getByText('Мои анализы').first()).toBeVisible()
  await first.app.close()

  withDatabase(first.dataDir, (db) => {
    const kdl = db.select().from(lab).where(eq(lab.name, 'KDL')).get()
    if (!kdl) throw new Error('KDL is a built-in lab')
    const anna = db
      .insert(patient)
      .values({ title: 'Анна', sex: 'female', birthDate: '1990-05-14' })
      .returning()
      .get()
    const account = (label: string, n: number) =>
      db
        .insert(labAccount)
        .values({ labId: kdl.id, label, defaultPatientId: anna.id, sessionPartition: `e2e-account-${n}` })
        .returning()
        .get()
    const synced = account('Иванова Анна', 1)
    const expired = account('Иванова Мария', 2)
    db.insert(syncRun)
      .values([
        {
          labAccountId: synced.id,
          startedAt: '2026-09-01T08:00:00.000Z',
          finishedAt: '2026-09-01T08:02:10.000Z',
          status: 'ok',
          stats: JSON.stringify({ ...emptyStats(), ordersAdded: 14, analytesCreated: 96 }),
        },
        {
          labAccountId: synced.id,
          startedAt: '2026-09-20T07:00:00.000Z',
          finishedAt: '2026-09-20T07:00:05.000Z',
          status: 'blocked',
          stats: JSON.stringify(emptyStats()),
        },
        {
          labAccountId: synced.id,
          startedAt: '2026-09-30T09:15:00.000Z',
          finishedAt: '2026-09-30T09:15:20.000Z',
          status: 'ok',
          stats: JSON.stringify({ ...emptyStats(), ordersAdded: 1, ordersUpdated: 2 }),
        },
        {
          labAccountId: expired.id,
          startedAt: '2026-09-30T09:16:00.000Z',
          finishedAt: '2026-09-30T09:16:02.000Z',
          status: 'login_required',
          stats: JSON.stringify(emptyStats()),
        },
      ])
      .run()
    db.update(labAccount)
      .set({ lastSyncAt: '2026-09-30T09:15:20.000Z' })
      .where(eq(labAccount.id, synced.id))
      .run()
  })

  const { app, window } = await launchApp(first.dataDir)
  try {
    await window.getByRole('link', { name: 'Лаборатории' }).click()
    await expect(window.getByText('Иванова Анна')).toBeVisible()
    await expect(window.getByText('1 новый заказ, 2 заказа дополнены')).toBeVisible()
    await expect(window.getByText('Нужно снова войти в кабинет')).toBeVisible()
    await snapshot(window, '05-labs')

    await window.getByRole('button', { name: 'Действия с кабинетом' }).first().click()
    await window.getByRole('menuitem', { name: 'История обновлений' }).click()
    await expect(window.getByText('14 новых заказов, 96 новых показателей')).toBeVisible()
    await expect(window.getByText('Сайт не пустил')).toBeVisible()
    await snapshot(window, '06-sync-history')
    await window.keyboard.press('Escape')

    await window.getByRole('button', { name: 'KDL' }).click()
    await expect(window.getByRole('combobox', { name: 'Чьи анализы в этом кабинете' })).toHaveValue('Анна')
    await snapshot(window, '07-connect')
    await window.getByRole('button', { name: 'Отмена' }).click()
  } finally {
    await app.close()
  }
})
