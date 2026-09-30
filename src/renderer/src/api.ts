import type { Api, AppEvent } from '@shared/api'

export class ApiError extends Error {
  override readonly name = 'ApiError'

  constructor(
    message: string,
    readonly userFacing: boolean,
  ) {
    super(message)
  }
}

/** A typed stand-in for the main-process API: `api.patients.list()` sends `patients.list`. */
function client(path: readonly string[]): unknown {
  return new Proxy(function () {}, {
    get(_target, key) {
      // `then` must stay undefined, or awaiting a namespace would treat it as a promise.
      if (typeof key !== 'string' || key === 'then') return undefined
      return client([...path, key])
    },
    async apply(_target, _this, args: unknown[]) {
      const response = await window.bridge.invoke(path.join('.'), args)
      if (!response.ok) throw new ApiError(response.error.message, response.error.userFacing)
      return response.value
    },
  })
}

export const api = client([]) as Api

export function onAppEvent(listener: (event: AppEvent) => void): () => void {
  return window.bridge.onEvent(listener)
}

/** The text to show a person for a failed call. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.userFacing) return error.message
  return 'Что-то пошло не так. Подробности записаны в журнал приложения.'
}
