import type { UpdateStatus } from '@shared/api'
import { UserError } from '@shared/errors'
import type { EventSink } from '../events'
import type { Updater } from './updater'

/** The first check waits a little, so it never slows the start. */
const FIRST_CHECK_DELAY_MS = 30_000
/** Then the app asks again every few hours: it may stay open for days. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** Download progress is reported in steps of this share, not per chunk. */
export const PROGRESS_STEP = 0.01

/**
 * Owner of the app's own updates: when to ask the server, downloading what it offers, and the
 * status the UI shows. A newer version installs itself when the app quits; `restart` does it now.
 */
export class UpdateService {
  private current: UpdateStatus
  private running: Promise<UpdateStatus> | null = null

  constructor(
    private readonly deps: {
      /** Null in a development build and on systems without an updater. */
      updater: Updater | null
      events: EventSink
      now?: () => Date
    },
  ) {
    this.current = deps.updater ? { state: 'current', checkedAt: null } : { state: 'disabled' }
  }

  status(): UpdateStatus {
    return this.current
  }

  /** Checks shortly after the start and then regularly; the returned function stops it. */
  schedule(): () => void {
    if (!this.deps.updater) return () => {}
    const first = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS)
    const every = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }

  /** Asks for a newer version and downloads it; a check already running is joined, not repeated. */
  check(): Promise<UpdateStatus> {
    const { updater } = this.deps
    if (!updater || this.current.state === 'ready') return Promise.resolve(this.current)
    this.running ??= this.run(updater).finally(() => {
      this.running = null
    })
    return this.running
  }

  restart(): void {
    if (this.current.state !== 'ready') throw new UserError('Обновление ещё не скачано')
    this.deps.updater?.install(true)
  }

  private async run(updater: Updater): Promise<UpdateStatus> {
    this.set({ state: 'checking' })
    try {
      const version = await updater.check()
      if (!version) return this.set({ state: 'current', checkedAt: this.now() })
      let reported = 0
      this.set({ state: 'downloading', version, share: reported })
      await updater.download((share) => {
        if (share - reported < PROGRESS_STEP) return
        reported = share
        this.set({ state: 'downloading', version, share })
      })
      updater.install(false)
      return this.set({ state: 'ready', version })
    } catch (error) {
      if (!(error instanceof UserError)) console.error('Update failed', error)
      const message = error instanceof UserError ? error.message : 'Не удалось проверить обновления'
      return this.set({ state: 'failed', message, checkedAt: this.now() })
    }
  }

  private set(status: UpdateStatus): UpdateStatus {
    this.current = status
    this.deps.events.emit({ type: 'update-status', status })
    return status
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}
