import { describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, someMigrations } from '../test-support'
import { openDatabase, runMigrations } from './client'

/** A database migrated up to, not including, the migration whose folder ends with `suffix`. */
function migrationsBefore(suffix: string): string {
  return someMigrations((names) => {
    const index = names.findIndex((name) => name.endsWith(suffix))
    if (index < 0) throw new Error(`No migration ends with ${suffix}`)
    return names.slice(0, index)
  })
}

const PATIENT_AND_LAB = `
  INSERT INTO patient (id, title, sex, birth_date) VALUES (1, 'Анна', 'female', '1990-05-14');
  INSERT INTO lab (id, name, marker_color, marker_shape) VALUES (1, 'KDL', '#000', 'circle');
`

describe('migrations', () => {
  it('form_file: a form stored before photos were possible keeps pointing at its PDF', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrationsBefore('_form_file'), () => {})
    const hash = 'ab'.repeat(32)
    db.$client.exec(`
      ${PATIENT_AND_LAB}
      INSERT INTO lab_order (patient_id, lab_id, collected_on, source, pdf_file) VALUES (1, 1, '2026-08-08', 'import', '${hash}');
      INSERT INTO lab_order (patient_id, lab_id, collected_on, source) VALUES (1, 1, '2026-08-09', 'manual');
    `)
    runMigrations(db, MIGRATIONS_DIR, () => {})
    expect(db.$client.prepare('SELECT order_id, position, file FROM order_form').all()).toEqual([
      { order_id: 1, position: 0, file: `${hash}.pdf` },
    ])
  })

  it('order_forms: the one form an order had becomes the first of its forms', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrationsBefore('_order_forms'), () => {})
    const photo = `${'cd'.repeat(32)}.jpg`
    db.$client.exec(`
      ${PATIENT_AND_LAB}
      INSERT INTO lab_order (patient_id, lab_id, collected_on, source) VALUES (1, 1, '2026-08-08', 'import');
      INSERT INTO lab_order (patient_id, lab_id, collected_on, source, form_file) VALUES (1, 1, '2026-08-09', 'manual', '${photo}');
    `)
    runMigrations(db, MIGRATIONS_DIR, () => {})
    expect(db.$client.prepare('SELECT order_id, position, file FROM order_form').all()).toEqual([
      { order_id: 2, position: 0, file: photo },
    ])
  })
})
