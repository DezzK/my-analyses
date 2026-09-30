/**
 * A failure the person can act on: its message is shown to them as is, in Russian.
 * Anything else that crosses the IPC boundary is reported as an internal error.
 */
export class UserError extends Error {
  override readonly name = 'UserError'
}

export interface ApiErrorPayload {
  message: string
  userFacing: boolean
}

export type ApiResponse<T> = { ok: true; value: T } | { ok: false; error: ApiErrorPayload }

export function toApiError(error: unknown): ApiErrorPayload {
  if (error instanceof UserError) return { message: error.message, userFacing: true }
  const message = error instanceof Error ? error.message : String(error)
  return { message, userFacing: false }
}
