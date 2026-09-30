import { describe, expect, it, vi } from 'vitest'
import type { AppEvent, UpdateStatus } from '@shared/api'
import { UserError } from '@shared/errors'
import { PROGRESS_STEP, UpdateService } from './update-service'
import type { Updater } from './updater'

const NOW = new Date('2026-10-01T10:00:00Z')

function fakeUpdater(overrides: Partial<Updater> = {}): Updater {
  return {
    check: vi.fn(async () => null),
    download: vi.fn(async () => {}),
    install: vi.fn(),
    ...overrides,
  }
}

function service(updater: Updater | null) {
  const emitted: UpdateStatus[] = []
  const events = { emit: (event: AppEvent) => event.type === 'update-status' && emitted.push(event.status) }
  return { updates: new UpdateService({ updater, events, now: () => NOW }), emitted }
}

describe('updates', () => {
  it('does nothing in a build that cannot update', async () => {
    const { updates, emitted } = service(null)
    expect(await updates.check()).toEqual({ state: 'disabled' })
    expect(emitted).toEqual([])
  })

  it('says the app is current when nothing newer is published', async () => {
    const { updates } = service(fakeUpdater())
    expect(updates.status()).toEqual({ state: 'current', checkedAt: null })
    expect(await updates.check()).toEqual({ state: 'current', checkedAt: NOW.toISOString() })
  })

  it('downloads a newer version, reports progress in steps, and installs it on quit', async () => {
    const updater = fakeUpdater({
      check: vi.fn(async () => '0.2.0'),
      download: vi.fn(async (progress: (share: number) => void) => {
        for (let i = 1; i <= 1000; i++) progress(i / 1000)
      }),
    })
    const { updates, emitted } = service(updater)
    expect(await updates.check()).toEqual({ state: 'ready', version: '0.2.0' })
    expect(updater.install).toHaveBeenCalledWith(false)
    const shares = emitted.flatMap((s) => (s.state === 'downloading' ? [s.share] : []))
    // However many chunks arrive, a report comes a whole step after the previous one.
    shares
      .slice(1)
      .forEach((share, i) => expect(share - (shares[i] ?? 0)).toBeGreaterThanOrEqual(PROGRESS_STEP))
    expect(shares.at(-1)).toBeGreaterThan(1 - PROGRESS_STEP)

    updates.restart()
    expect(updater.install).toHaveBeenLastCalledWith(true)
    // Once downloaded, it is not looked for again.
    await updates.check()
    expect(updater.check).toHaveBeenCalledTimes(1)
  })

  it("shows the updater's own words for a failure it explains, and plain ones otherwise", async () => {
    const refused = service(
      fakeUpdater({ check: vi.fn(async () => Promise.reject(new UserError('Чужой ключ'))) }),
    )
    expect(await refused.updates.check()).toEqual({
      state: 'failed',
      message: 'Чужой ключ',
      checkedAt: NOW.toISOString(),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = service(
      fakeUpdater({ check: vi.fn(async () => Promise.reject(new Error('socket hang up'))) }),
    )
    expect(await broken.updates.check()).toMatchObject({
      state: 'failed',
      message: 'Не удалось проверить обновления',
    })
  })

  it('joins a check already running instead of starting another', async () => {
    let finish: (version: string | null) => void = () => {}
    const updater = fakeUpdater({
      check: vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve))),
    })
    const { updates } = service(updater)
    const first = updates.check()
    const second = updates.check()
    finish(null)
    expect(await first).toEqual(await second)
    expect(updater.check).toHaveBeenCalledTimes(1)
  })

  it('restarts only into a downloaded version', () => {
    const { updates } = service(fakeUpdater())
    expect(() => updates.restart()).toThrow('ещё не скачано')
  })
})
