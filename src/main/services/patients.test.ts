import { describe, expect, it } from 'vitest'
import { UserError } from '@shared/errors'
import { labOrder, lab } from '../db/schema'
import { createTestDb, silentEvents } from '../test-support'
import { PatientService } from './patients'

const TODAY = '2026-09-30'

function setup() {
  const db = createTestDb()
  const events = silentEvents()
  const service = new PatientService(db, events, () => TODAY)
  return { db, events, service }
}

const anna = { title: 'Анна', sex: 'female' as const, birthDate: '1990-05-14', note: null }

describe('PatientService', () => {
  it('creates, lists and announces patients', () => {
    const { service, events } = setup()
    const created = service.create({ ...anna, title: '  Анна  ' })
    expect(created.title).toBe('Анна')
    expect(service.list().map((p) => p.id)).toEqual([created.id])
    expect(events.emitted).toContainEqual({ type: 'data-changed', scopes: ['patients'] })
  })

  it.each([
    [{ ...anna, title: ' ' }, 'Укажите имя пациента'],
    [{ ...anna, birthDate: '2027-01-01' }, 'не может быть в будущем'],
    [{ ...anna, birthDate: '1990-02-30' }, 'Проверьте поле'],
    [{ ...anna, sex: 'other' as never }, 'Укажите пол'],
  ])('rejects %o', (input, message) => {
    const { service } = setup()
    expect(() => service.create(input)).toThrow(message)
  })

  it('hides a removed patient until restored, and purges it on the next start', () => {
    const { db, service } = setup()
    const p = service.create(anna)
    const labRow = db
      .insert(lab)
      .values({ name: 'KDL', markerColor: '#000', markerShape: 'circle' })
      .returning()
      .get()
    db.insert(labOrder)
      .values({ patientId: p.id, labId: labRow.id, collectedOn: '2026-01-01', source: 'manual' })
      .run()
    expect(service.orderCount(p.id)).toBe(1)

    service.remove(p.id)
    expect(service.list()).toEqual([])
    service.restore(p.id)
    expect(service.list()).toHaveLength(1)

    service.remove(p.id)
    service.purgeRemoved()
    service.restore(p.id)
    expect(service.list()).toEqual([])
    expect(db.select().from(labOrder).all()).toEqual([])
  })
})

describe('patient periods', () => {
  it('allows periods for female patients only', () => {
    const { service } = setup()
    const man = service.create({ ...anna, title: 'Иван', sex: 'male' })
    expect(() =>
      service.addPeriod(man.id, { kind: 'pregnancy', startDate: '2025-01-01', endDate: null }),
    ).toThrow(UserError)
  })

  it('rejects overlapping pregnancies and a second menopause', () => {
    const { service } = setup()
    const p = service.create(anna)
    service.addPeriod(p.id, { kind: 'pregnancy', startDate: '2020-01-01', endDate: '2020-10-01' })
    expect(() =>
      service.addPeriod(p.id, { kind: 'pregnancy', startDate: '2020-09-01', endDate: null }),
    ).toThrow('не могут пересекаться')
    service.addPeriod(p.id, { kind: 'pregnancy', startDate: '2022-01-01', endDate: null })

    service.addPeriod(p.id, { kind: 'menopause', startDate: '2025-01-01', endDate: null })
    expect(() =>
      service.addPeriod(p.id, { kind: 'menopause', startDate: '2025-06-01', endDate: null }),
    ).toThrow('уже указана')
  })

  it('lets a period be edited without clashing with itself', () => {
    const { service } = setup()
    const p = service.create(anna)
    const period = service.addPeriod(p.id, { kind: 'pregnancy', startDate: '2024-01-01', endDate: null })
    const updated = service.updatePeriod(period.id, {
      kind: 'pregnancy',
      startDate: '2024-01-01',
      endDate: '2024-10-05',
    })
    expect(updated.endDate).toBe('2024-10-05')
  })

  it('refuses to turn a patient with periods into a male patient', () => {
    const { service } = setup()
    const p = service.create(anna)
    service.addPeriod(p.id, { kind: 'menopause', startDate: '2024-01-01', endDate: null })
    expect(() => service.update(p.id, { ...anna, sex: 'male' })).toThrow('Сначала удалите периоды')
  })
})
