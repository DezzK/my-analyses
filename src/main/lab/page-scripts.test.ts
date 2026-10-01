import { types } from 'node:util'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { HTTP_OK } from './fake-page'
import { fetchScript, readStorageScript, writeStorageScript } from './page-scripts'

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

/** A page whose `fetch` answers every request with `body`, and keeps the requests it was asked. */
function pageAnswering(body: string | Uint8Array) {
  const context: Record<string, unknown> = { btoa, body, requests: [], status: HTTP_OK }
  runInNewContext(
    `globalThis.fetch = (url, options) => {
      requests.push([url, options])
      return Promise.resolve({
        status,
        url,
        text: async () => body,
        arrayBuffer: async () => body.buffer,
      })
    }`,
    context,
  )
  return context
}

/** What Angular's zone.js does to a page: every `then` hands back a promise-like of its own. */
const ZONE_LIKE_THEN = `
  const nativeThen = Promise.prototype.then
  Promise.prototype.then = function (onFulfilled, onRejected) {
    const next = nativeThen.call(this, onFulfilled, onRejected)
    return { then: (a, b) => nativeThen.call(next, a, b) }
  }`

describe('fetch scripts', () => {
  it('give back a real promise of the response even where the page patches promises', async () => {
    const page = pageAnswering('{"ok":true}')
    runInNewContext(ZONE_LIKE_THEN, page)
    const options = { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'include' }
    const result: unknown = runInNewContext(fetchScript('https://lab.example/api', options, 'text'), page)
    // The embedded browser waits only for a real promise; anything else comes back unread.
    expect(types.isPromise(result)).toBe(true)
    expect({ ...((await result) as object) }).toEqual({
      status: HTTP_OK,
      url: 'https://lab.example/api',
      text: '{"ok":true}',
    })
    expect(JSON.parse(JSON.stringify(page['requests']))).toEqual([['https://lab.example/api', options]])
  })

  it('read a file as base64, however large', async () => {
    const file = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256)
    const page = pageAnswering(file)
    const result = (await runInNewContext(
      fetchScript('https://lab.example/form.pdf', {}, 'base64'),
      page,
    )) as {
      base64: string
    }
    expect(new Uint8Array(Buffer.from(result.base64, 'base64'))).toEqual(file)
  })
})
