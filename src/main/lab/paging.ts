/** Guards a paging loop against a site that keeps answering with the same page. */
export const MAX_PAGES = 50

/**
 * Reads a list a lab serves page by page: `fetchPage(index)` answers the page at `index`, counted
 * from 0. Stops at a page shorter than `perPage` or one that brings nothing new; `keyOf` tells the
 * items apart.
 */
export async function collectPages<T>(
  perPage: number,
  fetchPage: (index: number) => Promise<readonly T[]>,
  keyOf: (item: T) => string,
): Promise<T[]> {
  const items = new Map<string, T>()
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await fetchPage(index)
    const before = items.size
    for (const item of page) items.set(keyOf(item), item)
    if (page.length < perPage || items.size === before) break
  }
  return [...items.values()]
}
