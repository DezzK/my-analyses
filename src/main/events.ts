import type { WebContents } from 'electron'
import { EVENT_CHANNEL, type AppEvent, type DataScope } from '@shared/api'

/** Pushes events to the UI window; services depend on this, not on Electron. */
export interface EventSink {
  emit(event: AppEvent): void
}

export class WindowEvents implements EventSink {
  private target: WebContents | null = null

  attach(target: WebContents): void {
    this.target = target
  }

  emit(event: AppEvent): void {
    if (this.target && !this.target.isDestroyed()) this.target.send(EVENT_CHANNEL, event)
  }
}

export function dataChanged(sink: EventSink, ...scopes: DataScope[]): void {
  sink.emit({ type: 'data-changed', scopes })
}

export function fanOut(...sinks: EventSink[]): EventSink {
  return { emit: (event) => sinks.forEach((sink) => sink.emit(event)) }
}
