import type { AppEvent } from './api'
import type { ApiResponse } from './errors'

/** What the preload script exposes to the UI as `window.bridge`. */
export interface Bridge {
  invoke(method: string, args: unknown[]): Promise<ApiResponse<unknown>>
  /** Subscribes to events from the main process; returns the unsubscribe function. */
  onEvent(listener: (event: AppEvent) => void): () => void
}
