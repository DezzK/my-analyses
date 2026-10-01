import { describe, expect, it } from 'vitest'
import { openDatabase, runMigrations } from './client'
import { patient } from './schema'
import { inTransaction } from './transaction'
import { MIGRATIONS_DIR } from '../test-support'

describe('inTransaction', () => {
  it('joins the transaction it is called in, which then commits or rolls back for both', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS_DIR, () => {})
    const add = (title: string) =>
      db.insert(patient).values({ title, sex: 'female', birthDate: '1990-05-14' }).run()

    expect(() =>
      inTransaction(db, () => {
        add('Анна')
        inTransaction(db, () => add('Мария'))
        throw new Error('the outer call fails after the inner one is done')
      }),
    ).toThrow('the outer call fails')
    expect(db.select().from(patient).all()).toEqual([])

    inTransaction(db, () => {
      add('Анна')
      inTransaction(db, () => add('Мария'))
    })
    expect(
      db
        .select()
        .from(patient)
        .all()
        .map((p) => p.title),
    ).toEqual(['Анна', 'Мария'])
    expect(db.$client.isTransaction).toBe(false)
  })
})
