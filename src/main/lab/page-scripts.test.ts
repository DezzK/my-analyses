import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { readStorageScript, writeStorageScript } from './page-scripts'

/** A page's localStorage, enough of it for the scripts. */
function pageContext() {
  const entries = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
  }
  return { entries, context: { localStorage } }
}

describe('storage scripts', () => {
  it('write entries and read them back, a missing one as null', () => {
    const { entries, context } = pageContext()
    runInNewContext(writeStorageScript({ token: 'a.b-c_d', 'odd "key"': "it's" }), context)
    expect(Object.fromEntries(entries)).toEqual({ token: 'a.b-c_d', 'odd "key"': "it's" })
    const read = runInNewContext(readStorageScript(['token', 'odd "key"', 'missing']), context) as object
    expect({ ...read }).toEqual({ token: 'a.b-c_d', 'odd "key"': "it's", missing: null })
    runInNewContext(writeStorageScript({ token: null }), context)
    expect([...entries.keys()]).toEqual(['odd "key"'])
  })
})
