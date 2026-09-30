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
