/** Scripts the embedded browser runs inside a lab's page, kept apart from Electron so tests run them too. */

/** Reads the page's localStorage entries under `keys`; a missing one reads as null. */
export function readStorageScript(keys: readonly string[]): string {
  return `Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, localStorage.getItem(k)]))`
}

/** Stores `entries` in the page's localStorage; a null one is removed. */
export function writeStorageScript(entries: Readonly<Record<string, string | null>>): string {
  return (
    `Object.entries(${JSON.stringify(entries)})` +
    '.forEach(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)))'
  )
}

/** Bytes per `String.fromCharCode` call when a page turns a file into base64: one huge argument list overflows. */
const BASE64_SLICE = 0x8000

/** How the page reads a response for the main process: as text, or as a file, which crosses as base64. */
const READ_RESPONSE = {
  text: 'return { status: r.status, url: r.url, text: await r.text() }',
  base64:
    'const b = new Uint8Array(await r.arrayBuffer()); let s = ""; ' +
    `for (let i = 0; i < b.length; i += ${BASE64_SLICE}) s += String.fromCharCode.apply(null, b.subarray(i, i + ${BASE64_SLICE})); ` +
    'return { status: r.status, url: r.url, base64: btoa(s) }',
} as const

export type ResponseReading = keyof typeof READ_RESPONSE

/**
 * Makes a request from inside the page and reads its response. One async function from start to
 * end, so what it returns is a real promise, which the embedded browser waits for, even on a page
 * whose framework patches promises (Angular's zone.js makes `then` return a promise of its own).
 */
export function fetchScript(url: string, options: object, read: ResponseReading): string {
  return `(async () => { const r = await fetch(${JSON.stringify(url)}, ${JSON.stringify(options)}); ${READ_RESPONSE[read]} })()`
}
