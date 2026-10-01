/**
 * What a page keeps in its address — the tab chosen, the order open — so that going back to it
 * finds it as it was left. A change of it replaces the address rather than adding a step to go
 * back through, and leaves the page where it is scrolled.
 */
export const KEEP_PLACE = { replace: true, resetScroll: false } as const

/** Reads the tab a page's address names, if it is one of the page's tabs. */
export function tabSearch<T extends string>(tabs: readonly T[]) {
  return (search: Record<string, unknown>): { tab?: T } => {
    const tab = search['tab']
    return tabs.some((own) => own === tab) ? { tab: tab as T } : {}
  }
}
