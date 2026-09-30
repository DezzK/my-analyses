import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { API_CHANNEL, type Api } from '@shared/api'
import { toApiError, type ApiResponse } from '@shared/errors'

type Handler = (...args: unknown[]) => Promise<unknown>

/** `{ patients: { list } }` → `'patients.list' → list`, the path the preload script sends. */
function flatten(node: object, prefix: string, out: Map<string, Handler>): Map<string, Handler> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'function') out.set(path, value as Handler)
    else if (value && typeof value === 'object') flatten(value, path, out)
  }
  return out
}

export function registerApi(api: Api, isTrusted: (event: IpcMainInvokeEvent) => boolean): void {
  const handlers = flatten(api, '', new Map())
  ipcMain.handle(
    API_CHANNEL,
    async (event, method: unknown, args: unknown): Promise<ApiResponse<unknown>> => {
      const handler = typeof method === 'string' ? handlers.get(method) : undefined
      if (!isTrusted(event) || !handler || !Array.isArray(args)) {
        return { ok: false, error: { message: `Rejected API call: ${String(method)}`, userFacing: false } }
      }
      try {
        return { ok: true, value: await handler(...args) }
      } catch (error) {
        console.error(`[api] ${method} failed`, error)
        return { ok: false, error: toApiError(error) }
      }
    },
  )
}
