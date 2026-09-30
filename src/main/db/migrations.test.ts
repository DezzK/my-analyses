import { describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, someMigrations } from '../test-support'
import { openDatabase, runMigrations } from './client'

describe('migrations', () => {
  it('form_file: a form stored before photos were possible keeps pointing at its PDF', () => {
    const db = openDatabase(':memory:')
    runMigrations(
      db,
      someMigrations((names) =>
        names.slice(
          0,
          names.findIndex((name) => name.endsWith('_form_file')),
        ),
      ),
      () => {},
    )
    const hash = 'ab'.repeat(32)
    db.$client.exec(`
      INSERT INTO patient (id, title, sex, birth_date) VALUES (1, 'Анна', 'female', '1990-05-14');
      INSERT INTO lab (id, name, marker_color, marker_shape) VALUES (1, 'KDL', '#000', 'circle');
      INSERT INTO lab_order (patient_id, lab_id, collected_on, source, pdf_file) VALUES (1, 1, '2026-08-08', 'import', '${hash}');
      INSERT INTO lab_order (patient_id, lab_id, collected_on, source) VALUES (1, 1, '2026-08-09', 'manual');
    `)
    runMigrations(db, MIGRATIONS_DIR, () => {})
    expect(db.$client.prepare('SELECT form_file FROM lab_order ORDER BY id').all()).toEqual([
      { form_file: `${hash}.pdf` },
      { form_file: null },
    ])
  })
})
