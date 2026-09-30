import type { IpcMainInvokeEvent, WebContents } from 'electron'

/** The app's own windows: only they may call the API, never a lab's page. */
export class TrustedWindows {
  private readonly ids = new Set<number>()

  trust(contents: WebContents): void {
    this.ids.add(contents.id)
    contents.once('destroyed', () => this.ids.delete(contents.id))
  }

  isTrusted(event: IpcMainInvokeEvent): boolean {
    return this.ids.has(event.sender.id)
  }
}
