import { describe, expect, it, vi } from 'vitest'
import { collectPages, MAX_PAGES } from './paging'

const PER_PAGE = 3
const key = (item: number) => String(item)

describe('collectPages', () => {
  it('reads pages until one comes back short', async () => {
    const pages = [[1, 2, 3], [4, 5, 6], [7]]
    const fetchPage = vi.fn(async (index: number) => pages[index] ?? [])
    expect(await collectPages(PER_PAGE, fetchPage, key)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('stops at a page that brings nothing new, and keeps each item once', async () => {
    const fetchPage = vi.fn(async () => [1, 2, 3])
    expect(await collectPages(PER_PAGE, fetchPage, key)).toEqual([1, 2, 3])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('gives up on a list that never ends', async () => {
    const fetchPage = vi.fn(async (index: number) => [0, 1, 2].map((i) => index * PER_PAGE + i))
    expect(await collectPages(PER_PAGE, fetchPage, key)).toHaveLength(MAX_PAGES * PER_PAGE)
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES)
  })
})
